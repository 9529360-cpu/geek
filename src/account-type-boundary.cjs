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

  const delegatedHandle = ipcMain.handle;
  let restoreTarget = delegatedHandle;
  let installed = true;

  function guardedHandle(channel, handler) {
    const isAccountAdd = channel === 'accounts:add';
    const wrappedHandler = isAccountAdd
      ? (event, payload) => {
          validateAccountAddPayload(payload);
          return handler(event, payload);
        }
      : handler;

    const result = delegatedHandle.call(ipcMain, channel, wrappedHandler);

    // Current startup has other narrow registration boundaries that temporarily
    // replace ipcMain.handle and restore it once their legacy channels are seen.
    // Track the most recent real owner. Until accounts:add is actually registered,
    // keep this guard active even if a delegated boundary restores handle().
    if (ipcMain.handle !== guardedHandle) restoreTarget = ipcMain.handle;

    if (isAccountAdd) {
      installed = false;
      if (ipcMain.handle === guardedHandle) ipcMain.handle = restoreTarget;
      return result;
    }

    if (installed && ipcMain.handle !== guardedHandle) ipcMain.handle = guardedHandle;
    return result;
  }

  ipcMain.handle = guardedHandle;

  return Object.freeze({
    restore() {
      if (!installed) return;
      installed = false;
      if (ipcMain.handle === guardedHandle) ipcMain.handle = restoreTarget;
    },
  });
}

module.exports = {
  SUPPORTED_ACCOUNT_TYPES,
  validateAccountAddPayload,
  installAccountTypeBoundary,
};
