'use strict';
// Construit la page A4 d'une facture ou d'un avoir, utilisée pour le PDF et l'impression.
// Tout texte saisi par l'utilisateur est échappé avant d'être inséré.

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const money = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`;
const percent = (rate) => `${String(rate / 100).replace('.', ',')} %`;
const quantity = (q) => String(q / 1000).replace('.', ',');

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function longDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d === 1 ? '1er' : d} ${MONTHS[m - 1]} ${y}`;
}

const lines = (...parts) => parts.filter(Boolean).map((p) => `<div>${p}</div>`).join('');

const STYLE = `
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #131722; font: 10.5pt/1.45 "Segoe UI", system-ui, sans-serif; }
  .muted { color: #586172; }
  .pre { white-space: pre-line; }
  .head { display: flex; justify-content: space-between; gap: 12mm; }
  .head .right { text-align: right; }
  .company { font-size: 13pt; font-weight: 600; }
  .title { font-size: 22pt; font-weight: 600; line-height: 1.1; margin-bottom: 2mm; }
  .to { margin: 12mm 0 10mm; }
  .to .label { font-size: 9pt; color: #586172; }
  .to .name { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { padding: 2.5mm 2mm; border-bottom: 1px solid #131722; color: #586172; font-size: 9pt; font-weight: 500; text-align: left; }
  td { padding: 3mm 2mm; border-bottom: 1px solid #E3E6EB; vertical-align: top; }
  th:first-child, td:first-child { padding-left: 0; }
  th:last-child, td:last-child { padding-right: 0; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  tr { break-inside: avoid; }
  .totals { margin: 8mm 0 0 auto; width: 78mm; break-inside: avoid; }
  .totals div { display: flex; justify-content: space-between; padding: 1.2mm 0; }
  .totals .ttc { margin-top: 1.5mm; padding-top: 3mm; border-top: 1px solid #131722; font-size: 14pt; font-weight: 600; }
  .foot { margin-top: 12mm; padding-top: 4mm; border-top: 1px solid #E3E6EB; font-size: 9pt; color: #586172; break-inside: avoid; }
  .foot div + div { margin-top: 2mm; }
`;

// Mise en page commune aux factures, avoirs et devis.
function renderDocument({ title, doc, settings, meta, toLabel, footParts }) {
  const s = settings;
  const ids = [s.company_ninea && `NINEA : ${esc(s.company_ninea)}`, s.company_rccm && `RCCM : ${esc(s.company_rccm)}`].filter(Boolean).join(' · ');
  const contact = [s.company_phone, s.company_email].filter(Boolean).map(esc).join(' · ');

  const rows = doc.lines.map((l) => `<tr>
    <td>${esc(l.description)}</td>
    <td class="num">${quantity(l.quantity)}</td>
    <td class="num">${money(l.unit_price_ht)}</td>
    <td class="num">${percent(l.vat_rate)}</td>
    <td class="num">${money(l.total_ht)}</td></tr>`).join('');

  const foot = lines(...footParts.map((text) => text && `<span class="pre">${esc(text)}</span>`));

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${esc(doc.number)}</title><style>${STYLE}</style></head>
<body>
  <div class="head">
    <div>
      <div class="company">${esc(s.company_name)}</div>
      ${lines(s.company_address && `<span class="muted pre">${esc(s.company_address)}</span>`,
    ids && `<span class="muted">${ids}</span>`,
    contact && `<span class="muted">${contact}</span>`)}
    </div>
    <div class="right">
      <div class="title">${esc(title)}</div>
      <div>N° ${esc(doc.number)}</div>
      ${lines(...meta.map((text) => text && `<span class="muted">${esc(text)}</span>`))}
    </div>
  </div>
  <div class="to">
    <div class="label">${esc(toLabel)}</div>
    <div class="name">${esc(doc.client_name)}</div>
    ${lines(doc.client_address && `<span class="muted pre">${esc(doc.client_address)}</span>`,
    doc.client_ninea && `<span class="muted">NINEA : ${esc(doc.client_ninea)}</span>`)}
  </div>
  <table>
    <thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">Prix unitaire HT</th><th class="num">TVA</th><th class="num">Total HT</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div><span class="muted">Total HT</span><span class="num">${money(doc.total_ht)}</span></div>
    <div><span class="muted">TVA</span><span class="num">${money(doc.total_vat)}</span></div>
    <div class="ttc"><span>Total TTC</span><span class="num">${money(doc.total_ttc)}</span></div>
  </div>
  ${foot ? `<div class="foot">${foot}</div>` : ''}
</body></html>`;
}

// inv : facture ou avoir émis, avec ses lignes. origin : facture d'origine d'un avoir.
function buildInvoiceHtml(inv, settings, origin = null) {
  if (inv.status !== 'emise') throw new Error('Seul un document émis peut être imprimé ou exporté en PDF.');
  const isCredit = inv.kind === 'avoir';
  return renderDocument({
    title: isCredit ? 'Avoir' : 'Facture',
    doc: inv,
    settings,
    meta: [
      `Date d’émission : ${longDate(inv.issue_date)}`,
      !isCredit && `Échéance : ${longDate(inv.due_date)}`,
      origin && `Sur la facture ${origin.number}`,
    ],
    toLabel: isCredit ? 'Client' : 'Facturé à',
    footParts: [
      !isCredit && settings.payment_details && `Paiement : ${settings.payment_details}`,
      inv.note,
      settings.legal_footer,
    ],
  });
}

function buildQuoteHtml(quote, settings) {
  if (quote.status === 'brouillon') throw new Error('Seul un devis finalisé peut être imprimé ou exporté en PDF.');
  return renderDocument({
    title: 'Devis',
    doc: quote,
    settings,
    meta: [`Date : ${longDate(quote.issue_date)}`, `Valable jusqu’au ${longDate(quote.valid_until)}`],
    toLabel: 'Adressé à',
    footParts: [quote.note, settings.legal_footer],
  });
}

module.exports = { buildInvoiceHtml, buildQuoteHtml, esc };
