'use strict';
// Devis : brouillon modifiable, puis devis finalisé (numéroté, figé), accepté ou refusé
// par le client, et enfin converti en facture.

const { transaction } = require('./db');
const { getSettings, getClient } = require('./catalog');
const { lineTotal, computeTotals, checkLines, addDays, today, createDraft } = require('./invoices');

function writeLines(db, quoteId, lines) {
  db.prepare('DELETE FROM quote_lines WHERE quote_id = ?').run(quoteId);
  const stmt = db.prepare(`INSERT INTO quote_lines
    (quote_id, position, description, quantity, unit_price_ht, vat_rate, total_ht)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  lines.forEach((l, i) => {
    stmt.run(quoteId, i + 1, String(l.description).trim(), l.quantity, l.unit_price_ht, l.vat_rate,
      lineTotal(l.quantity, l.unit_price_ht));
  });
  const t = computeTotals(lines);
  db.prepare('UPDATE quotes SET total_ht = ?, total_vat = ?, total_ttc = ? WHERE id = ?')
    .run(t.total_ht, t.total_vat, t.total_ttc, quoteId);
}

// Statut affiché : un devis envoyé dont la date de validité est passée est « expiré ».
function displayStatus(q, on = today()) {
  if (q.status === 'envoye' && q.valid_until < on) return 'expire';
  return q.status;
}

function getQuote(db, id) {
  const q = db.prepare('SELECT * FROM quotes WHERE id = ?').get(id);
  if (!q) throw new Error('Devis introuvable.');
  q.lines = db.prepare('SELECT * FROM quote_lines WHERE quote_id = ? ORDER BY position').all(id);
  q.display_status = displayStatus(q);
  return q;
}

function listQuotes(db, { status = null, search = '' } = {}) {
  const rows = db.prepare(`
    SELECT q.*, c.name AS current_client_name
    FROM quotes q JOIN clients c ON c.id = q.client_id
    WHERE c.name LIKE ? OR q.client_name LIKE ? OR COALESCE(q.number, '') LIKE ?
    ORDER BY q.status = 'brouillon' DESC, q.number DESC, q.id DESC
  `).all(`%${search}%`, `%${search}%`, `%${search}%`);
  const on = today();
  const wanted = Array.isArray(status) ? status : status ? [status] : null;
  return rows
    .map((r) => ({ ...r, display_status: displayStatus(r, on) }))
    .filter((r) => !wanted || wanted.includes(r.display_status));
}

function createQuote(db, { client_id, lines = [], note = '' }) {
  getClient(db, client_id);
  checkLines(lines);
  return transaction(db, () => {
    const id = Number(db.prepare('INSERT INTO quotes (client_id, note) VALUES (?, ?)').run(client_id, note).lastInsertRowid);
    writeLines(db, id, lines);
    return getQuote(db, id);
  });
}

function requireDraft(q) {
  if (q.status !== 'brouillon') throw new Error('Un devis finalisé ne peut plus être modifié. Dupliquez-le pour en faire une nouvelle version.');
}

function updateQuote(db, id, { client_id, lines, note }) {
  requireDraft(getQuote(db, id));
  if (client_id !== undefined) getClient(db, client_id);
  if (lines !== undefined) checkLines(lines);
  return transaction(db, () => {
    if (client_id !== undefined) db.prepare('UPDATE quotes SET client_id = ? WHERE id = ?').run(client_id, id);
    if (note !== undefined) db.prepare('UPDATE quotes SET note = ? WHERE id = ?').run(note, id);
    if (lines !== undefined) writeLines(db, id, lines);
    return getQuote(db, id);
  });
}

function deleteQuote(db, id) {
  const q = getQuote(db, id);
  if (q.status !== 'brouillon') throw new Error('Un devis finalisé ne peut pas être supprimé.');
  db.prepare('DELETE FROM quotes WHERE id = ?').run(id);
}

// Finalisation : le devis reçoit son numéro, le client et les montants sont figés.
function sendQuote(db, id, { issue_date = today(), validity_days } = {}) {
  return transaction(db, () => {
    const q = getQuote(db, id);
    if (q.status !== 'brouillon') throw new Error('Ce devis est déjà finalisé.');
    if (q.lines.length === 0) throw new Error('Ajoutez au moins une ligne avant de finaliser le devis.');
    const s = getSettings(db);
    const days = validity_days === undefined ? Number(s.quote_validity_days) : validity_days;
    if (!Number.isInteger(days) || days < 0) throw new Error('La durée de validité est invalide.');
    const seq = Number(s.next_quote_seq);
    const number = `${s.quote_prefix}-${issue_date.slice(0, 4)}-${String(seq).padStart(4, '0')}`;
    const client = getClient(db, q.client_id);
    db.prepare(`UPDATE quotes SET status = 'envoye', number = ?, issue_date = ?, valid_until = ?,
      client_name = ?, client_address = ?, client_ninea = ? WHERE id = ?`)
      .run(number, issue_date, addDays(issue_date, days), client.name, client.address, client.ninea, id);
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'next_quote_seq'`).run(String(seq + 1));
    return getQuote(db, id);
  });
}

// Réponse du client : accepté ou refusé. Reste modifiable tant que le devis n'est pas converti en facture.
function setQuoteAnswer(db, id, answer) {
  if (answer !== 'accepte' && answer !== 'refuse') throw new Error('Réponse invalide.');
  const q = getQuote(db, id);
  if (q.status === 'brouillon') throw new Error('Finalisez le devis avant d’enregistrer la réponse du client.');
  if (q.invoice_id) throw new Error('Ce devis est déjà converti en facture.');
  db.prepare('UPDATE quotes SET status = ? WHERE id = ?').run(answer, id);
  return getQuote(db, id);
}

// Conversion : crée un brouillon de facture avec les mêmes lignes. Un devis ne se convertit qu'une fois.
function convertQuoteToInvoice(db, id) {
  return transaction(db, () => {
    const q = getQuote(db, id);
    if (q.status !== 'accepte') throw new Error('Seul un devis accepté peut être converti en facture.');
    if (q.invoice_id) throw new Error('Ce devis est déjà converti en facture.');
    const lines = q.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price_ht: l.unit_price_ht, vat_rate: l.vat_rate }));
    const invoice = createDraft(db, { client_id: q.client_id, lines, note: `Selon devis ${q.number}`, nested: true });
    db.prepare('UPDATE quotes SET invoice_id = ? WHERE id = ?').run(invoice.id, id);
    return invoice;
  });
}

// Nouvelle version d'un devis : un brouillon avec les mêmes lignes.
function duplicateQuote(db, id) {
  const q = getQuote(db, id);
  const lines = q.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price_ht: l.unit_price_ht, vat_rate: l.vat_rate }));
  return createQuote(db, { client_id: q.client_id, lines, note: q.note });
}

module.exports = {
  getQuote, listQuotes, createQuote, updateQuote, deleteQuote,
  sendQuote, setQuoteAnswer, convertQuoteToInvoice, duplicateQuote,
};
