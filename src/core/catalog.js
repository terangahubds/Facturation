'use strict';
// Paramètres, clients et produits : les données dont une facture a besoin.

const { DEFAULT_SETTINGS } = require('./db');

// Ces compteurs ne se modifient jamais à la main : la numérotation doit rester continue.
const PROTECTED_SETTINGS = new Set(['next_invoice_seq', 'next_credit_seq', 'next_quote_seq']);

function getSettings(db) {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

function updateSettings(db, changes) {
  const stmt = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  for (const [key, value] of Object.entries(changes)) {
    if (!(key in DEFAULT_SETTINGS)) throw new Error(`Paramètre inconnu : ${key}`);
    if (PROTECTED_SETTINGS.has(key)) throw new Error('Le prochain numéro ne se modifie pas à la main.');
    stmt.run(String(value), key);
  }
  return getSettings(db);
}

const CLIENT_FIELDS = ['name', 'contact', 'email', 'phone', 'address', 'ninea', 'payment_days'];
const PRODUCT_FIELDS = ['name', 'type', 'unit', 'price_ht', 'vat_rate'];

function pick(data, fields) {
  const out = {};
  for (const f of fields) if (data[f] !== undefined) out[f] = data[f];
  return out;
}

function requireName(data) {
  if (data.name !== undefined && String(data.name).trim() === '') throw new Error('Le nom est obligatoire.');
}

function requireAmount(value, label) {
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
    throw new Error(`${label} doit être un nombre entier positif.`);
  }
}

function insertRow(db, table, values) {
  const keys = Object.keys(values);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return Number(db.prepare(sql).run(...keys.map((k) => values[k])).lastInsertRowid);
}

function updateRow(db, table, id, values) {
  const keys = Object.keys(values);
  if (keys.length === 0) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  const res = db.prepare(sql).run(...keys.map((k) => values[k]), id);
  if (res.changes === 0) throw new Error('Élément introuvable.');
}

// --- Clients ---

function createClient(db, data) {
  if (data.name === undefined) throw new Error('Le nom est obligatoire.');
  requireName(data);
  requireAmount(data.payment_days, 'Le délai de paiement');
  return getClient(db, insertRow(db, 'clients', pick(data, CLIENT_FIELDS)));
}

function updateClient(db, id, data) {
  requireName(data);
  requireAmount(data.payment_days, 'Le délai de paiement');
  updateRow(db, 'clients', id, pick(data, CLIENT_FIELDS));
  return getClient(db, id);
}

function getClient(db, id) {
  const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  if (!row) throw new Error('Client introuvable.');
  return row;
}

// Liste avec, pour chaque client, le nombre de factures émises, le total facturé
// et le reste dû (avoirs déduits).
function listClients(db, { search = '', includeArchived = false } = {}) {
  return db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM invoices i WHERE i.client_id = c.id AND i.status = 'emise' AND i.kind = 'facture') AS invoice_count,
      (SELECT COALESCE(SUM(CASE WHEN i.kind = 'avoir' THEN -i.total_ttc ELSE i.total_ttc END), 0)
         FROM invoices i WHERE i.client_id = c.id AND i.status = 'emise') AS total_billed,
      (SELECT COALESCE(SUM(CASE WHEN i.kind = 'avoir' THEN -i.total_ttc ELSE i.total_ttc END), 0)
         FROM invoices i WHERE i.client_id = c.id AND i.status = 'emise')
      - (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
         JOIN invoices i ON i.id = p.invoice_id WHERE i.client_id = c.id) AS balance_due
    FROM clients c
    WHERE (? = 1 OR c.archived = 0) AND c.name LIKE ?
    ORDER BY c.name COLLATE NOCASE
  `).all(includeArchived ? 1 : 0, `%${search}%`);
}

// Un client déjà facturé ne se supprime pas : on l'archive pour garder l'historique.
function archiveClient(db, id) {
  updateRow(db, 'clients', id, { archived: 1 });
}

// --- Produits et services ---

function createProduct(db, data) {
  if (data.name === undefined) throw new Error('La désignation est obligatoire.');
  requireName(data);
  if (data.price_ht === undefined) throw new Error('Le prix est obligatoire.');
  requireAmount(data.price_ht, 'Le prix');
  requireAmount(data.vat_rate, 'Le taux de TVA');
  const values = pick(data, PRODUCT_FIELDS);
  if (values.vat_rate === undefined) values.vat_rate = Number(getSettings(db).default_vat_rate);
  return getProduct(db, insertRow(db, 'products', values));
}

function updateProduct(db, id, data) {
  requireName(data);
  requireAmount(data.price_ht, 'Le prix');
  requireAmount(data.vat_rate, 'Le taux de TVA');
  updateRow(db, 'products', id, pick(data, PRODUCT_FIELDS));
  return getProduct(db, id);
}

function getProduct(db, id) {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!row) throw new Error('Article introuvable.');
  return row;
}

function listProducts(db, { search = '', type = null, includeArchived = false } = {}) {
  return db.prepare(`
    SELECT * FROM products
    WHERE (? = 1 OR archived = 0) AND name LIKE ? AND (? IS NULL OR type = ?)
    ORDER BY name COLLATE NOCASE
  `).all(includeArchived ? 1 : 0, `%${search}%`, type, type);
}

function archiveProduct(db, id) {
  updateRow(db, 'products', id, { archived: 1 });
}

module.exports = {
  getSettings, updateSettings,
  createClient, updateClient, getClient, listClients, archiveClient,
  createProduct, updateProduct, getProduct, listProducts, archiveProduct,
};
