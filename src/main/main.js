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

app.whenReady().then(() => {
  const dataDir = process.env.FACTURATION_DATA_DIR || app.getPath('userData');
  fs.mkdirSync(dataDir, { recursive: true });
  db = openDatabase(path.join(dataDir, 'facturation.sqlite'));

  ipcMain.handle('api', (_event, name, ...args) => {
    if (!Object.hasOwn(API, name)) throw new Error(`Opération inconnue : ${name}`);
    return API[name](db, ...args);
  });

  ipcMain.handle('exportPdf', (event, kind, id) => exportPdf(BrowserWindow.fromWebContents(event.sender), kind, id));
  ipcMain.handle('printDocument', (_event, kind, id) => printDocument(kind, id));
  ipcMain.handle('showFile', (_event, filePath) => shell.showItemInFolder(filePath));

  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  if (db) db.close();
  app.quit();
});
