'use strict';

const SUPPORTED_ACCOUNT_TYPES = Object.freeze(new Set([
  'whatsapp',
  'whatsapp-pure',
  'telegram-z',
  'telegram-k',
  'line',
  'line-business',
]));

function validateAccountAddPayload(payload) {
  if (typeof payload === 'string' || payload == null) return;
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    const error = new Error('ACCOUNT_PAYLOAD_INVALID');
    error.code = 'ACCOUNT_PAYLOAD_INVALID';
    throw error;
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'type')) return;
  const type = String(payload.type || '').trim();
  if (!type || !SUPPORTED_ACCOUNT_TYPES.has(type)) {
    const error = new Error('ACCOUNT_TYPE_UNSUPPORTED');
    error.code = 'ACCOUNT_TYPE_UNSUPPORTED';
    throw error;
  }
}

function installAccountTypeBoundary({ ipcMain } = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('ipcMain.handle is required');
  const originalHandle = ipcMain.handle.bind(ipcMain);
  let installed = true;
  ipcMain.handle = (channel, handler) => {
    if (channel !== 'accounts:add') return originalHandle(channel, handler);
    return originalHandle(channel, (event, payload) => {
      validateAccountAddPayload(payload);
      return handler(event, payload);
    });
  };
  return Object.freeze({
    restore() {
      if (!installed) return;
      installed = false;
      ipcMain.handle = originalHandle;
    },
  });
}

module.exports = {
  SUPPORTED_ACCOUNT_TYPES,
  validateAccountAddPayload,
  installAccountTypeBoundary,
};
