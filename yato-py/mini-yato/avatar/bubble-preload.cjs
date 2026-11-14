'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('yatoBubble', {
  onState: callback => ipcRenderer.on('yato-bubble-state', (_event, value) => callback(value)),
  action: value => ipcRenderer.send('yato-bubble-action', value),
  size: height => ipcRenderer.send('yato-bubble-height', height),
  ready: () => ipcRenderer.send('yato-bubble-ready'),
  command: text=>ipcRenderer.invoke('yato-bubble-command',text),
  onFocus: callback=>ipcRenderer.on('yato-bubble-focus',callback),
});
