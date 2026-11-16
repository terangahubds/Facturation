'use strict';
// Base de données locale : un seul fichier SQLite sur le poste du client.
// Tous les montants sont des entiers en francs CFA (pas de centimes).
// Les quantités sont en millièmes (1,5 heure = 1500) et les taux de TVA
// en centièmes de pour cent (18 % = 1800), pour éviter les erreurs d'arrondi.

const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE clients (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL CHECK (length(trim(name)) > 0),
    contact      TEXT NOT NULL DEFAULT '',
    email        TEXT NOT NULL DEFAULT '',
    phone        TEXT NOT NULL DEFAULT '',
    address      TEXT NOT NULL DEFAULT '',
    ninea        TEXT NOT NULL DEFAULT '',
    payment_days INTEGER NOT NULL DEFAULT 30 CHECK (payment_days >= 0),
    archived     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE products (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    type       TEXT NOT NULL DEFAULT 'service' CHECK (type IN ('service', 'produit')),
    unit       TEXT NOT NULL DEFAULT '',
    price_ht   INTEGER NOT NULL CHECK (price_ht >= 0),
    vat_rate   INTEGER NOT NULL DEFAULT 1800 CHECK (vat_rate >= 0),
    archived   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- kind : 'facture' ou 'avoir'. status : 'brouillon' puis 'emise', sans retour.
  -- Le client est recopié à l'émission : la facture ne change plus ensuite,
  -- même si la fiche du client est modifiée.
  CREATE TABLE invoices (
    id             INTEGER PRIMARY KEY,
    kind           TEXT NOT NULL DEFAULT 'facture' CHECK (kind IN ('facture', 'avoir')),
    status         TEXT NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon', 'emise')),
    number         TEXT UNIQUE,
    client_id      INTEGER NOT NULL REFERENCES clients(id),
    credit_of      INTEGER REFERENCES invoices(id),
    issue_date     TEXT,
    due_date       TEXT,
    note           TEXT NOT NULL DEFAULT '',
    client_name    TEXT NOT NULL DEFAULT '',
    client_address TEXT NOT NULL DEFAULT '',
    client_ninea   TEXT NOT NULL DEFAULT '',
    total_ht       INTEGER NOT NULL DEFAULT 0,
    total_vat      INTEGER NOT NULL DEFAULT 0,
    total_ttc      INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((status = 'brouillon' AND number IS NULL) OR (status = 'emise' AND number IS NOT NULL))
  );

  CREATE TABLE invoice_lines (
    id            INTEGER PRIMARY KEY,
    invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL,
    description   TEXT NOT NULL,
    quantity      INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_ht INTEGER NOT NULL CHECK (unit_price_ht >= 0),
    vat_rate      INTEGER NOT NULL CHECK (vat_rate >= 0),
    total_ht      INTEGER NOT NULL
  );

  CREATE TABLE payments (
    id         INTEGER PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    paid_on    TEXT NOT NULL,
    amount     INTEGER NOT NULL CHECK (amount > 0),
    method     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_invoices_client ON invoices(client_id);
  CREATE INDEX idx_lines_invoice ON invoice_lines(invoice_id);
  CREATE INDEX idx_payments_invoice ON payments(invoice_id);

  -- Garde-fous dans la base elle-même : une facture émise est figée.
  CREATE TRIGGER invoices_no_update_issued
  BEFORE UPDATE ON invoices WHEN OLD.status = 'emise'
  BEGIN SELECT RAISE(ABORT, 'Une facture émise ne peut plus être modifiée.'); END;

  CREATE TRIGGER invoices_no_delete_issued
  BEFORE DELETE ON invoices WHEN OLD.status = 'emise'
  BEGIN SELECT RAISE(ABORT, 'Une facture émise ne peut pas être supprimée.'); END;

  CREATE TRIGGER lines_no_insert_issued
  BEFORE INSERT ON invoice_lines
  WHEN (SELECT status FROM invoices WHERE id = NEW.invoice_id) = 'emise'
  BEGIN SELECT RAISE(ABORT, 'Une facture émise ne peut plus être modifiée.'); END;

  CREATE TRIGGER lines_no_update_issued
  BEFORE UPDATE ON invoice_lines
  WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) = 'emise'
  BEGIN SELECT RAISE(ABORT, 'Une facture émise ne peut plus être modifiée.'); END;

  CREATE TRIGGER lines_no_delete_issued
  BEFORE DELETE ON invoice_lines
  WHEN (SELECT status FROM invoices WHERE id = OLD.invoice_id) = 'emise'
  BEGIN SELECT RAISE(ABORT, 'Une facture émise ne peut plus être modifiée.'); END;
  `,
  `
  -- Devis. status : 'brouillon', puis 'envoye' (finalisé), 'accepte' ou 'refuse'.
  -- invoice_id : la facture créée à partir du devis, s'il a été converti.
  CREATE TABLE quotes (
    id             INTEGER PRIMARY KEY,
    status         TEXT NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon', 'envoye', 'accepte', 'refuse')),
    number         TEXT UNIQUE,
    client_id      INTEGER NOT NULL REFERENCES clients(id),
    invoice_id     INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    issue_date     TEXT,
    valid_until    TEXT,
    note           TEXT NOT NULL DEFAULT '',
    client_name    TEXT NOT NULL DEFAULT '',
    client_address TEXT NOT NULL DEFAULT '',
    client_ninea   TEXT NOT NULL DEFAULT '',
    total_ht       INTEGER NOT NULL DEFAULT 0,
    total_vat      INTEGER NOT NULL DEFAULT 0,
    total_ttc      INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((status = 'brouillon' AND number IS NULL) OR (status <> 'brouillon' AND number IS NOT NULL))
  );

  CREATE TABLE quote_lines (
    id            INTEGER PRIMARY KEY,
    quote_id      INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL,
    description   TEXT NOT NULL,
    quantity      INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_ht INTEGER NOT NULL CHECK (unit_price_ht >= 0),
    vat_rate      INTEGER NOT NULL CHECK (vat_rate >= 0),
    total_ht      INTEGER NOT NULL
  );

  CREATE INDEX idx_quotes_client ON quotes(client_id);
  CREATE INDEX idx_quote_lines_quote ON quote_lines(quote_id);

  -- Les lignes d'un devis finalisé sont figées, comme celles d'une facture émise.
  CREATE TRIGGER quote_lines_no_insert_final
  BEFORE INSERT ON quote_lines
  WHEN (SELECT status FROM quotes WHERE id = NEW.quote_id) <> 'brouillon'
  BEGIN SELECT RAISE(ABORT, 'Un devis finalisé ne peut plus être modifié.'); END;

  CREATE TRIGGER quote_lines_no_update_final
  BEFORE UPDATE ON quote_lines
  WHEN (SELECT status FROM quotes WHERE id = OLD.quote_id) <> 'brouillon'
  BEGIN SELECT RAISE(ABORT, 'Un devis finalisé ne peut plus être modifié.'); END;

  CREATE TRIGGER quote_lines_no_delete_final
  BEFORE DELETE ON quote_lines
  WHEN (SELECT status FROM quotes WHERE id = OLD.quote_id) <> 'brouillon'
  BEGIN SELECT RAISE(ABORT, 'Un devis finalisé ne peut plus être modifié.'); END;

  CREATE TRIGGER quotes_no_delete_final
  BEFORE DELETE ON quotes WHEN OLD.status <> 'brouillon'
  BEGIN SELECT RAISE(ABORT, 'Un devis finalisé ne peut pas être supprimé.'); END;
  `,
];

const DEFAULT_SETTINGS = {
  company_name: '',
  company_address: '',
  company_ninea: '',
  company_rccm: '',
  company_email: '',
  company_phone: '',
  payment_details: '',
  legal_footer: '',
  currency: 'FCFA',
  default_vat_rate: '1800',
  default_payment_days: '30',
  invoice_prefix: 'FAC',
  credit_prefix: 'AV',
  next_invoice_seq: '1',
  next_credit_seq: '1',
  quote_prefix: 'DEV',
  next_quote_seq: '1',
  quote_validity_days: '30',
  last_backup_at: '',
  backup_reminder: '1',
  company_logo: '',
  theme: 'vert',
  trial_started_at: '',
  trial_last_seen: '',
};

function openDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insert.run(key, value);
  return db;
}

// Tout ou rien : si une étape échoue, rien n'est enregistré.
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDatabase, transaction, DEFAULT_SETTINGS, SCHEMA_VERSION: MIGRATIONS.length };
