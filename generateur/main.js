'use strict';
// Générateur de licences : programme du vendeur, distinct de l'application livrée aux clients.
// La clé privée n'est jamais incluse dans ce programme : le vendeur la choisit au premier lancement,
// et une copie est gardée dans le dossier de données du générateur, sur son ordinateur.

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const { createLicence, checkLicence, normalizeCode } = require('../src/core/licence');
const PUBLIC_KEY = require('../src/core/licence-key');

// Réglages réservés aux tests automatiques, ignorés dans le programme empaqueté.
const testSetting = (name) => (app.isPackaged ? undefined : process.env[name]);

// Dates et fenêtres du système affichées en français, quel que soit le réglage de Windows.
app.commandLine.appendSwitch('lang', 'fr');

// Dossier de données propre au générateur, séparé de celui de l'application de facturation.
app.setPath('userData', testSetting('GENERATEUR_DATA_DIR') || path.join(app.getPath('appData'), 'facturation-generateur'));

const keyFile = () => path.join(app.getPath('userData'), 'cle-privee.pem');
const journalFile = () => path.join(app.getPath('userData'), 'licences-creees.json');

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readJournal() {
  try { return JSON.parse(fs.readFileSync(journalFile(), 'utf8')); } catch (err) { return []; }
}

// Indique si la clé privée fournie est utilisable, et si elle correspond à la clé publique
// de l'application : sinon les licences créées seraient refusées chez les clients.
function inspectKey(pem) {
  try {
    const derived = crypto.createPublicKey(crypto.createPrivateKey(pem)).export({ type: 'spki', format: 'pem' });
    return { valid: true, matches: derived.trim() === PUBLIC_KEY.trim() };
  } catch (err) {
    return { valid: false, matches: false };
  }
}

function getState() {
  let key = { valid: false, matches: false };
  let hasKey = false;
  try {
    key = inspectKey(fs.readFileSync(keyFile(), 'utf8'));
    hasKey = key.valid;
  } catch (err) { /* pas encore de clé */ }
  return { hasKey, keyMatches: key.matches, journal: readJournal().slice().reverse(), version: app.getVersion() };
}

async function chooseKey(parent) {
  let source = testSetting('GENERATEUR_KEY_FILE');
  if (!source) {
    const choice = await dialog.showOpenDialog(parent, {
      title: 'Choisir votre clé privée',
      properties: ['openFile'],
      filters: [{ name: 'Clé privée', extensions: ['pem'] }, { name: 'Tous les fichiers', extensions: ['*'] }],
    });
    if (choice.canceled || choice.filePaths.length === 0) return null;
    source = choice.filePaths[0];
  }
  let pem;
  try {
    if (fs.statSync(source).size > 10000) throw new Error('trop gros');
    pem = fs.readFileSync(source, 'utf8');
  } catch (err) {
    throw new Error('Ce fichier n’est pas une clé privée.');
  }
  if (!inspectKey(pem).valid) throw new Error('Ce fichier n’est pas une clé privée valide.');
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(keyFile(), pem, { mode: 0o600 });
  return getState();
}

async function makeLicence(parent, { machine, name, expires }) {
  let pem;
  try { pem = fs.readFileSync(keyFile(), 'utf8'); } catch (err) { throw new Error('Choisissez d’abord votre clé privée.'); }
  const code = normalizeCode(machine);
  const holder = String(name || '').trim();
  const end = expires || null;
  if (end && end < today()) throw new Error('La date de fin est déjà passée.');
  const text = createLicence({ machine: code, name: holder, expires: end, issued: today() }, pem);
  // Relit la licence comme le fera l'application du client, pour ne jamais remettre un fichier inutilisable.
  if (checkLicence(text, code, PUBLIC_KEY, today()).status !== 'valide') {
    throw new Error('Votre clé privée ne correspond pas à l’application : cette licence serait refusée chez le client.');
  }

  const fileName = `${holder.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}-${code}.licence`;
  let target = testSetting('GENERATEUR_SAVE_PATH');
  if (!target) {
    const choice = await dialog.showSaveDialog(parent, {
      title: 'Enregistrer la licence',
      defaultPath: path.join(app.getPath('documents'), fileName),
      filters: [{ name: 'Licence Facturation', extensions: ['licence'] }],
    });
    if (choice.canceled || !choice.filePath) return null;
    target = choice.filePath;
  }
  try {
    fs.writeFileSync(target, `${text}\n`);
  } catch (err) {
    throw new Error('Impossible d’enregistrer le fichier à cet endroit.');
  }
  const journal = readJournal();
  journal.push({ created: new Date().toISOString(), name: holder, machine: code, expires: end, file: target });
  fs.writeFileSync(journalFile(), JSON.stringify(journal, null, 2));
  return { file: target, state: getState() };
}

app.whenReady().then(() => {
  const parentOf = (event) => BrowserWindow.fromWebContents(event.sender);
  ipcMain.handle('getState', () => getState());
  ipcMain.handle('chooseKey', (event) => chooseKey(parentOf(event)));
  ipcMain.handle('makeLicence', (event, data) => makeLicence(parentOf(event), data));
  ipcMain.handle('showFile', (_event, filePath) => shell.showItemInFolder(filePath));

  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 860, height: 760, minWidth: 640, minHeight: 520,
    title: 'Générateur de licences',
    backgroundColor: '#F5F6F8',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
});

app.on('window-all-closed', () => app.quit());
