'use strict';
// Processus principal : ouvre la fenêtre et la base de données locale.
// L'interface n'accède jamais à la base directement : elle passe par la liste
// d'opérations autorisées ci-dessous.

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const { openDatabase } = require('../core/db');
const catalog = require('../core/catalog');
const invoices = require('../core/invoices');
const quotes = require('../core/quotes');
const { getDashboard } = require('../core/dashboard');
const { createBackup, inspectBackup } = require('../core/backup');
const { buildInvoiceHtml, buildQuoteHtml } = require('../core/document');

const API = {
  getDashboard: (database) => getDashboard(database),
  getSettings: catalog.getSettings,
  updateSettings: catalog.updateSettings,
  listClients: catalog.listClients,
  getClient: catalog.getClient,
  createClient: catalog.createClient,
  updateClient: catalog.updateClient,
  archiveClient: catalog.archiveClient,
  listProducts: catalog.listProducts,
  createProduct: catalog.createProduct,
  updateProduct: catalog.updateProduct,
  archiveProduct: catalog.archiveProduct,
  listInvoices: invoices.listInvoices,
  getInvoice: invoices.getInvoice,
  createDraft: invoices.createDraft,
  updateDraft: invoices.updateDraft,
  deleteDraft: invoices.deleteDraft,
  issueInvoice: invoices.issueInvoice,
  recordPayment: invoices.recordPayment,
  createCreditNote: invoices.createCreditNote,
  listQuotes: quotes.listQuotes,
  getQuote: quotes.getQuote,
  createQuote: quotes.createQuote,
  updateQuote: quotes.updateQuote,
  deleteQuote: quotes.deleteQuote,
  sendQuote: quotes.sendQuote,
  setQuoteAnswer: quotes.setQuoteAnswer,
  convertQuoteToInvoice: quotes.convertQuoteToInvoice,
  duplicateQuote: quotes.duplicateQuote,
};

let db;
let dbPath;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Facturation',
    backgroundColor: '#F5F6F8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // L'application est hors ligne : aucune page externe ne s'ouvre dans la fenêtre.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}

// Charge le document dans une fenêtre invisible, exécute l'action, puis la ferme.
async function withDocument(kind, id, action) {
  let doc;
  let html;
  if (kind === 'devis') {
    doc = quotes.getQuote(db, id);
    html = buildQuoteHtml(doc, catalog.getSettings(db));
  } else {
    doc = invoices.getInvoice(db, id);
    const origin = doc.credit_of ? invoices.getInvoice(db, doc.credit_of) : null;
    html = buildInvoiceHtml(doc, catalog.getSettings(db), origin);
  }
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await action(win, doc);
  } finally {
    win.destroy();
  }
}

// Enregistre le PDF à l'endroit choisi par l'utilisateur. Renvoie le chemin, ou null s'il annule.
function exportPdf(parent, kind, id) {
  return withDocument(kind, id, async (win, inv) => {
    let target = process.env.FACTURATION_PDF_PATH; // utilisé par les tests automatiques
    if (!target) {
      const choice = await dialog.showSaveDialog(parent, {
        title: 'Enregistrer le PDF',
        defaultPath: path.join(app.getPath('documents'), `${inv.number}.pdf`),
        filters: [{ name: 'Document PDF', extensions: ['pdf'] }],
      });
      if (choice.canceled || !choice.filePath) return null;
      target = choice.filePath;
    }
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
    try {
      fs.writeFileSync(target, pdf);
    } catch (err) {
      throw new Error('Impossible d\u2019enregistrer le PDF à cet endroit. Vérifiez que le fichier n\u2019est pas ouvert dans un autre programme.');
    }
    return target;
  });
}

// Ouvre la fenêtre d'impression de Windows. Renvoie true si l'impression est lancée, false si l'utilisateur annule.
function printDocument(kind, id) {
  return withDocument(kind, id, (win) => new Promise((resolve, reject) => {
    win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
      if (success) resolve(true);
      else if (!reason || /cancel/i.test(reason)) resolve(false);
      else reject(new Error('L\u2019impression a échoué. Vérifiez qu\u2019une imprimante est installée et allumée.'));
    });
  }));
}

function dateStamp() {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

// Sauvegarde : l'utilisateur choisit l'emplacement (sa clé USB). Renvoie le chemin, ou null s'il annule.
async function backupDatabase(parent) {
  let target = process.env.FACTURATION_BACKUP_PATH; // utilisé par les tests automatiques
  if (!target) {
    const choice = await dialog.showSaveDialog(parent, {
      title: 'Sauvegarder les données',
      defaultPath: path.join(app.getPath('documents'), `sauvegarde-facturation-${dateStamp()}.sauvegarde`),
      filters: [{ name: 'Sauvegarde Facturation', extensions: ['sauvegarde'] }],
    });
    if (choice.canceled || !choice.filePath) return null;
    target = choice.filePath;
  }
  if (path.resolve(target) === path.resolve(dbPath)) throw new Error('Choisissez un autre emplacement que le dossier de l\u2019application.');
  return createBackup(db, target);
}

// Restauration, étape 1 : choisir le fichier et afficher ce qu'il contient avant de confirmer.
async function pickBackup(parent) {
  let source = process.env.FACTURATION_RESTORE_PATH; // utilisé par les tests automatiques
  if (!source) {
    const choice = await dialog.showOpenDialog(parent, {
      title: 'Choisir une sauvegarde',
      properties: ['openFile'],
      filters: [{ name: 'Sauvegarde Facturation', extensions: ['sauvegarde'] }, { name: 'Tous les fichiers', extensions: ['*'] }],
    });
    if (choice.canceled || choice.filePaths.length === 0) return null;
    source = choice.filePaths[0];
  }
  return { path: source, info: inspectBackup(source) };
}

// Restauration, étape 2 : remplace la base par la sauvegarde. Les données actuelles sont d'abord
// copiées à côté de la base ; si la sauvegarde ne s'ouvre pas, elles sont remises en place.
function restoreDatabase(source) {
  if (path.resolve(source) === path.resolve(dbPath)) throw new Error('Ce fichier est la base en cours d\u2019utilisation.');
  inspectBackup(source);
  const safety = path.join(path.dirname(dbPath), 'avant-restauration.sqlite');
  fs.rmSync(safety, { force: true });
  db.prepare('VACUUM INTO ?').run(safety);
  db.close();
  const clearSidecars = () => { for (const ext of ['-wal', '-shm']) fs.rmSync(dbPath + ext, { force: true }); };
  try {
    clearSidecars();
    fs.copyFileSync(source, dbPath);
    db = openDatabase(dbPath);
    // Les données restaurées sont identiques à la sauvegarde : sa date devient celle de la dernière sauvegarde.
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'last_backup_at'`).run(fs.statSync(source).mtime.toISOString());
  } catch (err) {
    clearSidecars();
    fs.copyFileSync(safety, dbPath);
    db = openDatabase(dbPath);
    throw new Error('La restauration a échoué. Vos données actuelles ont été conservées.');
  }
  return true;
}

app.whenReady().then(() => {
  const dataDir = process.env.FACTURATION_DATA_DIR || app.getPath('userData');
  fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, 'facturation.sqlite');
  db = openDatabase(dbPath);

  ipcMain.handle('api', (_event, name, ...args) => {
    if (!Object.hasOwn(API, name)) throw new Error(`Opération inconnue : ${name}`);
    return API[name](db, ...args);
  });

  ipcMain.handle('exportPdf', (event, kind, id) => exportPdf(BrowserWindow.fromWebContents(event.sender), kind, id));
  ipcMain.handle('printDocument', (_event, kind, id) => printDocument(kind, id));
  ipcMain.handle('backupDatabase', (event) => backupDatabase(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle('pickBackup', (event) => pickBackup(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle('restoreDatabase', (_event, source) => restoreDatabase(source));
  ipcMain.handle('showFile', (_event, filePath) => shell.showItemInFolder(filePath));

  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  if (db) db.close();
  app.quit();
});
