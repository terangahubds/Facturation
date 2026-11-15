'use strict';
// Seul point de contact entre l'interface et le reste de l'application.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  call: (name, ...args) => ipcRenderer.invoke('api', name, ...args),
  exportInvoicePdf: (id) => ipcRenderer.invoke('exportInvoicePdf', id),
  printInvoice: (id) => ipcRenderer.invoke('printInvoice', id),
  showFile: (filePath) => ipcRenderer.invoke('showFile', filePath),
});
