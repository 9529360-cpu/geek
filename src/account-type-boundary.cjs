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

module.exports = {
  SUPPORTED_ACCOUNT_TYPES,
  validateAccountAddPayload,
};
