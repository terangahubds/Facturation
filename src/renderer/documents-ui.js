'use strict';
// Éléments communs aux factures et aux devis : saisie des lignes d'un brouillon,
// aperçu du document, boutons PDF et impression.

// Boutons « Enregistrer en PDF » et « Imprimer » pour un document finalisé.
function documentActions(kind, id) {
  const cleanError = (err) => String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  const exportPdf = async () => {
    try {
      const filePath = await window.api.exportPdf(kind, id);
      if (!filePath) return;
      toast('PDF enregistré.');
      document.getElementById('toast').append(' ',
        h('button', { type: 'button', class: 'toast-action', onclick: () => window.api.showFile(filePath) }, 'Ouvrir le dossier'));
    } catch (err) { toast(cleanError(err)); }
  };

  const print = async () => {
    try {
      if (await window.api.printDocument(kind, id)) toast('Document envoyé à l’imprimante.');
    } catch (err) { toast(cleanError(err)); }
  };

  return h('div', { class: 'row' },
    h('button', { type: 'button', class: 'btn', onclick: exportPdf }, 'Enregistrer en PDF'),
    h('button', { type: 'button', class: 'btn', onclick: print }, 'Imprimer'));
}

// Aperçu à l'écran d'un document finalisé (facture, avoir ou devis).
function documentPaper({ title, doc, settings, meta, toLabel, footParts }) {
  const s = settings;
  const foot = footParts.filter(Boolean);
  return h('section', { class: 'paper', 'aria-label': 'Aperçu du document' },
    h('div', { class: 'paper-head' },
      h('div', { class: 'stack-s' },
        h('strong', {}, s.company_name || '[Nom de l’entreprise à renseigner dans les paramètres]'),
        s.company_address && h('span', { class: 'muted pre' }, s.company_address),
        (s.company_ninea || s.company_rccm) && h('span', { class: 'muted' },
          [s.company_ninea && `NINEA : ${s.company_ninea}`, s.company_rccm && `RCCM : ${s.company_rccm}`].filter(Boolean).join(' · ')),
        (s.company_phone || s.company_email) && h('span', { class: 'muted' }, [s.company_phone, s.company_email].filter(Boolean).join(' · '))),
      h('div', { class: 'stack-s right' },
        h('span', { class: 'paper-title' }, title),
        h('span', {}, `N° ${doc.number}`),
        meta.filter(Boolean).map((text) => h('span', { class: 'muted' }, text)))),
    h('div', { class: 'stack-s' },
      h('span', { class: 'muted small' }, toLabel),
      h('strong', {}, doc.client_name),
      doc.client_address && h('span', { class: 'muted pre' }, doc.client_address),
      doc.client_ninea && h('span', { class: 'muted' }, `NINEA : ${doc.client_ninea}`)),
    h('div', { class: 'table-wrap' }, h('table', { class: 'paper-lines' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Désignation'),
        h('th', { scope: 'col', class: 'num' }, 'Qté'),
        h('th', { scope: 'col', class: 'num' }, 'Prix unitaire HT'),
        h('th', { scope: 'col', class: 'num' }, 'TVA'),
        h('th', { scope: 'col', class: 'num' }, 'Total HT'))),
      h('tbody', {}, doc.lines.map((l) => h('tr', {},
        h('td', {}, l.description),
        h('td', { class: 'num' }, quantityText(l.quantity)),
        h('td', { class: 'num' }, money(l.unit_price_ht)),
        h('td', { class: 'num' }, percent(l.vat_rate)),
        h('td', { class: 'num' }, money(l.total_ht))))))),
    h('div', { class: 'paper-totals' },
      h('div', { class: 'line' }, h('span', { class: 'muted' }, 'Total HT'), h('span', { class: 'num' }, money(doc.total_ht))),
      h('div', { class: 'line' }, h('span', { class: 'muted' }, 'TVA'), h('span', { class: 'num' }, money(doc.total_vat))),
      h('div', { class: 'line top' }, h('span', { class: 'strong' }, 'Total TTC'), h('span', { class: 'total' }, money(doc.total_ttc)))),
    foot.length > 0 && h('div', { class: 'paper-foot muted' }, foot.map((text) => h('span', { class: 'pre' }, text))));
}

// Écran de saisie d'un brouillon. cfg décrit le document (facture, avoir ou devis) :
// textes, opérations d'enregistrement et action principale (émettre ou finaliser).
async function renderDraftEditor(cfg) {
  const [clients, products, settings] = await Promise.all([call('listClients'), call('listProducts'), call('getSettings')]);
  const doc = cfg.doc;
  const back = h('button', { type: 'button', class: 'btn link back', onclick: cfg.goBack }, cfg.backLabel);

  if (clients.length === 0 && !doc) {
    return [back, h('h1', {}, cfg.title),
      h('section', { class: 'card narrow' },
        h('p', {}, 'Il faut au moins un client pour créer ce document.'),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onclick: () => go('clients') }, 'Ajouter un client')))];
  }

  const defaultVat = String(Number(settings.default_vat_rate) / 100).replace('.', ',');
  const blank = () => ({ description: '', quantity: '1', unit_price_ht: '', vat_rate: defaultVat });
  const lines = doc && doc.lines.length
    ? doc.lines.map((l) => ({ description: l.description, quantity: quantityText(l.quantity), unit_price_ht: String(l.unit_price_ht), vat_rate: String(l.vat_rate / 100).replace('.', ',') }))
    : [blank()];

  const error = h('div', { class: 'error', role: 'alert' });
  const tbody = h('tbody', {});
  const outHt = h('span', { class: 'num' });
  const outVat = h('span', { class: 'num' });
  const outTtc = h('span', { class: 'total' });
  const clientSelect = h('select', { id: 'f-client', disabled: cfg.clientLocked },
    clients.map((c) => h('option', { value: c.id, selected: doc ? c.id === doc.client_id : false }, c.name)));
  const note = h('textarea', { id: 'f-note', rows: 3 }, doc ? doc.note : '');

  // Même calcul que dans le cœur du logiciel : TVA par taux, arrondie au franc.
  const amounts = (l) => {
    const q = Math.round(parseNumber(l.quantity) * 1000) || 0;
    const p = Math.round(parseNumber(l.unit_price_ht)) || 0;
    const v = Math.round(parseNumber(l.vat_rate) * 100) || 0;
    return { v, total: Math.round((q * p) / 1000) };
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

  let currentId = doc ? doc.id : null;
  const save = async () => {
    const data = collect();
    const saved = currentId ? await cfg.update(currentId, data) : await cfg.create(data);
    currentId = saved.id;
    cfg.setView(saved.id);
    return saved;
  };
  const guard = (fn) => async () => {
    error.textContent = '';
    try { await fn(); } catch (err) { error.textContent = err.message; error.scrollIntoView({ block: 'center' }); }
  };

  const saveDraft = guard(async () => { await save(); toast('Brouillon enregistré.'); await refresh(); });
  const primary = guard(async () => {
    const saved = await save();
    if (saved.lines.length === 0) throw new Error(cfg.emptyError);
    cfg.primary(saved);
  });
  const remove = guard(async () => {
    await cfg.remove(currentId);
    toast('Brouillon supprimé.');
    await cfg.goBack();
  });

  rebuild();

  return [
    h('header', { class: 'page-head' },
      h('div', {}, back, h('h1', {}, cfg.title), h('span', { class: 'muted' }, cfg.hint))),
    error,
    h('div', { class: 'split' },
      h('div', { class: 'grow stack' },
        h('section', { class: 'card' },
          h('h2', {}, '1. Client'),
          h('div', { class: 'field' }, h('label', { for: 'f-client' }, 'Client'), clientSelect,
            cfg.clientLocked && h('span', { class: 'hint' }, cfg.clientLockedHint))),
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
        h('button', { type: 'button', class: 'btn primary', onclick: primary }, cfg.primaryLabel),
        h('button', { type: 'button', class: 'btn', onclick: saveDraft }, 'Enregistrer le brouillon'),
        doc && h('button', { type: 'button', class: 'btn', onclick: remove }, 'Supprimer le brouillon'))),
  ];
}
