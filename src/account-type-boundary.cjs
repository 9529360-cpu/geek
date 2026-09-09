'use strict';

// Keep this narrow boundary in sync with main.cjs APP_TYPES. The focused contract
// derives the formal platform set from main.cjs and fails if either side drifts.
const SUPPORTED_ACCOUNT_TYPES = Object.freeze(new Set([
  'whatsapp',
  'whatsapp-pure',
  'telegram-z',
  'telegram-k',
  'line',
  'line-business',
]));

function accountBoundaryError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function validateAccountAddPayload(payload) {
  // Compatibility: no argument and the historical string form still mean the
  // legacy WhatsApp default. Explicit malformed object shapes do not.
  if (payload === undefined || typeof payload === 'string') return;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw accountBoundaryError('ACCOUNT_PAYLOAD_INVALID');
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'type')) return;

  const type = payload.type;
  if (typeof type !== 'string' || !SUPPORTED_ACCOUNT_TYPES.has(type)) {
    throw accountBoundaryError('ACCOUNT_TYPE_UNSUPPORTED');
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
