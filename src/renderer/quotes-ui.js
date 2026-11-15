'use strict';
// Écrans des devis : liste, saisie d'un brouillon, détail d'un devis finalisé.

async function openQuote(mode, id) {
  state.quoteView = { mode, id };
  await refresh();
  document.getElementById('view').scrollTop = 0;
}

// Passe à l'écran Factures pour ouvrir la facture créée à partir d'un devis.
async function openInvoiceFromQuote(invoiceId) {
  const inv = await call('getInvoice', invoiceId);
  state.screen = 'invoices';
  renderNav();
  await openInvoice(inv.status === 'brouillon' ? 'edit' : 'detail', invoiceId);
}

function renderQuotesScreen() {
  const { mode, id } = state.quoteView;
  if (mode === 'edit') return renderQuoteEditor(id);
  if (mode === 'detail') return renderQuoteDetail(id);
  return renderQuoteList();
}

// --- Liste ---

const QUOTE_FILTERS = [
  ['all', 'Tous', null],
  ['draft', 'Brouillons', 'brouillon'],
  ['sent', 'Envoyés', 'envoye'],
  ['accepted', 'Acceptés', 'accepte'],
  ['closed', 'Refusés ou expirés', ['refuse', 'expire']],
];

async function renderQuoteList() {
  const current = QUOTE_FILTERS.find((f) => f[0] === state.quoteFilter) || QUOTE_FILTERS[0];
  const rows = await call('listQuotes', { status: current[2], search: state.quoteSearch });

  const chips = QUOTE_FILTERS.map(([key, label]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(current[0] === key),
    onclick: async () => { state.quoteFilter = key; await refresh(); },
  }, label));

  const filtered = current[2] || state.quoteSearch;
  const list = rows.length === 0
    ? h('p', { class: 'empty' }, filtered ? 'Aucun devis ne correspond.' : 'Aucun devis pour le moment. Créez le premier avec « Nouveau devis ».')
    : h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Numéro'),
        h('th', { scope: 'col' }, 'Client'),
        h('th', { scope: 'col' }, 'Date'),
        h('th', { scope: 'col' }, 'Valable jusqu’au'),
        h('th', { scope: 'col' }, 'Statut'),
        h('th', { scope: 'col', class: 'num' }, 'Montant TTC'))),
      h('tbody', {}, rows.map((r) => {
        const draft = r.status === 'brouillon';
        return h('tr', {},
          h('td', {}, h('button', {
            type: 'button', class: 'btn link',
            onclick: () => openQuote(draft ? 'edit' : 'detail', r.id),
          }, draft ? 'Brouillon' : r.number)),
          h('td', {}, draft ? r.current_client_name : r.client_name),
          h('td', { class: 'muted' }, formatDate(r.issue_date)),
          h('td', { class: 'muted' }, formatDate(r.valid_until)),
          h('td', {}, statusChip(r.display_status), r.invoice_id ? h('span', { class: 'muted small' }, ' · facturé') : null),
          h('td', { class: 'num strong' }, money(r.total_ttc)));
      }))));

  return [
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Devis'), h('span', { class: 'muted' }, `${rows.length} affiché${rows.length > 1 ? 's' : ''}`)),
      h('button', { type: 'button', class: 'btn primary', onclick: () => openQuote('edit', null) }, '+ Nouveau devis')),
    h('div', { class: 'toolbar' },
      h('div', { class: 'row', role: 'group', 'aria-label': 'Filtrer par statut' }, chips),
      searchBox('quote-search', 'Rechercher un devis', 'Client ou numéro', state.quoteSearch, (v) => { state.quoteSearch = v; })),
    h('section', { class: 'card flush' }, list),
  ];
}

// --- Saisie d'un brouillon ---

async function renderQuoteEditor(id) {
  const quote = id ? await call('getQuote', id) : null;
  const settings = await call('getSettings');
  return renderDraftEditor({
    doc: quote,
    title: quote ? 'Devis (brouillon)' : 'Nouveau devis',
    hint: 'Le numéro est attribué quand vous finalisez le devis. Un brouillon reste modifiable.',
    backLabel: '← Retour aux devis',
    goBack: () => openQuote('list', null),
    setView: (newId) => { state.quoteView = { mode: 'edit', id: newId }; },
    create: (data) => call('createQuote', data),
    update: (docId, data) => call('updateQuote', docId, data),
    remove: (docId) => call('deleteQuote', docId),
    clientLocked: false,
    primaryLabel: 'Finaliser le devis',
    emptyError: 'Ajoutez au moins une ligne avant de finaliser le devis.',
    primary: (saved) => openForm({
      title: 'Finaliser le devis',
      submitLabel: 'Finaliser',
      fields: [
        h('p', {}, `Total : ${money(saved.total_ttc)}. Le devis reçoit son numéro et ne peut plus être modifié. Pour le changer ensuite, dupliquez-le.`),
        h('div', { class: 'grid' },
          field('Date du devis', 'issue_date', todayIso(), { type: 'date', required: true }),
          field('Validité (jours)', 'validity_days', settings.quote_validity_days, { type: 'number', min: 0, step: 1, required: true })),
      ],
      onSubmit: async (values) => {
        const sent = await call('sendQuote', saved.id, {
          issue_date: values.issue_date,
          validity_days: Math.round(wholeNumber(values.validity_days, 'Validité')),
        });
        toast(`${sent.number} finalisé.`);
        await openQuote('detail', sent.id);
      },
    }),
  });
}

// --- Détail d'un devis finalisé ---

async function renderQuoteDetail(id) {
  const [quote, s] = await Promise.all([call('getQuote', id), call('getSettings')]);
  const error = h('div', { class: 'error', role: 'alert' });
  const guard = (fn) => async () => {
    error.textContent = '';
    try { await fn(); } catch (err) { error.textContent = err.message; }
  };

  const answer = (value, message) => guard(async () => {
    await call('setQuoteAnswer', quote.id, value);
    toast(message);
    await refresh();
  });

  const convert = guard(async () => {
    const invoice = await call('convertQuoteToInvoice', quote.id);
    toast('Facture créée en brouillon à partir du devis.');
    await openInvoiceFromQuote(invoice.id);
  });

  const duplicate = guard(async () => {
    const copy = await call('duplicateQuote', quote.id);
    toast('Devis dupliqué en brouillon.');
    await openQuote('edit', copy.id);
  });

  const paper = documentPaper({
    title: 'Devis',
    doc: quote,
    settings: s,
    meta: [`Date : ${formatDate(quote.issue_date)}`, `Valable jusqu’au ${formatDate(quote.valid_until)}`],
    toLabel: 'Adressé à',
    footParts: [quote.note, s.legal_footer],
  });

  const status = quote.display_status;
  let answerCard;
  if (quote.invoice_id) {
    answerCard = h('section', { class: 'card' },
      h('h2', {}, 'Facture'),
      h('p', { class: 'muted' }, 'Ce devis a été accepté et converti en facture.'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => openInvoiceFromQuote(quote.invoice_id) }, 'Voir la facture'));
  } else if (status === 'accepte') {
    answerCard = h('section', { class: 'card' },
      h('h2', {}, 'Devis accepté'),
      h('p', { class: 'muted' }, 'Les lignes, le client et les prix sont repris tels quels dans un brouillon de facture.'),
      h('button', { type: 'button', class: 'btn primary', onclick: convert }, 'Convertir en facture'),
      h('button', { type: 'button', class: 'btn', onclick: answer('refuse', 'Devis marqué comme refusé.') }, 'Finalement refusé'));
  } else {
    answerCard = h('section', { class: 'card' },
      h('h2', {}, 'Réponse du client'),
      h('p', { class: 'muted' }, status === 'expire' ? 'La date de validité est dépassée. Vous pouvez tout de même enregistrer la réponse du client.'
        : status === 'refuse' ? 'Le client a refusé ce devis.' : 'En attente de la réponse du client.'),
      h('button', { type: 'button', class: 'btn primary', onclick: answer('accepte', 'Devis marqué comme accepté.') }, 'Marquer comme accepté'),
      status !== 'refuse' && h('button', { type: 'button', class: 'btn', onclick: answer('refuse', 'Devis marqué comme refusé.') }, 'Marquer comme refusé'));
  }

  return [
    h('header', { class: 'page-head' },
      h('div', {},
        h('button', { type: 'button', class: 'btn link back', onclick: () => openQuote('list', null) }, '← Retour aux devis'),
        h('div', { class: 'row' }, h('h1', {}, quote.number), statusChip(status))),
      documentActions('devis', quote.id)),
    error,
    h('div', { class: 'split' },
      h('div', { class: 'grow' }, paper),
      h('aside', { class: 'stack' },
        answerCard,
        h('section', { class: 'card' },
          h('h2', {}, 'Nouvelle version'),
          h('p', { class: 'muted' }, 'Un devis finalisé ne se modifie pas. Dupliquez-le pour préparer une version corrigée.'),
          h('button', { type: 'button', class: 'btn', onclick: duplicate }, 'Dupliquer ce devis')))),
  ];
}
