'use strict';
// Factures : brouillon modifiable, émission définitive avec numéro continu,
// paiements, et avoir pour corriger une facture émise.

const { transaction } = require('./db');
const { getSettings, getClient } = require('./catalog');

// Total d'une ligne : quantité (en millièmes) × prix unitaire, arrondi au franc.
function lineTotal(quantity, unitPrice) {
  return Math.round((quantity * unitPrice) / 1000);
}

// La TVA est calculée par taux sur le total HT de ce taux, puis arrondie au franc.
function computeTotals(lines) {
  const byRate = new Map();
  let totalHt = 0;
  for (const l of lines) {
    const t = lineTotal(l.quantity, l.unit_price_ht);
    totalHt += t;
    byRate.set(l.vat_rate, (byRate.get(l.vat_rate) || 0) + t);
  }
  let totalVat = 0;
  for (const [rate, base] of byRate) totalVat += Math.round((base * rate) / 10000);
  return { total_ht: totalHt, total_vat: totalVat, total_ttc: totalHt + totalVat };
}

function checkLines(lines) {
  if (!Array.isArray(lines)) throw new Error('Les lignes sont invalides.');
  for (const l of lines) {
    if (!l.description || String(l.description).trim() === '') throw new Error('Chaque ligne doit avoir une désignation.');
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new Error('La quantité doit être supérieure à zéro.');
    if (!Number.isInteger(l.unit_price_ht) || l.unit_price_ht < 0) throw new Error('Le prix unitaire est invalide.');
    if (!Number.isInteger(l.vat_rate) || l.vat_rate < 0) throw new Error('Le taux de TVA est invalide.');
  }
}

function writeLines(db, invoiceId, lines) {
  db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(invoiceId);
  const stmt = db.prepare(`INSERT INTO invoice_lines
    (invoice_id, position, description, quantity, unit_price_ht, vat_rate, total_ht)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  lines.forEach((l, i) => {
    stmt.run(invoiceId, i + 1, String(l.description).trim(), l.quantity, l.unit_price_ht, l.vat_rate,
      lineTotal(l.quantity, l.unit_price_ht));
  });
  const t = computeTotals(lines);
  db.prepare('UPDATE invoices SET total_ht = ?, total_vat = ?, total_ttc = ? WHERE id = ?')
    .run(t.total_ht, t.total_vat, t.total_ttc, invoiceId);
}

function createDraft(db, { client_id, lines = [], note = '' }) {
  getClient(db, client_id);
  checkLines(lines);
  return transaction(db, () => {
    const id = Number(db.prepare('INSERT INTO invoices (client_id, note) VALUES (?, ?)').run(client_id, note).lastInsertRowid);
    writeLines(db, id, lines);
    return getInvoice(db, id);
  });
}

function updateDraft(db, id, { client_id, lines, note }) {
  const inv = getInvoice(db, id);
  if (inv.status !== 'brouillon') throw new Error('Une facture émise ne peut plus être modifiée.');
  if (client_id !== undefined) getClient(db, client_id);
  if (lines !== undefined) checkLines(lines);
  return transaction(db, () => {
    if (client_id !== undefined) db.prepare('UPDATE invoices SET client_id = ? WHERE id = ?').run(client_id, id);
    if (note !== undefined) db.prepare('UPDATE invoices SET note = ? WHERE id = ?').run(note, id);
    if (lines !== undefined) writeLines(db, id, lines);
    return getInvoice(db, id);
  });
}

function deleteDraft(db, id) {
  const inv = getInvoice(db, id);
  if (inv.status !== 'brouillon') throw new Error('Une facture émise ne peut pas être supprimée.');
  db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Émission : attribue le prochain numéro, fige le client et les totaux.
// Le numéro et le compteur changent dans la même transaction, donc jamais de trou ni de doublon.
function issueInvoice(db, id, { issue_date = today() } = {}) {
  return transaction(db, () => {
    const inv = getInvoice(db, id);
    if (inv.status !== 'brouillon') throw new Error('Cette facture est déjà émise.');
    if (inv.lines.length === 0) throw new Error('Ajoutez au moins une ligne avant d’émettre la facture.');
    const last = db.prepare(`SELECT MAX(issue_date) AS d FROM invoices WHERE status = 'emise' AND kind = ?`).get(inv.kind).d;
    if (last && issue_date < last) {
      throw new Error('La date d’émission ne peut pas être antérieure à celle de la dernière facture émise.');
    }
    const s = getSettings(db);
    const isCredit = inv.kind === 'avoir';
    if (isCredit) {
      // Un avoir ne peut pas dépasser ce qui reste de la facture d'origine.
      const origin = getInvoice(db, inv.credit_of);
      if (inv.total_ttc > origin.total_ttc - origin.credited) {
        throw new Error('L\u2019avoir dépasse le montant restant de la facture d\u2019origine.');
      }
    }
    const seqKey = isCredit ? 'next_credit_seq' : 'next_invoice_seq';
    const seq = Number(s[seqKey]);
    const prefix = isCredit ? s.credit_prefix : s.invoice_prefix;
    const number = `${prefix}-${issue_date.slice(0, 4)}-${String(seq).padStart(4, '0')}`;
    const client = getClient(db, inv.client_id);
    db.prepare(`UPDATE invoices SET status = 'emise', number = ?, issue_date = ?, due_date = ?,
      client_name = ?, client_address = ?, client_ninea = ? WHERE id = ?`)
      .run(number, issue_date, addDays(issue_date, client.payment_days), client.name, client.address, client.ninea, id);
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(seq + 1), seqKey);
    return getInvoice(db, id);
  });
}

function paidAmount(db, id) {
  return db.prepare('SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE invoice_id = ?').get(id).s;
}

function creditedAmount(db, id) {
  return db.prepare(`SELECT COALESCE(SUM(total_ttc), 0) AS s FROM invoices
    WHERE credit_of = ? AND status = 'emise'`).get(id).s;
}

// Statut affiché : brouillon, en attente, en retard, payée ou annulée (par un avoir total).
function displayStatus(inv, paid, credited, on = today()) {
  if (inv.status === 'brouillon') return 'brouillon';
  if (inv.kind === 'avoir') return 'avoir';
  const remaining = inv.total_ttc - credited - paid;
  if (credited >= inv.total_ttc) return 'annulee';
  if (remaining <= 0) return 'payee';
  return inv.due_date < on ? 'en_retard' : 'en_attente';
}

function getInvoice(db, id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!inv) throw new Error('Facture introuvable.');
  inv.lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY position').all(id);
  inv.payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on, id').all(id);
  inv.paid = paidAmount(db, id);
  inv.credited = creditedAmount(db, id);
  inv.remaining = inv.status === 'emise' && inv.kind === 'facture' ? inv.total_ttc - inv.credited - inv.paid : 0;
  inv.display_status = displayStatus(inv, inv.paid, inv.credited);
  return inv;
}

function listInvoices(db, { status = null, search = '', kind = 'facture' } = {}) {
  const rows = db.prepare(`
    SELECT i.*, c.name AS current_client_name,
      (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.invoice_id = i.id) AS paid,
      (SELECT COALESCE(SUM(total_ttc), 0) FROM invoices a WHERE a.credit_of = i.id AND a.status = 'emise') AS credited
    FROM invoices i JOIN clients c ON c.id = i.client_id
    WHERE i.kind = ? AND (c.name LIKE ? OR i.client_name LIKE ? OR COALESCE(i.number, '') LIKE ?)
    ORDER BY i.status = 'brouillon' DESC, i.number DESC, i.id DESC
  `).all(kind, `%${search}%`, `%${search}%`, `%${search}%`);
  const on = today();
  return rows
    .map((r) => ({ ...r, display_status: displayStatus(r, r.paid, r.credited, on) }))
    .filter((r) => !status || r.display_status === status);
}

function recordPayment(db, invoiceId, { amount, paid_on = today(), method = '' }) {
  return transaction(db, () => {
    const inv = getInvoice(db, invoiceId);
    if (inv.status !== 'emise' || inv.kind !== 'facture') throw new Error('Seule une facture émise peut recevoir un paiement.');
    if (!Number.isInteger(amount) || amount <= 0) throw new Error('Le montant du paiement est invalide.');
    if (amount > inv.remaining) throw new Error('Le paiement dépasse le reste à payer.');
    db.prepare('INSERT INTO payments (invoice_id, paid_on, amount, method) VALUES (?, ?, ?, ?)')
      .run(invoiceId, paid_on, amount, method);
    return getInvoice(db, invoiceId);
  });
}

// Avoir : brouillon qui reprend les lignes de la facture d'origine. Il s'émet ensuite
// comme une facture, avec sa propre numérotation.
function createCreditNote(db, invoiceId) {
  return transaction(db, () => {
    const inv = getInvoice(db, invoiceId);
    if (inv.status !== 'emise' || inv.kind !== 'facture') throw new Error('Un avoir se crée à partir d’une facture émise.');
    const id = Number(db.prepare(`INSERT INTO invoices (kind, client_id, credit_of, note) VALUES ('avoir', ?, ?, ?)`)
      .run(inv.client_id, invoiceId, `Avoir sur la facture ${inv.number}`).lastInsertRowid);
    writeLines(db, id, inv.lines);
    return getInvoice(db, id);
  });
}

module.exports = {
  lineTotal, computeTotals,
  createDraft, updateDraft, deleteDraft, issueInvoice,
  getInvoice, listInvoices, recordPayment, createCreditNote,
};
