'use strict';
// Écrans des factures : liste, saisie d'un brouillon, détail d'une facture émise.
// Les outils (h, call, money, openForm, toast, state, refresh…) viennent de app.js.

const STATUS_LABELS = {
  envoye: 'Envoyé', accepte: 'Accepté', refuse: 'Refusé', expire: 'Expiré',
  brouillon: 'Brouillon', en_attente: 'En attente', en_retard: 'En retard',
  payee: 'Payée', annulee: 'Annulée', avoir: 'Avoir',
};

const PAYMENT_METHODS = ['Espèces', 'Virement', 'Wave', 'Orange Money', 'Chèque'];

function statusChip(status) {
  return h('span', { class: `status ${status}` }, h('span', { class: 'dot', 'aria-hidden': 'true' }), STATUS_LABELS[status]);
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseNumber(text) {
  const n = Number(String(text).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

const quantityText = (q) => String(q / 1000).replace('.', ',');

async function openInvoice(mode, id) {
  state.invoiceView = { mode, id };
  await refresh();
  document.getElementById('view').scrollTop = 0;
}

function renderInvoicesScreen() {
  const { mode, id } = state.invoiceView;
  if (mode === 'edit') return renderInvoiceEditor(id);
  if (mode === 'detail') return renderInvoiceDetail(id);
  return renderInvoiceList();
}

// --- Liste ---

async function renderInvoiceList() {
  const showCredits = state.invoiceFilter === 'avoir';
  const rows = await call('listInvoices', {
    kind: showCredits ? 'avoir' : 'facture',
    status: showCredits ? null : state.invoiceFilter,
    search: state.invoiceSearch,
  });

  const filters = [[null, 'Toutes'], ['brouillon', 'Brouillons'], ['en_attente', 'En attente'],
    ['en_retard', 'En retard'], ['payee', 'Payées'], ['avoir', 'Avoirs']];
  const chips = filters.map(([value, label]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(state.invoiceFilter === value),
    onclick: async () => { state.invoiceFilter = value; await refresh(); },
  }, label));

  const filtered = state.invoiceFilter || state.invoiceSearch;
  const list = rows.length === 0
    ? h('p', { class: 'empty' }, filtered ? 'Aucune facture ne correspond.' : 'Aucune facture pour le moment. Créez la première avec « Nouvelle facture ».')
    : h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Numéro'),
        h('th', { scope: 'col' }, 'Client'),
        h('th', { scope: 'col' }, 'Émise le'),
        h('th', { scope: 'col' }, 'Échéance'),
        h('th', { scope: 'col' }, 'Statut'),
        h('th', { scope: 'col', class: 'num' }, 'Montant TTC'))),
      h('tbody', {}, rows.map((r) => {
        const draft = r.status === 'brouillon';
        const status = draft && r.kind === 'avoir' ? 'brouillon' : r.display_status;
        return h('tr', {},
          h('td', {}, h('button', {
            type: 'button', class: 'btn link',
            onclick: () => openInvoice(draft ? 'edit' : 'detail', r.id),
          }, draft ? 'Brouillon' : r.number)),
          h('td', {}, draft ? r.current_client_name : r.client_name),
          h('td', { class: 'muted' }, formatDate(r.issue_date)),
          h('td', { class: 'muted' }, r.kind === 'avoir' ? '—' : formatDate(r.due_date)),
          h('td', {}, statusChip(status)),
          h('td', { class: 'num strong' }, money(r.total_ttc)));
      }))));

  return [
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Factures'), h('span', { class: 'muted' }, `${rows.length} affichée${rows.length > 1 ? 's' : ''}`)),
      h('button', { type: 'button', class: 'btn primary', onclick: () => openInvoice('edit', null) }, '+ Nouvelle facture')),
    h('div', { class: 'toolbar' },
      h('div', { class: 'row', role: 'group', 'aria-label': 'Filtrer par statut' }, chips),
      searchBox('invoice-search', 'Rechercher une facture', 'Client ou numéro', state.invoiceSearch, (v) => { state.invoiceSearch = v; })),
    h('section', { class: 'card flush' }, list),
  ];
}

// --- Saisie d'un brouillon ---

async function renderInvoiceEditor(id) {
  const inv = id ? await call('getInvoice', id) : null;
  const isCredit = Boolean(inv && inv.kind === 'avoir');
  const noun = isCredit ? 'l\u2019avoir' : 'la facture';
  return renderDraftEditor({
    doc: inv,
    title: isCredit ? 'Avoir (brouillon)' : inv ? 'Facture (brouillon)' : 'Nouvelle facture',
    hint: 'Le numéro est attribué à l\u2019émission. Un brouillon reste modifiable.',
    backLabel: '← Retour aux factures',
    goBack: () => openInvoice('list', null),
    setView: (newId) => { state.invoiceView = { mode: 'edit', id: newId }; },
    create: (data) => call('createDraft', data),
    update: (docId, data) => call('updateDraft', docId, data),
    remove: (docId) => call('deleteDraft', docId),
    clientLocked: isCredit,
    clientLockedHint: 'Le client d\u2019un avoir est celui de la facture d\u2019origine.',
    primaryLabel: isCredit ? 'Émettre l\u2019avoir' : 'Émettre la facture',
    emptyError: `Ajoutez au moins une ligne avant d\u2019émettre ${noun}.`,
    primary: (saved) => openForm({
      title: isCredit ? 'Émettre l\u2019avoir' : 'Émettre la facture',
      submitLabel: 'Émettre définitivement',
      fields: [
        h('p', {}, `Total : ${money(saved.total_ttc)}. Après l\u2019émission, ${noun} reçoit son numéro et ne peut plus être modifié${isCredit ? '' : 'e'} ni supprimé${isCredit ? '' : 'e'}.`),
        field('Date d\u2019émission', 'issue_date', todayIso(), { type: 'date', required: true }),
      ],
      onSubmit: async (values) => {
        const issued = await call('issueInvoice', saved.id, { issue_date: values.issue_date });
        toast(`${issued.number} émis${isCredit ? '' : 'e'}.`);
        await openInvoice('detail', issued.id);
      },
    }),
  });
}

// --- Détail d'une facture émise ---

async function renderInvoiceDetail(id) {
  const [inv, s] = await Promise.all([call('getInvoice', id), call('getSettings')]);
  const isCredit = inv.kind === 'avoir';
  const origin = isCredit && inv.credit_of ? await call('getInvoice', inv.credit_of) : null;

  const pay = () => openForm({
    title: 'Enregistrer un paiement',
    fields: [
      field('Montant reçu (FCFA)', 'amount', inv.remaining, { type: 'number', min: 1, step: 1, required: true, hint: `Reste à payer : ${money(inv.remaining)}` }),
      h('div', { class: 'grid' },
        field('Date du paiement', 'paid_on', todayIso(), { type: 'date', required: true }),
        field('Moyen de paiement', 'method', PAYMENT_METHODS[0], { options: PAYMENT_METHODS.map((m) => [m, m]) })),
    ],
    onSubmit: async (values) => {
      await call('recordPayment', inv.id, { amount: Math.round(wholeNumber(values.amount, 'Montant')), paid_on: values.paid_on, method: values.method });
      toast('Paiement enregistré.');
      await refresh();
    },
  });

  const credit = async () => {
    try {
      const draft = await call('createCreditNote', inv.id);
      await openInvoice('edit', draft.id);
    } catch (err) { toast(err.message); }
  };

  const paper = documentPaper({
    title: isCredit ? 'Avoir' : 'Facture',
    doc: inv,
    settings: s,
    meta: [
      `Émis${isCredit ? '' : 'e'} le ${formatDate(inv.issue_date)}`,
      !isCredit && `Échéance le ${formatDate(inv.due_date)}`,
      origin && `Sur la facture ${origin.number}`,
    ],
    toLabel: isCredit ? 'Client' : 'Facturé à',
    footParts: [!isCredit && s.payment_details && `Paiement : ${s.payment_details}`, inv.note, s.legal_footer],
  });

  const side = isCredit
    ? h('aside', { class: 'stack' },
      h('section', { class: 'card' },
        h('h2', {}, 'Avoir'),
        h('p', { class: 'muted' }, 'Cet avoir réduit ce que le client doit sur la facture d’origine.'),
        origin && h('button', { type: 'button', class: 'btn', onclick: () => openInvoice('detail', origin.id) }, `Voir la facture ${origin.number}`)))
    : h('aside', { class: 'stack' },
      h('section', { class: 'card' },
        h('h2', {}, 'Paiement'),
        h('div', { class: 'line' }, h('span', { class: 'muted' }, 'Reste à payer'), h('strong', { class: 'num' }, money(Math.max(inv.remaining, 0)))),
        h('div', { class: 'line' }, h('span', { class: 'muted' }, 'Déjà réglé'), h('span', { class: 'num' }, money(inv.paid))),
        inv.credited > 0 && h('div', { class: 'line' }, h('span', { class: 'muted' }, 'Avoirs'), h('span', { class: 'num' }, money(inv.credited))),
        inv.remaining < 0 && h('p', { class: 'error' }, `Trop-perçu à rembourser au client : ${money(-inv.remaining)}`),
        inv.remaining > 0 && h('button', { type: 'button', class: 'btn primary', onclick: pay }, 'Enregistrer un paiement')),
      inv.payments.length > 0 && h('section', { class: 'card' },
        h('h2', {}, 'Paiements reçus'),
        h('ul', { class: 'payments' }, inv.payments.map((p) => h('li', {},
          h('span', {}, h('span', { class: 'strong' }, formatDate(p.paid_on)), p.method ? ` · ${p.method}` : ''),
          h('span', { class: 'num' }, money(p.amount)))))),
      inv.display_status !== 'annulee' && h('section', { class: 'card' },
        h('h2', {}, 'Corriger cette facture'),
        h('p', { class: 'muted' }, 'Une facture émise ne se modifie pas. Pour l’annuler ou la corriger, créez un avoir.'),
        h('button', { type: 'button', class: 'btn', onclick: credit }, 'Créer un avoir')));

  return [
    h('header', { class: 'page-head' },
      h('div', {},
        h('button', { type: 'button', class: 'btn link back', onclick: () => openInvoice('list', null) }, '← Retour aux factures'),
        h('div', { class: 'row' }, h('h1', {}, inv.number), statusChip(inv.display_status))),
      documentActions('facture', inv.id)),
    h('div', { class: 'split' }, h('div', { class: 'grow' }, paper), side),
  ];
}
