'use strict';
// Interface : menu latéral et écrans Clients, Produits et services, Paramètres.

// --- Outils ---

// Crée un élément. Les textes sont toujours insérés comme du texte, jamais comme du HTML.
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value') el.value = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

async function call(name, ...args) {
  try {
    return await window.api.call(name, ...args);
  } catch (err) {
    // Electron ajoute un préfixe technique : on ne garde que le message utile.
    throw new Error(String(err.message).replace(/^Error invoking remote method 'api': (Error: )?/, ''));
  }
}

const money = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`;
const percent = (rate) => `${String(rate / 100).replace('.', ',')} %`;

let toastTimer;
function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

function field(label, name, value, opts = {}) {
  const id = `f-${name}`;
  const common = { id, name, required: opts.required, readonly: opts.readonly, placeholder: opts.placeholder };
  let input;
  if (opts.options) {
    input = h('select', common, opts.options.map(([v, text]) => h('option', { value: v, selected: String(v) === String(value) }, text)));
  } else if (opts.multiline) {
    input = h('textarea', { ...common, rows: 3 }, value ?? '');
  } else {
    input = h('input', { ...common, type: opts.type || 'text', min: opts.min, step: opts.step, value: value ?? '' });
  }
  return h('div', { class: 'field' }, h('label', { for: id }, label), input, opts.hint && h('span', { class: 'hint' }, opts.hint));
}

// Ouvre une fenêtre de saisie. onSubmit reçoit les valeurs ; s'il échoue, le message s'affiche dans la fenêtre.
function openForm({ title, fields, submitLabel = 'Enregistrer', onSubmit }) {
  const dialog = document.getElementById('dialog');
  const error = h('div', { class: 'error', role: 'alert' });
  const form = h('form', {
    onsubmit: async (event) => {
      event.preventDefault();
      error.textContent = '';
      try {
        await onSubmit(Object.fromEntries(new FormData(form)));
        dialog.close();
      } catch (err) {
        error.textContent = err.message;
      }
    },
  },
  h('h2', {}, title), error, fields,
  h('div', { class: 'dialog-actions' },
    h('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, 'Annuler'),
    h('button', { type: 'submit', class: 'btn primary' }, submitLabel)));
  dialog.replaceChildren(form);
  dialog.showModal();
}

function wholeNumber(text, label) {
  const n = Number(String(text).replace(/\s/g, '').replace(',', '.'));
  if (String(text).trim() === '' || !Number.isFinite(n) || n < 0) throw new Error(`${label} : saisissez un nombre positif.`);
  return n;
}

// --- Navigation ---

const SCREENS = [
  { id: 'dashboard', label: 'Tableau de bord', soon: true },
  { id: 'invoices', label: 'Factures', render: () => renderInvoicesScreen() },
  { id: 'quotes', label: 'Devis', render: () => renderQuotesScreen() },
  { id: 'clients', label: 'Clients', render: renderClients },
  { id: 'products', label: 'Produits et services', render: renderProducts },
  { id: 'settings', label: 'Paramètres', render: renderSettings },
];

const state = { quoteView: { mode: 'list', id: null }, quoteFilter: null, quoteSearch: '', invoiceView: { mode: 'list', id: null }, invoiceFilter: null, invoiceSearch: '', screen: 'clients', clientSearch: '', clientId: null, productSearch: '', productType: null };

function renderNav() {
  document.getElementById('nav').replaceChildren(...SCREENS.map((s) =>
    h('button', {
      type: 'button', class: 'nav-item', disabled: s.soon,
      'aria-current': s.id === state.screen ? 'page' : null,
      onclick: () => go(s.id),
    }, s.label, s.soon && h('span', { class: 'nav-soon' }, 'Bientôt'))));
}

async function go(screen) {
  state.screen = screen;
  state.invoiceView = { mode: 'list', id: null };
  state.quoteView = { mode: 'list', id: null };
  renderNav();
  await refresh();
  document.getElementById('view').focus();
}

async function refresh() {
  const view = document.getElementById('view');
  const screen = SCREENS.find((s) => s.id === state.screen);
  try {
    view.replaceChildren(...await screen.render());
  } catch (err) {
    view.replaceChildren(h('div', { class: 'error', role: 'alert' }, err.message));
  }
}

async function refreshBrand() {
  const s = await call('getSettings');
  document.getElementById('brand-company').textContent = s.company_name || 'Entreprise à renseigner';
}

// Recherche : redessine la liste puis rend le curseur au champ.
function searchBox(id, label, placeholder, value, onChange) {
  return h('div', { class: 'search' },
    h('input', {
      id, type: 'search', 'aria-label': label, placeholder, value,
      oninput: async (event) => {
        onChange(event.target.value);
        await refresh();
        const input = document.getElementById(id);
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      },
    }));
}

// --- Clients ---

function clientFields(c = {}, settings = {}) {
  return [
    field('Nom du client', 'name', c.name, { required: true }),
    h('div', { class: 'grid' },
      field('Personne à contacter', 'contact', c.contact),
      field('Téléphone', 'phone', c.phone)),
    h('div', { class: 'grid' },
      field('E-mail', 'email', c.email, { type: 'email' }),
      field('NINEA', 'ninea', c.ninea)),
    field('Adresse de facturation', 'address', c.address, { multiline: true }),
    field('Délai de paiement (jours)', 'payment_days', c.payment_days ?? settings.default_payment_days ?? 30, { type: 'number', min: 0, step: 1 }),
  ];
}

function clientData(values) {
  return { ...values, payment_days: Math.round(wholeNumber(values.payment_days, 'Délai de paiement')) };
}

async function renderClients() {
  const clients = await call('listClients', { search: state.clientSearch });
  const selected = clients.find((c) => c.id === state.clientId) || clients[0] || null;
  state.clientId = selected ? selected.id : null;

  const newClient = async () => {
    const settings = await call('getSettings');
    openForm({
      title: 'Nouveau client',
      fields: clientFields({}, settings),
      onSubmit: async (values) => {
        const created = await call('createClient', clientData(values));
        state.clientId = created.id;
        state.clientSearch = '';
        toast('Client ajouté.');
        await refresh();
      },
    });
  };

  const editClient = () => openForm({
    title: 'Modifier le client',
    fields: clientFields(selected),
    onSubmit: async (values) => {
      await call('updateClient', selected.id, clientData(values));
      toast('Client modifié.');
      await refresh();
    },
  });

  const archive = async () => {
    await call('archiveClient', selected.id);
    state.clientId = null;
    toast('Client archivé.');
    await refresh();
  };

  const list = clients.length === 0
    ? h('p', { class: 'empty' }, state.clientSearch ? 'Aucun client ne correspond à cette recherche.' : 'Aucun client pour le moment. Ajoutez le premier avec « Nouveau client ».')
    : h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Client'),
        h('th', { scope: 'col', class: 'num' }, 'Factures'),
        h('th', { scope: 'col', class: 'num' }, 'Total facturé'),
        h('th', { scope: 'col', class: 'num' }, 'Reste dû'))),
      h('tbody', {}, clients.map((c) => h('tr', { class: c.id === state.clientId ? 'selected' : null },
        h('td', {}, h('button', {
          type: 'button', class: 'btn link', 'aria-pressed': String(c.id === state.clientId),
          onclick: async () => { state.clientId = c.id; await refresh(); },
        }, c.name)),
        h('td', { class: 'num' }, c.invoice_count),
        h('td', { class: 'num' }, money(c.total_billed)),
        h('td', { class: 'num strong' }, money(c.balance_due)))))));

  const detail = selected && h('aside', { class: 'card', 'aria-label': 'Fiche du client' },
    h('h2', {}, selected.name),
    h('dl', { class: 'facts' },
      h('dt', {}, 'Contact'), h('dd', {}, selected.contact || '—'),
      h('dt', {}, 'Téléphone'), h('dd', {}, selected.phone || '—'),
      h('dt', {}, 'E-mail'), h('dd', {}, selected.email || '—'),
      h('dt', {}, 'Adresse'), h('dd', {}, selected.address || '—'),
      h('dt', {}, 'NINEA'), h('dd', {}, selected.ninea || '—'),
      h('dt', {}, 'Délai habituel'), h('dd', {}, `${selected.payment_days} jours`)),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Total facturé'), h('b', {}, money(selected.total_billed))),
      h('div', { class: 'stat' }, h('span', { class: 'muted' }, 'Reste dû'), h('b', {}, money(selected.balance_due)))),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn', onclick: editClient }, 'Modifier'),
      h('button', { type: 'button', class: 'btn', onclick: archive }, 'Archiver')));

  return [
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Clients'), h('span', { class: 'muted' }, `${clients.length} client${clients.length > 1 ? 's' : ''}`)),
      h('button', { type: 'button', class: 'btn primary', onclick: newClient }, '+ Nouveau client')),
    h('div', { class: 'split' },
      h('section', { class: 'card grow' },
        searchBox('client-search', 'Rechercher un client', 'Nom du client', state.clientSearch, (v) => { state.clientSearch = v; }),
        list),
      detail),
  ];
}

// --- Produits et services ---

function productFields(p = {}, settings = {}) {
  return [
    field('Désignation', 'name', p.name, { required: true }),
    h('div', { class: 'grid' },
      field('Type', 'type', p.type || 'service', { options: [['service', 'Service'], ['produit', 'Produit']] }),
      field('Unité', 'unit', p.unit, { placeholder: 'heure, forfait, pièce…' })),
    h('div', { class: 'grid' },
      field('Prix unitaire HT (FCFA)', 'price_ht', p.price_ht, { type: 'number', min: 0, step: 1, required: true }),
      field('TVA (%)', 'vat_rate', (p.vat_rate ?? Number(settings.default_vat_rate ?? 1800)) / 100, { type: 'number', min: 0, step: 0.01 })),
  ];
}

function productData(values) {
  return {
    ...values,
    price_ht: Math.round(wholeNumber(values.price_ht, 'Prix unitaire')),
    vat_rate: Math.round(wholeNumber(values.vat_rate, 'TVA') * 100),
  };
}

async function renderProducts() {
  const products = await call('listProducts', { search: state.productSearch, type: state.productType });

  const newProduct = async () => {
    const settings = await call('getSettings');
    openForm({
      title: 'Nouvel article',
      fields: productFields({}, settings),
      onSubmit: async (values) => {
        await call('createProduct', productData(values));
        toast('Article ajouté.');
        await refresh();
      },
    });
  };

  const editProduct = (p) => openForm({
    title: 'Modifier l’article',
    fields: productFields(p),
    onSubmit: async (values) => {
      await call('updateProduct', p.id, productData(values));
      toast('Article modifié.');
      await refresh();
    },
  });

  const archive = async (p) => {
    await call('archiveProduct', p.id);
    toast('Article archivé.');
    await refresh();
  };

  const chips = [[null, 'Tous'], ['service', 'Services'], ['produit', 'Produits']].map(([type, label]) =>
    h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(state.productType === type),
      onclick: async () => { state.productType = type; await refresh(); },
    }, label));

  const filtered = state.productSearch || state.productType;
  const list = products.length === 0
    ? h('p', { class: 'empty' }, filtered ? 'Aucun article ne correspond.' : 'Le catalogue est vide. Ajoutez le premier article avec « Nouvel article ».')
    : h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Désignation'),
        h('th', { scope: 'col' }, 'Type'),
        h('th', { scope: 'col' }, 'Unité'),
        h('th', { scope: 'col', class: 'num' }, 'Prix unitaire HT'),
        h('th', { scope: 'col', class: 'num' }, 'TVA'),
        h('th', { scope: 'col', class: 'num' }, 'Actions'))),
      h('tbody', {}, products.map((p) => h('tr', {},
        h('td', { class: 'strong' }, p.name),
        h('td', {}, h('span', { class: 'tag' }, p.type === 'service' ? 'Service' : 'Produit')),
        h('td', { class: 'muted' }, p.unit || '—'),
        h('td', { class: 'num strong' }, money(p.price_ht)),
        h('td', { class: 'num muted' }, percent(p.vat_rate)),
        h('td', { class: 'num' }, h('div', { class: 'row', style: null },
          h('button', { type: 'button', class: 'btn small', 'aria-label': `Modifier ${p.name}`, onclick: () => editProduct(p) }, 'Modifier'),
          h('button', { type: 'button', class: 'btn small', 'aria-label': `Archiver ${p.name}`, onclick: () => archive(p) }, 'Archiver'))))))));

  return [
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Produits et services'), h('span', { class: 'muted' }, 'Le catalogue sert à remplir une facture en un clic.')),
      h('button', { type: 'button', class: 'btn primary', onclick: newProduct }, '+ Nouvel article')),
    h('div', { class: 'toolbar' },
      h('div', { class: 'row', role: 'group', 'aria-label': 'Filtrer par type' }, chips),
      searchBox('product-search', 'Rechercher un article', 'Désignation', state.productSearch, (v) => { state.productSearch = v; })),
    h('section', { class: 'card flush' }, list),
    h('p', { class: 'muted' }, 'Changer un prix ici ne modifie pas les factures déjà émises.'),
  ];
}

// --- Paramètres ---

async function renderSettings() {
  const s = await call('getSettings');
  const year = new Date().getFullYear();
  const nextNumber = `${s.invoice_prefix}-${year}-${String(s.next_invoice_seq).padStart(4, '0')}`;
  const error = h('div', { class: 'error', role: 'alert' });

  const form = h('form', {
    id: 'settings-form',
    onsubmit: async (event) => {
      event.preventDefault();
      error.textContent = '';
      try {
        const v = Object.fromEntries(new FormData(form));
        delete v.next_number;
        v.default_vat_rate = Math.round(wholeNumber(v.default_vat_rate, 'TVA par défaut') * 100);
        v.default_payment_days = Math.round(wholeNumber(v.default_payment_days, 'Délai de paiement'));
        v.quote_validity_days = Math.round(wholeNumber(v.quote_validity_days, 'Validité des devis'));
        if (!v.invoice_prefix.trim()) throw new Error('Le préfixe des factures est obligatoire.');
        if (!v.quote_prefix.trim()) throw new Error('Le préfixe des devis est obligatoire.');
        await call('updateSettings', v);
        await refreshBrand();
        toast('Paramètres enregistrés.');
        await refresh();
      } catch (err) {
        error.textContent = err.message;
        error.scrollIntoView({ block: 'center' });
      }
    },
    style: null,
  },
  error,
  h('section', { class: 'card narrow' },
    h('h2', {}, 'Votre entreprise'),
    h('div', { class: 'grid' },
      field('Nom de l’entreprise', 'company_name', s.company_name),
      field('Téléphone', 'company_phone', s.company_phone)),
    h('div', { class: 'grid' },
      field('NINEA', 'company_ninea', s.company_ninea),
      field('RCCM', 'company_rccm', s.company_rccm)),
    field('Adresse', 'company_address', s.company_address, { multiline: true }),
    field('E-mail affiché sur les factures', 'company_email', s.company_email, { type: 'email' })),
  h('section', { class: 'card narrow' },
    h('h2', {}, 'Facturation'),
    h('div', { class: 'grid' },
      field('Préfixe des factures', 'invoice_prefix', s.invoice_prefix),
      field('Prochain numéro', 'next_number', nextNumber, { readonly: true, hint: 'Automatique et continu : ne se modifie pas à la main.' })),
    h('div', { class: 'grid' },
      field('TVA par défaut (%)', 'default_vat_rate', Number(s.default_vat_rate) / 100, { type: 'number', min: 0, step: 0.01 }),
      field('Délai de paiement (jours)', 'default_payment_days', s.default_payment_days, { type: 'number', min: 0, step: 1 })),
    h('div', { class: 'grid' },
      field('Préfixe des devis', 'quote_prefix', s.quote_prefix),
      field('Validité des devis (jours)', 'quote_validity_days', s.quote_validity_days, { type: 'number', min: 0, step: 1 }))),
  h('section', { class: 'card narrow' },
    h('h2', {}, 'Paiement et mentions'),
    field('Coordonnées de paiement', 'payment_details', s.payment_details, { multiline: true, hint: 'Compte bancaire, Wave, Orange Money…' }),
    field('Mentions légales en pied de facture', 'legal_footer', s.legal_footer, { multiline: true })));

  form.style.display = 'flex';
  form.style.flexDirection = 'column';
  form.style.gap = '20px';

  return [
    h('header', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Paramètres'), h('span', { class: 'muted' }, 'Ces informations apparaissent sur chaque facture et chaque devis.')),
      h('button', { type: 'submit', form: 'settings-form', class: 'btn primary' }, 'Enregistrer')),
    form,
  ];
}

// --- Démarrage ---

(async () => {
  await refreshBrand();
  await go('clients');
})();
