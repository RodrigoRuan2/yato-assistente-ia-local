'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('chibiNative', {
  close: () => ipcRenderer.send('chibi-close'),
  movement: value => ipcRenderer.send('chibi-movement', value),
  effects: value => ipcRenderer.send('chibi-effects', value),
  onAction: callback => ipcRenderer.on('chibi-action', (_event, value) => callback(value)),
  onMotion: callback => ipcRenderer.on('chibi-motion', (_event, value) => callback(value)),
});
