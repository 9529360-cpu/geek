'use strict';
const { ipcRenderer } = require('electron');
window.__geekTranslationGateway = Object.freeze({
  translate: (payload) => ipcRenderer.invoke('translation:guest', payload),
});
