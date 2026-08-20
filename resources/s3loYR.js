'use strict';

// LINE guest preload bridge.
// LINE remains on the scoped contextIsolation=false compatibility path, so keep
// the page-visible surface deliberately tiny: translation adapters may request
// translation, but the page never receives ipcRenderer or a generic IPC API.
const { ipcRenderer } = require('electron');

const HOST_CHANNEL = 'send2Host';
const REQUEST_TYPE = 'geek-translation-request';
const MAX_ID_LENGTH = 128;
const MAX_TOKEN_LENGTH = 256;

function isBoundedString(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function send2Host(message) {
  if (!message || message.type !== REQUEST_TYPE) return false;
  const id = message.id;
  const token = message.token;
  if (!isBoundedString(id, MAX_ID_LENGTH) || !isBoundedString(token, MAX_TOKEN_LENGTH)) return false;
  ipcRenderer.sendToHost(HOST_CHANNEL, { type: REQUEST_TYPE, id, token });
  return true;
}

try {
  Object.defineProperty(window, '$electron', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({ send2Host })
  });
} catch {
  // The LINE adapter retains its existing console-message fallback.
}
