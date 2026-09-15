'use strict';

const assert = require('node:assert/strict');
const { installSubscriptionIpc } = require('../src/subscription-ipc.cjs');
const { MAIN_DOCUMENT_URL } = require('../src/subscription-window-boundary.cjs');

function error(code, status = 0) {
  const value = new Error(code || 'failure');
  if (code) value.code = code;
  if (status) value.status = status;
  return value;
}

function trustedMainEvent() {
  const mainFrame = { url: MAIN_DOCUMENT_URL };
  return { sender: { id: 1, mainFrame }, senderFrame: mainFrame };
}

function createHarness({
  state,
  token = 'secret-translation-token',
  tokenError = null,
  stateError = null,
  switchBeforeAuthorization = null,
  switchOnSecondStateRead = null,
}) {
  const handlers = new Map();
  let authorizationCalls = 0;
  let stateCalls = 0;
  let generation = 1;
  let currentState = { ...(state || {}) };

  function sessionChangedError() {
    return error('SUBSCRIPTION_SESSION_CHANGED');
  }

  const store = {
    async getState() {
      stateCalls += 1;
      if (stateError) throw stateError;
      if (stateCalls === 2 && switchOnSecondStateRead) {
        currentState = { ...switchOnSecondStateRead };
        generation += 1;
      }
      return { ...currentState };
    },
    async getTranslationAuthorization() {
      authorizationCalls += 1;
      if (switchBeforeAuthorization) {
        currentState = { ...switchBeforeAuthorization };
        generation += 1;
      }
      if (tokenError) throw tokenError;
      return Object.freeze({ token, generation, signal: null });
    },
    assertTranslationAuthorizationCurrent(lease) {
      if (!lease || lease.generation !== generation) throw sessionChangedError();
    },
    async refresh() { return {}; },
    async login() { return {}; },
    async register() { return {}; },
    async createOrder() { return {}; },
    async myOrders() { return { orders: [] }; },
    async getQuota() { return { remaining_chars: null }; },
    async logout() { return {}; },
  };
  const boundary = installSubscriptionIpc({
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      removeHandler(channel) { handlers.delete(channel); },
    },
    isTrustedSender: () => true,
    getStore: () => store,
    enterApp: async () => true,
    closeWindow: async () => true,
  });
  return {
    check: () => handlers.get('subscription:translation-readiness')(trustedMainEvent()),
    authorizationCalls: () => authorizationCalls,
    dispose: () => boundary.dispose(),
  };
}

async function runCase(name, options, expected, expectedAuthorizationCalls) {
  const h = createHarness(options);
  try {
    const result = await h.check();
    assert.deepEqual(result, expected, name);
    assert.equal(h.authorizationCalls(), expectedAuthorizationCalls, `${name}: unexpected translation-authorization traffic`);
    for (const forbidden of ['token', 'email', 'user_id', 'account_no', 'account_ref', 'message', 'stack', 'cause', 'generation', 'signal']) {
      assert.equal(Object.hasOwn(result, forbidden), false, `${name}: ${forbidden} must not cross readiness IPC`);
    }
  } finally {
    h.dispose();
  }
}

(async () => {
  await runCase(
    'logged out',
    { state: { loggedIn: false } },
    { ready: false, reason: 'login-required', retryable: false, quota: 'unknown' },
    0,
  );

  await runCase(
    'known exhausted quota',
    { state: { loggedIn: true, remaining_chars: 0, valid: false } },
    { ready: false, reason: 'quota-exhausted', retryable: false, quota: 'exhausted', remaining_chars: 0 },
    0,
  );

  await runCase(
    'known positive quota and valid translation authorization',
    { state: { loggedIn: true, remaining_chars: 321, valid: true } },
    { ready: true, reason: 'ready', retryable: false, quota: 'positive', remaining_chars: 321 },
    1,
  );

  await runCase(
    'unknown quota stays explicitly unknown',
    { state: { loggedIn: true, remaining_chars: 0, valid: true } },
    { ready: true, reason: 'ready', retryable: false, quota: 'unknown' },
    1,
  );

  await runCase(
    'translation authorization rejected drops the preflight quota snapshot',
    { state: { loggedIn: true, remaining_chars: 99, valid: true }, tokenError: error('SUBSCRIPTION_LOGIN_REQUIRED', 401) },
    { ready: false, reason: 'authorization-required', retryable: false, quota: 'unknown' },
    1,
  );

  await runCase(
    'session changed while obtaining translation authorization drops the prior account quota',
    { state: { loggedIn: true, remaining_chars: 99, valid: true }, tokenError: error('SUBSCRIPTION_SESSION_CHANGED') },
    { ready: false, reason: 'session-changed', retryable: true, quota: 'unknown' },
    1,
  );

  await runCase(
    'translation authorization request timed out drops an unproven quota snapshot',
    { state: { loggedIn: true, remaining_chars: 88, valid: true }, tokenError: error('SUBSCRIPTION_REQUEST_TIMEOUT') },
    { ready: false, reason: 'authorization-unavailable', retryable: true, quota: 'unknown' },
    1,
  );

  await runCase(
    'encrypted login state needs recovery',
    { stateError: error('SUBSCRIPTION_TOKEN_DECRYPT_FAILED') },
    { ready: false, reason: 'authorization-recovery-required', retryable: false, quota: 'unknown' },
    0,
  );

  await runCase(
    'disabled account',
    { state: { loggedIn: true, remaining_chars: 77, valid: true }, tokenError: error('account_disabled', 403) },
    { ready: false, reason: 'account-disabled', retryable: false, quota: 'unknown' },
    1,
  );

  await runCase(
    'empty translation token fails closed without projecting the preflight quota',
    { state: { loggedIn: true, remaining_chars: 66, valid: true }, token: '' },
    { ready: false, reason: 'authorization-unavailable', retryable: true, quota: 'unknown' },
    1,
  );

  await runCase(
    'account switch before authorization uses only the new account quota snapshot',
    {
      state: { loggedIn: true, remaining_chars: 99, valid: true },
      switchBeforeAuthorization: { loggedIn: true, remaining_chars: 7, valid: true },
    },
    { ready: true, reason: 'ready', retryable: false, quota: 'positive', remaining_chars: 7 },
    1,
  );

  await runCase(
    'account switch after authorization invalidates the readiness result',
    {
      state: { loggedIn: true, remaining_chars: 99, valid: true },
      switchOnSecondStateRead: { loggedIn: true, remaining_chars: 7, valid: true },
    },
    { ready: false, reason: 'session-changed', retryable: true, quota: 'unknown' },
    1,
  );

  console.log('SUBSCRIPTION_TRANSLATION_READINESS_CONTRACT_OK');
})().catch(errorValue => {
  console.error(errorValue?.stack || errorValue);
  process.exit(1);
});