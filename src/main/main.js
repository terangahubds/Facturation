'use strict';
// Processus principal : ouvre la fenêtre et la base de données locale.
// L'interface n'accède jamais à la base directement : elle passe par la liste
// d'opérations autorisées ci-dessous.

const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { openDatabase } = require('../core/db');
const catalog = require('../core/catalog');
const invoices = require('../core/invoices');

const API = {
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

app.whenReady().then(() => {
  const dataDir = process.env.FACTURATION_DATA_DIR || app.getPath('userData');
  fs.mkdirSync(dataDir, { recursive: true });
  db = openDatabase(path.join(dataDir, 'facturation.sqlite'));

  ipcMain.handle('api', (_event, name, ...args) => {
    if (!Object.hasOwn(API, name)) throw new Error(`Opération inconnue : ${name}`);
    return API[name](db, ...args);
  });

  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  if (db) db.close();
  app.quit();
});
