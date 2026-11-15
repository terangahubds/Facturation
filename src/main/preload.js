'use strict';
// Seul point de contact entre l'interface et le reste de l'application.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  call: (name, ...args) => ipcRenderer.invoke('api', name, ...args),
  exportPdf: (kind, id) => ipcRenderer.invoke('exportPdf', kind, id),
  printDocument: (kind, id) => ipcRenderer.invoke('printDocument', kind, id),
  backupDatabase: () => ipcRenderer.invoke('backupDatabase'),
  pickBackup: () => ipcRenderer.invoke('pickBackup'),
  restoreDatabase: (source) => ipcRenderer.invoke('restoreDatabase', source),
  showFile: (filePath) => ipcRenderer.invoke('showFile', filePath),
});
