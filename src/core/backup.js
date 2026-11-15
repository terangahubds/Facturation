'use strict';
// Sauvegarde et restauration : une sauvegarde est une copie complète de la base,
// dans un seul fichier que l'on peut poser sur une clé USB.

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA_VERSION } = require('./db');

// Copie cohérente de la base ouverte vers targetPath, même si des écritures sont en attente.
function createBackup(db, targetPath, { now = new Date() } = {}) {
  fs.rmSync(targetPath, { force: true });
  try {
    db.prepare('VACUUM INTO ?').run(targetPath);
  } catch (err) {
    throw new Error('La sauvegarde a échoué. Vérifiez que la clé USB est branchée et qu’il reste de la place.');
  }
  inspectBackup(targetPath); // relit le fichier pour s'assurer qu'il est utilisable
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'last_backup_at'`).run(now.toISOString());
  return targetPath;
}

// Vérifie qu'un fichier est une sauvegarde utilisable et en donne un résumé.
function inspectBackup(filePath) {
  const invalid = () => new Error('Ce fichier n’est pas une sauvegarde valide de ce logiciel.');
  let backup;
  try {
    backup = new DatabaseSync(filePath, { readOnly: true });
  } catch (err) {
    throw invalid();
  }
  try {
    let version;
    try {
      if (backup.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw invalid();
      version = backup.prepare('PRAGMA user_version').get().user_version;
      const tables = backup.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name);
      if (version < 1 || !['settings', 'clients', 'invoices'].every((t) => tables.includes(t))) throw invalid();
    } catch (err) {
      throw invalid();
    }
    if (version > SCHEMA_VERSION) {
      throw new Error('Cette sauvegarde vient d’une version plus récente du logiciel. Installez la mise à jour avant de la restaurer.');
    }
    const count = (sql) => backup.prepare(sql).get().n;
    const company = backup.prepare(`SELECT value FROM settings WHERE key = 'company_name'`).get();
    return {
      company_name: company ? company.value : '',
      clients: count('SELECT COUNT(*) AS n FROM clients WHERE archived = 0'),
      invoices: count(`SELECT COUNT(*) AS n FROM invoices WHERE status = 'emise' AND kind = 'facture'`),
      last_invoice_date: backup.prepare(`SELECT MAX(issue_date) AS d FROM invoices WHERE status = 'emise'`).get().d,
      modified_at: fs.statSync(filePath).mtime.toISOString(),
    };
  } finally {
    backup.close();
  }
}

module.exports = { createBackup, inspectBackup };
