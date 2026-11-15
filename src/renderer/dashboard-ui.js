'use strict';
// Tableau de bord : chiffres du mois, montant facturé par mois, factures à relancer.

async function openInvoiceFromDashboard(id) {
  state.screen = 'invoices';
  renderNav();
  await openInvoice('detail', id);
}

async function showInvoices(filter) {
  await go('invoices');
  state.invoiceFilter = filter;
  await refresh();
}

function statTile(label, amount, detail, alert = false) {
  return h('div', { class: 'card tile' },
    h('span', { class: 'muted' }, label),
    h('span', { class: 'tile-value' }, money(amount)),
    h('span', { class: alert ? 'tile-alert' : 'muted small' }, detail));
}

const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// Barres du montant facturé par mois. Survoler ou sélectionner une barre affiche son montant.
function monthlyChart(months) {
  const max = Math.max(...months.map((m) => m.total), 1);
  const readout = h('span', { class: 'muted', 'aria-live': 'polite' });
  const bars = [];
  const select = (index) => {
    const m = months[index];
    readout.replaceChildren(h('strong', { class: 'ink' }, `${m.label} ${m.year}`), ` · ${money(m.total)}`);
    bars.forEach((bar, i) => bar.classList.toggle('on', i === index));
  };
  months.forEach((m, i) => {
    const height = m.total > 0 ? Math.max(Math.round((m.total / max) * 160), 3) : 0;
    bars.push(h('button', {
      type: 'button', class: 'bar', 'aria-label': `${m.label} ${m.year} : ${money(m.total)}`,
      onmouseenter: () => select(i), onfocus: () => select(i),
    }, h('span', { style: { height: `${height}px` } })));
  });
  select(months.length - 1);
  return h('section', { class: 'card grow' },
    h('div', { class: 'line' }, h('h2', {}, 'Montant facturé par mois'), readout),
    h('div', { class: 'bars' }, bars),
    h('div', { class: 'bar-labels', 'aria-hidden': 'true' }, months.map((m) => h('span', {}, SHORT_MONTHS[Number(m.key.slice(5, 7)) - 1]))),
    h('p', { class: 'muted small' }, 'Factures émises, avoirs déduits, toutes taxes comprises.'));
}

async function renderDashboard() {
  const [d, invoices, clients] = await Promise.all([call('getDashboard'), call('listInvoices'), call('listClients')]);
  const recent = invoices.filter((r) => r.status === 'emise').slice(0, 5);

  const head = h('header', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Tableau de bord'), h('span', { class: 'muted' }, d.month_label)),
    h('button', {
      type: 'button', class: 'btn primary',
      onclick: async () => { await go('invoices'); await openInvoice('edit', null); },
    }, '+ Nouvelle facture'));

  if (invoices.length === 0) {
    return [head, h('section', { class: 'card narrow' },
      h('h2', {}, 'Pour bien démarrer'),
      h('ol', { class: 'steps' },
        h('li', {}, h('button', { type: 'button', class: 'btn link', onclick: () => go('settings') }, 'Renseignez votre entreprise'), ' : nom, NINEA, RCCM, coordonnées de paiement.'),
        h('li', {}, h('button', { type: 'button', class: 'btn link', onclick: () => go('clients') }, clients.length ? 'Vérifiez vos clients' : 'Ajoutez votre premier client'), '.'),
        h('li', {}, 'Créez votre première facture avec le bouton « Nouvelle facture ».')))];
  }

  const lateList = d.late_invoices.length === 0
    ? h('p', { class: 'muted' }, 'Aucune facture en retard.')
    : h('ul', { class: 'late-list' }, d.late_invoices.map((r) => h('li', {},
      h('div', { class: 'stack-s' },
        h('button', { type: 'button', class: 'btn link', onclick: () => openInvoiceFromDashboard(r.id) }, r.client_name),
        h('span', { class: 'muted small' }, `${r.number} · ${plural(r.days_late, 'jour', 'jours')} de retard`)),
      h('span', { class: 'num strong' }, money(r.remaining)))));

  return [
    head,
    h('section', { class: 'tiles', 'aria-label': 'Chiffres clés' },
      statTile('Facturé ce mois', d.billed.total, d.billed.count ? plural(d.billed.count, 'facture émise', 'factures émises') : 'Aucune facture émise'),
      statTile('Encaissé ce mois', d.collected.total, d.collected.count ? plural(d.collected.count, 'paiement reçu', 'paiements reçus') : 'Aucun paiement reçu'),
      statTile('En attente de paiement', d.pending.total, d.pending.count ? plural(d.pending.count, 'facture dans les délais', 'factures dans les délais') : 'Aucune facture en attente'),
      statTile('En retard', d.late.total, d.late.count ? `⚠ ${plural(d.late.count, 'facture à relancer', 'factures à relancer')}` : 'Aucune facture en retard', d.late.count > 0)),
    h('div', { class: 'split' },
      monthlyChart(d.months),
      h('aside', { class: 'card' },
        h('h2', {}, 'À relancer'),
        lateList,
        d.late.count > d.late_invoices.length && h('button', { type: 'button', class: 'btn', onclick: () => showInvoices('en_retard') }, 'Voir toutes les factures en retard'),
        d.open_quotes.count > 0 && h('p', { class: 'muted small quotes-note' },
          `${plural(d.open_quotes.count, 'devis attend', 'devis attendent')} une réponse, pour ${money(d.open_quotes.total)}.`))),
    h('section', { class: 'card' },
      h('div', { class: 'line' }, h('h2', {}, 'Dernières factures'),
        h('button', { type: 'button', class: 'btn link', onclick: () => go('invoices') }, 'Tout voir')),
      recent.length === 0
        ? h('p', { class: 'muted' }, 'Aucune facture émise pour le moment.')
        : h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {},
            h('th', { scope: 'col' }, 'Numéro'), h('th', { scope: 'col' }, 'Client'), h('th', { scope: 'col' }, 'Échéance'),
            h('th', { scope: 'col' }, 'Statut'), h('th', { scope: 'col', class: 'num' }, 'Montant TTC'))),
          h('tbody', {}, recent.map((r) => h('tr', {},
            h('td', {}, h('button', { type: 'button', class: 'btn link', onclick: () => openInvoiceFromDashboard(r.id) }, r.number)),
            h('td', {}, r.client_name),
            h('td', { class: 'muted' }, formatDate(r.due_date)),
            h('td', {}, statusChip(r.display_status)),
            h('td', { class: 'num strong' }, money(r.total_ttc)))))))),
  ];
}
