'use strict';

const http = require('node:http');

const DEBUG_PORT = 9344;
const LINE_EXTENSION_PREFIX = 'chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc/';

async function collectAuthenticatedLineState(root, documentRef) {
  const state = {
    pageReady: documentRef?.readyState === 'interactive' || documentRef?.readyState === 'complete',
    tokenManagerAvailable: false,
    accessTokenPresent: false,
    hmacManagerAvailable: false,
    hmacProduced: false,
    authenticatedEventSourceAvailable: typeof root?.GeekAuthenticatedEventSource === 'function',
    pluginKeyWrapperAvailable: typeof root?._pluginKD === 'function'
  };

  try {
    state.tokenManagerAvailable = typeof root?.g_plugin_enc === 'function';
    const tokenManager = state.tokenManagerAvailable ? root.g_plugin_enc() : null;
    const accessToken = tokenManager?.getAccessToken?.() || '';
    state.accessTokenPresent = typeof accessToken === 'string' && accessToken.length > 0;

    state.hmacManagerAvailable = typeof root?.g_plugin_hmac === 'function';
    const hmacManager = state.hmacManagerAvailable ? root.g_plugin_hmac() : null;
    if (state.accessTokenPresent && typeof hmacManager?.getHmac === 'function') {
      const hmac = await hmacManager.getHmac({
        accessToken,
        path: '/api/operation/receive',
        body: undefined
      });
      state.hmacProduced = typeof hmac === 'string' && hmac.length > 0;
    }
  } catch {
    // Deliberately return booleans only. Never surface auth values or page exceptions.
  }

  return state;
}

function buildProbeExpression() {
  return `(${collectAuthenticatedLineState.toString()})(window, document)`;
}

function getJson(pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port: DEBUG_PORT, path: pathname }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error('INVALID_DEBUG_RESPONSE')); }
      });
    });
    request.on('error', () => reject(new Error('DEBUG_PORT_UNAVAILABLE')));
  });
}

async function evaluateTarget(target, expression) {
  if (typeof WebSocket !== 'function') throw new Error('WEBSOCKET_UNAVAILABLE');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let messageId = 0;
  const pending = new Map();

  ws.onmessage = event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error('CDP_COMMAND_FAILED'));
    else entry.resolve(message.result);
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('CDP_CONNECT_FAILED'));
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++messageId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  try {
    await send('Runtime.enable');
    const response = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: false
    });
    if (response.exceptionDetails) throw new Error('PROBE_EVALUATION_FAILED');
    const value = response.result?.value;
    if (!value || typeof value !== 'object') throw new Error('PROBE_RESULT_INVALID');
    return value;
  } finally {
    ws.close();
  }
}

async function main() {
  const requestedIndex = Number.parseInt(process.argv[2] || '0', 10);
  if (!Number.isInteger(requestedIndex) || requestedIndex < 0) throw new Error('TARGET_INDEX_INVALID');

  const targets = await getJson('/json');
  const lineTargets = Array.isArray(targets)
    ? targets.filter(target => target?.type === 'page' && String(target?.url || '').startsWith(LINE_EXTENSION_PREFIX))
    : [];
  if (!lineTargets.length) throw new Error('LINE_TARGET_NOT_FOUND');
  if (requestedIndex >= lineTargets.length) throw new Error('TARGET_INDEX_OUT_OF_RANGE');

  const state = await evaluateTarget(lineTargets[requestedIndex], buildProbeExpression());
  const output = {
    targetCount: lineTargets.length,
    targetIndex: requestedIndex,
    pageReady: state.pageReady === true,
    tokenManagerAvailable: state.tokenManagerAvailable === true,
    accessTokenPresent: state.accessTokenPresent === true,
    hmacManagerAvailable: state.hmacManagerAvailable === true,
    hmacProduced: state.hmacProduced === true,
    authenticatedEventSourceAvailable: state.authenticatedEventSourceAvailable === true,
    pluginKeyWrapperAvailable: state.pluginKeyWrapperAvailable === true
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    const allowed = new Set([
      'INVALID_DEBUG_RESPONSE', 'DEBUG_PORT_UNAVAILABLE', 'WEBSOCKET_UNAVAILABLE',
      'CDP_CONNECT_FAILED', 'CDP_COMMAND_FAILED', 'PROBE_EVALUATION_FAILED',
      'PROBE_RESULT_INVALID', 'TARGET_INDEX_INVALID', 'LINE_TARGET_NOT_FOUND',
      'TARGET_INDEX_OUT_OF_RANGE'
    ]);
    const code = allowed.has(error?.message) ? error.message : 'UNKNOWN_FAILURE';
    process.stderr.write(`LINE_AUTH_REGRESSION_PROBE_FAILED:${code}\n`);
    process.exit(1);
  });
}

module.exports = { collectAuthenticatedLineState, buildProbeExpression };
