'use strict';
// Écrans des factures : liste, saisie d'un brouillon, détail d'une facture émise.
// Les outils (h, call, money, openForm, toast, state, refresh…) viennent de app.js.

const STATUS_LABELS = {
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
  const [clients, products, settings] = await Promise.all([call('listClients'), call('listProducts'), call('getSettings')]);
  const inv = id ? await call('getInvoice', id) : null;
  const isCredit = inv && inv.kind === 'avoir';
  const noun = isCredit ? 'l’avoir' : 'la facture';
  const back = h('button', { type: 'button', class: 'btn link back', onclick: () => openInvoice('list', null) }, '← Retour aux factures');

  if (clients.length === 0 && !inv) {
    return [back, h('h1', {}, 'Nouvelle facture'),
      h('section', { class: 'card narrow' },
        h('p', {}, 'Il faut au moins un client pour créer une facture.'),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: () => go('clients') }, 'Ajouter un client')))];
  }

  const defaultVat = String(Number(settings.default_vat_rate) / 100).replace('.', ',');
  const blank = () => ({ description: '', quantity: '1', unit_price_ht: '', vat_rate: defaultVat });
  const lines = inv && inv.lines.length
    ? inv.lines.map((l) => ({ description: l.description, quantity: quantityText(l.quantity), unit_price_ht: String(l.unit_price_ht), vat_rate: String(l.vat_rate / 100).replace('.', ',') }))
    : [blank()];

  const error = h('div', { class: 'error', role: 'alert' });
  const tbody = h('tbody', {});
  const outHt = h('span', { class: 'num' });
  const outVat = h('span', { class: 'num' });
  const outTtc = h('span', { class: 'total' });
  const clientSelect = h('select', { id: 'f-client', disabled: isCredit },
    clients.map((c) => h('option', { value: c.id, selected: inv ? c.id === inv.client_id : false }, c.name)));
  const note = h('textarea', { id: 'f-note', rows: 3 }, inv ? inv.note : '');

  // Même calcul que dans le cœur du logiciel : TVA par taux, arrondie au franc.
  const amounts = (l) => {
    const q = Math.round(parseNumber(l.quantity) * 1000) || 0;
    const p = Math.round(parseNumber(l.unit_price_ht)) || 0;
    const v = Math.round(parseNumber(l.vat_rate) * 100) || 0;
    return { q, p, v, total: Math.round((q * p) / 1000) };
  };

  const updateTotals = () => {
    error.textContent = '';
    const byRate = new Map();
    let ht = 0;
    lines.forEach((l, i) => {
      const a = amounts(l);
      ht += a.total;
      byRate.set(a.v, (byRate.get(a.v) || 0) + a.total);
      const cell = tbody.children[i] && tbody.children[i].querySelector('.line-total');
      if (cell) cell.textContent = money(a.total);
    });
    let vat = 0;
    for (const [rate, base] of byRate) vat += Math.round((base * rate) / 10000);
    outHt.textContent = money(ht);
    outVat.textContent = money(vat);
    outTtc.textContent = money(ht + vat);
  };

  const cellInput = (line, key, label, attrs = {}) => h('input', {
    type: 'text', 'aria-label': label, value: line[key], ...attrs,
    oninput: (event) => { line[key] = event.target.value; updateTotals(); },
  });

  const rebuild = (focusLast = false) => {
    tbody.replaceChildren(...lines.map((line, i) => h('tr', {},
      h('td', {}, cellInput(line, 'description', 'Désignation')),
      h('td', {}, cellInput(line, 'quantity', 'Quantité', { inputmode: 'decimal', class: 'num' })),
      h('td', {}, cellInput(line, 'unit_price_ht', 'Prix unitaire hors taxes', { inputmode: 'numeric', class: 'num' })),
      h('td', {}, cellInput(line, 'vat_rate', 'TVA en pour cent', { inputmode: 'decimal', class: 'num' })),
      h('td', { class: 'num strong line-total' }),
      h('td', { class: 'num' }, h('button', {
        type: 'button', class: 'btn icon', 'aria-label': `Supprimer la ligne ${i + 1}`, title: 'Supprimer la ligne',
        onclick: () => { lines.splice(i, 1); if (lines.length === 0) lines.push(blank()); rebuild(); },
      }, '×')))));
    updateTotals();
    if (focusLast) tbody.lastElementChild.querySelector('input').focus();
  };

  const catalog = h('select', {
    'aria-label': 'Ajouter un article du catalogue',
    onchange: (event) => {
      const p = products.find((x) => String(x.id) === event.target.value);
      event.target.value = '';
      if (!p) return;
      const line = { description: p.name, quantity: '1', unit_price_ht: String(p.price_ht), vat_rate: String(p.vat_rate / 100).replace('.', ',') };
      const last = lines[lines.length - 1];
      if (last && !last.description.trim() && !last.unit_price_ht.trim()) lines[lines.length - 1] = line; else lines.push(line);
      rebuild();
    },
  }, h('option', { value: '' }, 'Ajouter depuis le catalogue…'), products.map((p) => h('option', { value: p.id }, `${p.name} — ${money(p.price_ht)}`)));

  // Vérifie la saisie et prépare les lignes au format du cœur (millièmes, centièmes de %).
  const collect = () => {
    const filled = lines.filter((l) => l.description.trim() || l.unit_price_ht.trim());
    const out = filled.map((l, i) => {
      const n = i + 1;
      const q = parseNumber(l.quantity);
      const p = parseNumber(l.unit_price_ht);
      const v = parseNumber(l.vat_rate);
      if (!l.description.trim()) throw new Error(`Ligne ${n} : la désignation est obligatoire.`);
      if (!(q > 0)) throw new Error(`Ligne ${n} : la quantité doit être supérieure à zéro.`);
      if (!(p >= 0) || l.unit_price_ht.trim() === '') throw new Error(`Ligne ${n} : le prix unitaire est obligatoire.`);
      if (!(v >= 0)) throw new Error(`Ligne ${n} : le taux de TVA est invalide.`);
      return { description: l.description.trim(), quantity: Math.round(q * 1000), unit_price_ht: Math.round(p), vat_rate: Math.round(v * 100) };
    });
    return { client_id: Number(clientSelect.value), lines: out, note: note.value };
  };

  let currentId = id;
  const save = async () => {
    const data = collect();
    const saved = currentId ? await call('updateDraft', currentId, data) : await call('createDraft', data);
    currentId = saved.id;
    state.invoiceView = { mode: 'edit', id: saved.id };
    return saved;
  };
  const guard = (fn) => async () => {
    error.textContent = '';
    try { await fn(); } catch (err) { error.textContent = err.message; error.scrollIntoView({ block: 'center' }); }
  };

  const saveDraft = guard(async () => { await save(); toast('Brouillon enregistré.'); await refresh(); });

  const issue = guard(async () => {
    const saved = await save();
    if (saved.lines.length === 0) throw new Error(`Ajoutez au moins une ligne avant d’émettre ${noun}.`);
    openForm({
      title: isCredit ? 'Émettre l’avoir' : 'Émettre la facture',
      submitLabel: 'Émettre définitivement',
      fields: [
        h('p', {}, `Total : ${money(saved.total_ttc)}. Après l’émission, ${noun} reçoit son numéro et ne peut plus être modifié${isCredit ? '' : 'e'} ni supprimé${isCredit ? '' : 'e'}.`),
        field('Date d’émission', 'issue_date', todayIso(), { type: 'date', required: true }),
      ],
      onSubmit: async (values) => {
        const issued = await call('issueInvoice', saved.id, { issue_date: values.issue_date });
        toast(`${issued.number} émis${isCredit ? '' : 'e'}.`);
        await openInvoice('detail', issued.id);
      },
    });
  });

  const remove = guard(async () => {
    await call('deleteDraft', currentId);
    toast('Brouillon supprimé.');
    await openInvoice('list', null);
  });

  rebuild();

  return [
    h('header', { class: 'page-head' },
      h('div', {}, back,
        h('h1', {}, isCredit ? 'Avoir (brouillon)' : inv ? 'Facture (brouillon)' : 'Nouvelle facture'),
        h('span', { class: 'muted' }, 'Le numéro est attribué à l’émission. Un brouillon reste modifiable.'))),
    error,
    h('div', { class: 'split' },
      h('div', { class: 'grow stack' },
        h('section', { class: 'card' },
          h('h2', {}, '1. Client'),
          h('div', { class: 'field' }, h('label', { for: 'f-client' }, 'Client'), clientSelect,
            isCredit && h('span', { class: 'hint' }, 'Le client d’un avoir est celui de la facture d’origine.'))),
        h('section', { class: 'card' },
          h('h2', {}, '2. Lignes'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'lines' },
            h('thead', {}, h('tr', {},
              h('th', { scope: 'col' }, 'Désignation'),
              h('th', { scope: 'col', class: 'num w-qty' }, 'Quantité'),
              h('th', { scope: 'col', class: 'num w-price' }, 'Prix unitaire HT'),
              h('th', { scope: 'col', class: 'num w-vat' }, 'TVA %'),
              h('th', { scope: 'col', class: 'num w-total' }, 'Total HT'),
              h('th', { scope: 'col', class: 'w-act' }, h('span', { class: 'sr-only' }, 'Actions')))),
            tbody)),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn', onclick: () => { lines.push(blank()); rebuild(true); } }, '+ Ajouter une ligne'),
            products.length > 0 && h('div', { class: 'catalog' }, catalog))),
        h('section', { class: 'card' },
          h('h2', {}, '3. Note au client'),
          h('div', { class: 'field' }, h('label', { for: 'f-note' }, 'Facultatif. S’affiche en bas du document.'), note))),
      h('aside', { class: 'card', 'aria-label': 'Récapitulatif' },
        h('h2', {}, 'Récapitulatif'),
        h('div', { class: 'line' }, h('span', { class: 'muted' }, 'Total HT'), outHt),
        h('div', { class: 'line' }, h('span', { class: 'muted' }, 'TVA'), outVat),
        h('div', { class: 'line top' }, h('span', { class: 'strong' }, 'Total TTC'), outTtc),
        h('button', { type: 'button', class: 'btn primary', onclick: issue }, isCredit ? 'Émettre l’avoir' : 'Émettre la facture'),
        h('button', { type: 'button', class: 'btn', onclick: saveDraft }, 'Enregistrer le brouillon'),
        inv && h('button', { type: 'button', class: 'btn', onclick: remove }, 'Supprimer le brouillon'))),
  ];
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

  const cleanError = (err) => String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  const exportPdf = async () => {
    try {
      const filePath = await window.api.exportInvoicePdf(inv.id);
      if (!filePath) return;
      const el = document.getElementById('toast');
      toast('PDF enregistré.');
      el.append(' ', h('button', { type: 'button', class: 'toast-action', onclick: () => window.api.showFile(filePath) }, 'Ouvrir le dossier'));
    } catch (err) { toast(cleanError(err)); }
  };

  const print = async () => {
    try {
      if (await window.api.printInvoice(inv.id)) toast('Document envoyé à l\u2019imprimante.');
    } catch (err) { toast(cleanError(err)); }
  };

  const paper = h('section', { class: 'paper', 'aria-label': 'Aperçu du document' },
    h('div', { class: 'paper-head' },
      h('div', { class: 'stack-s' },
        h('strong', {}, s.company_name || '[Nom de l’entreprise à renseigner dans les paramètres]'),
        s.company_address && h('span', { class: 'muted pre' }, s.company_address),
        (s.company_ninea || s.company_rccm) && h('span', { class: 'muted' },
          [s.company_ninea && `NINEA : ${s.company_ninea}`, s.company_rccm && `RCCM : ${s.company_rccm}`].filter(Boolean).join(' · ')),
        (s.company_phone || s.company_email) && h('span', { class: 'muted' }, [s.company_phone, s.company_email].filter(Boolean).join(' · '))),
      h('div', { class: 'stack-s right' },
        h('span', { class: 'paper-title' }, isCredit ? 'Avoir' : 'Facture'),
        h('span', {}, `N° ${inv.number}`),
        h('span', { class: 'muted' }, `Émis${isCredit ? '' : 'e'} le ${formatDate(inv.issue_date)}`),
        !isCredit && h('span', { class: 'muted' }, `Échéance le ${formatDate(inv.due_date)}`),
        origin && h('span', { class: 'muted' }, `Sur la facture ${origin.number}`))),
    h('div', { class: 'stack-s' },
      h('span', { class: 'muted small' }, isCredit ? 'Client' : 'Facturé à'),
      h('strong', {}, inv.client_name),
      inv.client_address && h('span', { class: 'muted pre' }, inv.client_address),
      inv.client_ninea && h('span', { class: 'muted' }, `NINEA : ${inv.client_ninea}`)),
    h('div', { class: 'table-wrap' }, h('table', { class: 'paper-lines' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Désignation'),
        h('th', { scope: 'col', class: 'num' }, 'Qté'),
        h('th', { scope: 'col', class: 'num' }, 'Prix unitaire HT'),
        h('th', { scope: 'col', class: 'num' }, 'TVA'),
        h('th', { scope: 'col', class: 'num' }, 'Total HT'))),
      h('tbody', {}, inv.lines.map((l) => h('tr', {},
        h('td', {}, l.description),
        h('td', { class: 'num' }, quantityText(l.quantity)),
        h('td', { class: 'num' }, money(l.unit_price_ht)),
        h('td', { class: 'num' }, percent(l.vat_rate)),
        h('td', { class: 'num' }, money(l.total_ht))))))),
    h('div', { class: 'paper-totals' },
      h('div', { class: 'line' }, h('span', { class: 'muted' }, 'Total HT'), h('span', { class: 'num' }, money(inv.total_ht))),
      h('div', { class: 'line' }, h('span', { class: 'muted' }, 'TVA'), h('span', { class: 'num' }, money(inv.total_vat))),
      h('div', { class: 'line top' }, h('span', { class: 'strong' }, 'Total TTC'), h('span', { class: 'total' }, money(inv.total_ttc)))),
    h('div', { class: 'paper-foot muted' },
      s.payment_details && !isCredit && h('span', { class: 'pre' }, `Paiement : ${s.payment_details}`),
      inv.note && h('span', { class: 'pre' }, inv.note),
      s.legal_footer && h('span', { class: 'pre' }, s.legal_footer)));

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
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', onclick: exportPdf }, 'Enregistrer en PDF'),
        h('button', { type: 'button', class: 'btn', onclick: print }, 'Imprimer'))),
    h('div', { class: 'split' }, h('div', { class: 'grow' }, paper), side),
  ];
}
