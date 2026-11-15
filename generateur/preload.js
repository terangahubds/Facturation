'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('generateur', {
  getState: () => ipcRenderer.invoke('getState'),
  chooseKey: () => ipcRenderer.invoke('chooseKey'),
  makeLicence: (data) => ipcRenderer.invoke('makeLicence', data),
  showFile: (filePath) => ipcRenderer.invoke('showFile', filePath),
});
