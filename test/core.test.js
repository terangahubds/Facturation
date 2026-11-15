'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/core/db');
const cat = require('../src/core/catalog');
const inv = require('../src/core/invoices');

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
