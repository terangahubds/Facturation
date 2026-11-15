'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/core/db');
const cat = require('../src/core/catalog');
const inv = require('../src/core/invoices');
const { buildInvoiceHtml, buildQuoteHtml } = require('../src/core/document');
const quo = require('../src/core/quotes');
const { getDashboard } = require('../src/core/dashboard');

function setup() {
  const db = openDatabase(':memory:');
  const client = cat.createClient(db, { name: 'Cabinet Diallo', address: 'Dakar', ninea: '123', payment_days: 30 });
  return { db, client };
}

const LINES = [
  { description: 'Création du site vitrine', quantity: 1000, unit_price_ht: 700000, vat_rate: 1800 },
  { description: 'Formation (heure)', quantity: 4000, unit_price_ht: 45000, vat_rate: 1800 },
  { description: 'Hébergement annuel', quantity: 1000, unit_price_ht: 120000, vat_rate: 1800 },
];

test('paramètres par défaut pour le Sénégal', () => {
  const { db } = setup();
  const s = cat.getSettings(db);
  assert.equal(s.currency, 'FCFA');
  assert.equal(s.default_vat_rate, '1800');
  assert.throws(() => cat.updateSettings(db, { next_invoice_seq: 50 }), /ne se modifie pas/);
  assert.equal(cat.updateSettings(db, { company_name: 'Ma société' }).company_name, 'Ma société');
});

test('clients et produits : création, validation, archivage', () => {
  const { db, client } = setup();
  assert.throws(() => cat.createClient(db, { name: '  ' }), /obligatoire/);
  assert.equal(cat.updateClient(db, client.id, { phone: '77' }).phone, '77');
  const p = cat.createProduct(db, { name: 'Maintenance', price_ht: 60000, unit: 'mois' });
  assert.equal(p.vat_rate, 1800);
  assert.throws(() => cat.createProduct(db, { name: 'X', price_ht: -1 }), /entier positif/);
  cat.archiveProduct(db, p.id);
  assert.equal(cat.listProducts(db).length, 0);
  assert.equal(cat.listProducts(db, { includeArchived: true }).length, 1);
});

test('totaux en francs entiers avec TVA à 18 %', () => {
  assert.deepEqual(inv.computeTotals(LINES), { total_ht: 1000000, total_vat: 180000, total_ttc: 1180000 });
  // 1,5 unité à 333 F = 499,5 arrondi à 500 ; TVA 18 % de 500 = 90
  assert.deepEqual(
    inv.computeTotals([{ quantity: 1500, unit_price_ht: 333, vat_rate: 1800 }]),
    { total_ht: 500, total_vat: 90, total_ttc: 590 });
});

test('émission : numéros continus, client figé, facture non modifiable', () => {
  const { db, client } = setup();
  const d1 = inv.createDraft(db, { client_id: client.id, lines: LINES });
  assert.equal(d1.number, null);
  assert.equal(d1.display_status, 'brouillon');
  const f1 = inv.issueInvoice(db, d1.id, { issue_date: '2026-11-14' });
  assert.equal(f1.number, 'FAC-2026-0001');
  assert.equal(f1.due_date, '2026-12-14');
  assert.equal(f1.total_ttc, 1180000);

  const d2 = inv.createDraft(db, { client_id: client.id, lines: LINES.slice(0, 1) });
  const d3 = inv.createDraft(db, { client_id: client.id, lines: LINES.slice(0, 1) });
  inv.deleteDraft(db, d2.id); // supprimer un brouillon ne crée pas de trou
  assert.equal(inv.issueInvoice(db, d3.id, { issue_date: '2026-11-15' }).number, 'FAC-2026-0002');

  // la fiche du client change, la facture émise garde l'ancienne adresse
  cat.updateClient(db, client.id, { address: 'Thiès' });
  assert.equal(inv.getInvoice(db, f1.id).client_address, 'Dakar');

  assert.throws(() => inv.updateDraft(db, f1.id, { note: 'x' }), /ne peut plus être modifiée/);
  assert.throws(() => inv.deleteDraft(db, f1.id), /ne peut pas être supprimée/);
  assert.throws(() => inv.issueInvoice(db, f1.id), /déjà émise/);
  // même en contournant le code, la base refuse
  assert.throws(() => db.prepare('UPDATE invoices SET total_ttc = 1 WHERE id = ?').run(f1.id), /ne peut plus être modifiée/);
  assert.throws(() => db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(f1.id), /ne peut plus être modifiée/);
});

test('émission refusée sans ligne ou avec une date antérieure', () => {
  const { db, client } = setup();
  const empty = inv.createDraft(db, { client_id: client.id });
  assert.throws(() => inv.issueInvoice(db, empty.id), /au moins une ligne/);
  const a = inv.createDraft(db, { client_id: client.id, lines: LINES });
  inv.issueInvoice(db, a.id, { issue_date: '2026-11-14' });
  const b = inv.createDraft(db, { client_id: client.id, lines: LINES });
  assert.throws(() => inv.issueInvoice(db, b.id, { issue_date: '2026-11-01' }), /antérieure/);
  // l'échec n'a pas consommé de numéro
  assert.equal(inv.issueInvoice(db, b.id, { issue_date: '2026-11-14' }).number, 'FAC-2026-0002');
});

test('paiements : partiel, soldé, dépassement refusé', () => {
  const { db, client } = setup();
  const f = inv.issueInvoice(db, inv.createDraft(db, { client_id: client.id, lines: LINES }).id, { issue_date: '2026-11-14' });
  assert.throws(() => inv.recordPayment(db, f.id, { amount: 2000000 }), /dépasse/);
  const p1 = inv.recordPayment(db, f.id, { amount: 500000, paid_on: '2026-11-20', method: 'Wave' });
  assert.equal(p1.remaining, 680000);
  const p2 = inv.recordPayment(db, f.id, { amount: 680000, paid_on: '2026-11-25' });
  assert.equal(p2.display_status, 'payee');
  assert.equal(cat.listClients(db)[0].balance_due, 0);
  assert.equal(cat.listClients(db)[0].total_billed, 1180000);
});

test('retard et filtre par statut', () => {
  const { db, client } = setup();
  const f = inv.issueInvoice(db, inv.createDraft(db, { client_id: client.id, lines: LINES }).id, { issue_date: '2020-01-01' });
  assert.equal(f.display_status, 'en_retard');
  inv.createDraft(db, { client_id: client.id, lines: LINES });
  assert.equal(inv.listInvoices(db).length, 2);
  assert.equal(inv.listInvoices(db, { status: 'en_retard' }).length, 1);
  assert.equal(inv.listInvoices(db, { status: 'brouillon' }).length, 1);
  assert.equal(inv.listInvoices(db, { search: 'FAC-2020' }).length, 1);
});

test('avoir : annule la facture avec sa propre numérotation', () => {
  const { db, client } = setup();
  const f = inv.issueInvoice(db, inv.createDraft(db, { client_id: client.id, lines: LINES }).id, { issue_date: '2026-11-14' });
  const draft = inv.createCreditNote(db, f.id);
  assert.equal(draft.kind, 'avoir');
  assert.equal(draft.total_ttc, 1180000);
  const credit = inv.issueInvoice(db, draft.id, { issue_date: '2026-11-15' });
  assert.equal(credit.number, 'AV-2026-0001');
  const after = inv.getInvoice(db, f.id);
  assert.equal(after.display_status, 'annulee');
  assert.equal(after.remaining, 0);
  assert.equal(cat.listClients(db)[0].balance_due, 0);
  assert.equal(cat.getSettings(db).next_invoice_seq, '2');
});

test('avoir partiel accepté, avoir trop élevé refusé', () => {
  const { db, client } = setup();
  const f = inv.issueInvoice(db, inv.createDraft(db, { client_id: client.id, lines: LINES }).id, { issue_date: '2026-11-14' });
  const partial = inv.createCreditNote(db, f.id);
  inv.updateDraft(db, partial.id, { lines: LINES.slice(2) });
  assert.equal(inv.issueInvoice(db, partial.id, { issue_date: '2026-11-15' }).total_ttc, 141600);
  assert.equal(inv.getInvoice(db, f.id).remaining, 1038400);
  const tooMuch = inv.createCreditNote(db, f.id); // reprend toute la facture, alors qu'une partie est déjà créditée
  assert.throws(() => inv.issueInvoice(db, tooMuch.id, { issue_date: '2026-11-15' }), /dépasse/);
  assert.equal(cat.getSettings(db).next_credit_seq, '2');
});

test('document PDF : contenu, échappement, brouillon refusé', () => {
  const { db, client } = setup();
  cat.updateSettings(db, { company_name: 'Teranga <Services>', company_ninea: '009876', payment_details: 'Wave 77 000 00 00' });
  const draft = inv.createDraft(db, { client_id: client.id, lines: [{ description: '<script>alert(1)</script>', quantity: 1500, unit_price_ht: 1000, vat_rate: 1800 }] });
  assert.throws(() => buildInvoiceHtml(draft, cat.getSettings(db)), /émis/);
  const f = inv.issueInvoice(db, draft.id, { issue_date: '2026-11-01' });
  const html = buildInvoiceHtml(f, cat.getSettings(db));
  assert.ok(html.includes('Teranga &lt;Services&gt;'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('FAC-2026-0001'));
  assert.ok(html.includes('1er novembre 2026'));
  assert.ok(html.includes('1,5'));
  assert.ok(html.includes('1\u00A0770\u00A0FCFA'));
  assert.ok(html.includes('Paiement : Wave 77 000 00 00'));
  const credit = inv.issueInvoice(db, inv.createCreditNote(db, f.id).id, { issue_date: '2026-11-02' });
  const creditHtml = buildInvoiceHtml(credit, cat.getSettings(db), f);
  assert.ok(creditHtml.includes('Sur la facture FAC-2026-0001'));
  assert.ok(!creditHtml.includes('Paiement :'));
});

test('devis : finalisation, réponse du client, conversion en facture', () => {
  const { db, client } = setup();
  const d = quo.createQuote(db, { client_id: client.id, lines: LINES });
  assert.equal(d.display_status, 'brouillon');
  assert.throws(() => quo.setQuoteAnswer(db, d.id, 'accepte'), /Finalisez/);
  const sent = quo.sendQuote(db, d.id, { issue_date: '2026-11-09', validity_days: 30 });
  assert.equal(sent.number, 'DEV-2026-0001');
  assert.equal(sent.valid_until, '2026-12-09');
  assert.equal(sent.total_ttc, 1180000);
  assert.throws(() => quo.updateQuote(db, d.id, { note: 'x' }), /ne peut plus être modifié/);
  assert.throws(() => quo.deleteQuote(db, d.id), /ne peut pas être supprimé/);
  assert.throws(() => db.prepare('DELETE FROM quote_lines WHERE quote_id = ?').run(d.id), /ne peut plus être modifié/);
  assert.throws(() => quo.convertQuoteToInvoice(db, d.id), /accepté/);

  assert.equal(quo.setQuoteAnswer(db, d.id, 'refuse').status, 'refuse');
  assert.equal(quo.setQuoteAnswer(db, d.id, 'accepte').status, 'accepte'); // le client change d'avis
  const invoice = quo.convertQuoteToInvoice(db, d.id);
  assert.equal(invoice.status, 'brouillon');
  assert.equal(invoice.total_ttc, 1180000);
  assert.equal(invoice.note, 'Selon devis DEV-2026-0001');
  assert.equal(quo.getQuote(db, d.id).invoice_id, invoice.id);
  assert.throws(() => quo.convertQuoteToInvoice(db, d.id), /déjà converti/);
  assert.throws(() => quo.setQuoteAnswer(db, d.id, 'refuse'), /déjà converti/);
  // la facture issue du devis s'émet normalement, dans la numérotation des factures
  assert.equal(inv.issueInvoice(db, invoice.id, { issue_date: '2026-11-20' }).number, 'FAC-2026-0001');
});

test('devis : expiration, filtres, duplication, PDF', () => {
  const { db, client } = setup();
  const old = quo.sendQuote(db, quo.createQuote(db, { client_id: client.id, lines: LINES }).id, { issue_date: '2020-01-01', validity_days: 15 });
  assert.equal(old.display_status, 'expire');
  const copy = quo.duplicateQuote(db, old.id);
  assert.equal(copy.status, 'brouillon');
  assert.equal(copy.lines.length, 3);
  assert.equal(quo.listQuotes(db).length, 2);
  assert.equal(quo.listQuotes(db, { status: ['refuse', 'expire'] }).length, 1);
  assert.equal(quo.listQuotes(db, { status: 'brouillon' }).length, 1);
  assert.equal(quo.sendQuote(db, copy.id, { issue_date: '2026-11-15' }).number, 'DEV-2026-0002');
  const empty = quo.createQuote(db, { client_id: client.id });
  assert.throws(() => quo.sendQuote(db, empty.id), /au moins une ligne/);
  assert.throws(() => buildQuoteHtml(empty, cat.getSettings(db)), /finalisé/);
  const html = buildQuoteHtml(quo.getQuote(db, old.id), cat.getSettings(db));
  assert.ok(html.includes('Devis'));
  assert.ok(html.includes('DEV-2020-0001'));
  assert.ok(html.includes('Valable jusqu’au 16 janvier 2020'));
});

test('tableau de bord : chiffres du mois, retards, série mensuelle', () => {
  const { db, client } = setup();
  const empty = getDashboard(db, { on: '2026-11-15' });
  assert.equal(empty.month_label, 'Novembre 2026');
  assert.equal(empty.billed.total, 0);
  assert.equal(empty.months.length, 6);
  assert.deepEqual(empty.months.map((m) => m.label), ['Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre']);

  const issue = (date, lines = LINES) => inv.issueInvoice(db, inv.createDraft(db, { client_id: client.id, lines }).id, { issue_date: date });
  const sept = issue('2026-09-10');                 // 1 180 000, échéance 10 oct. : en retard
  const oct = issue('2026-10-20', LINES.slice(1));  // 354 000, échéance 19 nov. : en attente
  const nov = issue('2026-11-05');                  // 1 180 000, payée en partie
  inv.recordPayment(db, sept.id, { amount: 180000, paid_on: '2026-10-01' });
  inv.recordPayment(db, nov.id, { amount: 500000, paid_on: '2026-11-10' });
  const credit = inv.createCreditNote(db, nov.id);
  inv.updateDraft(db, credit.id, { lines: LINES.slice(2) });
  inv.issueInvoice(db, credit.id, { issue_date: '2026-11-12' }); // avoir de 141 600
  inv.createDraft(db, { client_id: client.id, lines: LINES });   // un brouillon ne compte pas
  quo.sendQuote(db, quo.createQuote(db, { client_id: client.id, lines: LINES }).id, { issue_date: '2026-11-01' });

  const d = getDashboard(db, { on: '2026-11-15' });
  assert.deepEqual(d.billed, { total: 1180000 - 141600, count: 1 });
  assert.deepEqual(d.collected, { total: 500000, count: 1 });
  assert.deepEqual(d.late, { total: 1000000, count: 1 });
  assert.deepEqual(d.pending, { total: 354000 + (1180000 - 141600 - 500000), count: 2 });
  assert.equal(d.late_invoices[0].number, sept.number);
  assert.equal(d.late_invoices[0].days_late, 36);
  assert.deepEqual(d.months.map((m) => m.total), [0, 0, 0, 1180000, 354000, 1038400]);
  assert.deepEqual(d.open_quotes, { total: 1180000, count: 1 });
  assert.ok(oct.number);
  // en janvier, la fenêtre de six mois chevauche deux années
  assert.deepEqual(getDashboard(db, { on: '2027-01-10' }).months.map((m) => `${m.label} ${m.year}`),
    ['Août 2026', 'Septembre 2026', 'Octobre 2026', 'Novembre 2026', 'Décembre 2026', 'Janvier 2027']);
});
