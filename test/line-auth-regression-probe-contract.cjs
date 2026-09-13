'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  OUTPUT_KEYS,
  collectAuthenticatedLineState,
  buildProbeExpression,
  projectProbeState,
  formatProbeOutput,
  isLineExtensionTarget,
  isLocalDebuggerSocket,
  parseTargetIndex,
  evaluateTarget,
} = require('../scripts/line-auth-regression-probe.cjs');

(async () => {
  const fakeToken = 'secret-access-token-value';
  const fakeHmac = 'secret-hmac-value';
  const calls = [];
  const fakeRoot = {
    GeekAuthenticatedEventSource() {},
    _pluginKD() {},
    chrome: { runtime: {} },
    g_plugin_enc: () => ({ getAccessToken: () => fakeToken }),
    g_plugin_hmac: () => ({
      getHmac: async (input) => {
        calls.push(input);
        return fakeHmac;
      },
    }),
  };

  const state = await collectAuthenticatedLineState(fakeRoot, { readyState: 'complete' });
  assert.deepEqual(state, {
    pageReady: true,
    tokenManagerAvailable: true,
    accessTokenPresent: true,
    hmacManagerAvailable: true,
    hmacProduced: true,
    authenticatedEventSourceAvailable: true,
    pluginKeyWrapperAvailable: true,
    chromeRuntimeAvailable: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].accessToken, fakeToken);
  assert.equal(calls[0].path, '/api/operation/receive');
  assert.equal(calls[0].body, undefined);

  const rawState = {
    ...state,
    accessToken: fakeToken,
    hmac: fakeHmac,
    url: 'https://example.invalid/?secret=1',
    accountId: 'private-account-id',
  };
  const projected = projectProbeState(rawState);
  assert.deepEqual(Object.keys(projected), OUTPUT_KEYS);
  assert.ok(Object.values(projected).every((value) => typeof value === 'boolean'));
  const output = formatProbeOutput(rawState);
  assert.doesNotMatch(output, /secret-access-token-value/);
  assert.doesNotMatch(output, /secret-hmac-value/);
  assert.doesNotMatch(output, /example\.invalid/);
  assert.doesNotMatch(output, /private-account-id/);
  assert.ok(Object.values(JSON.parse(output)).every((value) => typeof value === 'boolean'));

  const throwing = await collectAuthenticatedLineState({
    GeekAuthenticatedEventSource() {},
    _pluginKD() {},
    chrome: { runtime: {} },
    g_plugin_enc() { throw new Error(`token=${fakeToken}`); },
    g_plugin_hmac() { throw new Error(`hmac=${fakeHmac}`); },
  }, { readyState: 'interactive' });
  assert.equal(throwing.pageReady, true);
  assert.equal(throwing.accessTokenPresent, false);
  assert.equal(throwing.hmacProduced, false);
  assert.doesNotMatch(formatProbeOutput(throwing), /secret-/);

  const missing = await collectAuthenticatedLineState({}, { readyState: 'loading' });
  assert.deepEqual(missing, Object.fromEntries(OUTPUT_KEYS.map((key) => [key, false])));

  const expression = buildProbeExpression();
  assert.match(expression, /accessTokenPresent/);
  assert.match(expression, /hmacProduced/);
  assert.doesNotMatch(expression, /console\./);
  assert.doesNotMatch(expression, /document\.cookie/);
  assert.doesNotMatch(expression, /localStorage/);
  assert.doesNotMatch(expression, /location\.href/);
  assert.doesNotMatch(expression, /textContent/);
  assert.doesNotMatch(expression, /innerHTML/);
  assert.doesNotMatch(expression, /outerHTML/);

  assert.equal(isLineExtensionTarget({
    type: 'page',
    url: 'chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc/index.html#/chat',
  }), true);
  assert.equal(isLineExtensionTarget({
    type: 'page',
    url: 'chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc/other.html',
  }), false);
  assert.equal(isLineExtensionTarget({
    type: 'page',
    url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/index.html',
  }), false);
  assert.equal(isLineExtensionTarget({ type: 'page', url: 'https://example.com/' }), false);
  assert.equal(isLineExtensionTarget({ type: 'worker', url: 'chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc/index.html' }), false);

  assert.equal(isLocalDebuggerSocket('ws://127.0.0.1:9344/devtools/page/abc'), true);
  assert.equal(isLocalDebuggerSocket('ws://localhost:9344/devtools/page/abc'), false);
  assert.equal(isLocalDebuggerSocket('ws://127.0.0.1:9345/devtools/page/abc'), false);
  assert.equal(isLocalDebuggerSocket('wss://127.0.0.1:9344/devtools/page/abc'), false);
  assert.equal(isLocalDebuggerSocket('ws://127.0.0.1:9344/devtools/browser/abc'), false);

  assert.equal(parseTargetIndex(undefined), 0);
  assert.equal(parseTargetIndex('0'), 0);
  assert.equal(parseTargetIndex('12'), 12);
  assert.throws(() => parseTargetIndex('-1'), /TARGET_INDEX_INVALID/);
  assert.throws(() => parseTargetIndex('1x'), /TARGET_INDEX_INVALID/);
  assert.throws(() => parseTargetIndex('01'), /TARGET_INDEX_INVALID/);

  let evaluateParams = null;
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      queueMicrotask(() => this.onopen?.());
    }
    send(raw) {
      const request = JSON.parse(raw);
      if (request.method === 'Runtime.enable') {
        queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ id: request.id, result: {} }) }));
        return;
      }
      if (request.method === 'Runtime.evaluate') {
        evaluateParams = request.params;
        queueMicrotask(() => this.onmessage?.({
          data: JSON.stringify({
            id: request.id,
            result: {
              result: {
                value: {
                  ...state,
                  accessToken: fakeToken,
                  hmac: fakeHmac,
                },
              },
            },
          }),
        }));
      }
    }
    close() {}
  }

  const evaluated = await evaluateTarget({
    webSocketDebuggerUrl: 'ws://127.0.0.1:9344/devtools/page/abc',
  }, 'SAFE_PROBE_EXPRESSION', { WebSocketCtor: FakeWebSocket });
  assert.deepEqual(Object.keys(evaluated), OUTPUT_KEYS);
  assert.ok(Object.values(evaluated).every((value) => typeof value === 'boolean'));
  assert.doesNotMatch(JSON.stringify(evaluated), /secret-/);
  assert.equal(evaluateParams.expression, 'SAFE_PROBE_EXPRESSION');
  assert.equal(evaluateParams.awaitPromise, true);
  assert.equal(evaluateParams.returnByValue, true);
  assert.equal(evaluateParams.userGesture, false);
  assert.equal(evaluateParams.includeCommandLineAPI, false);
  assert.equal(evaluateParams.silent, true);
  await assert.rejects(
    () => evaluateTarget({ webSocketDebuggerUrl: 'ws://localhost:9344/devtools/page/abc' }, 'x', { WebSocketCtor: FakeWebSocket }),
    /DEBUG_TARGET_SOCKET_INVALID/
  );

  const source = fs.readFileSync(path.join(__dirname, '../scripts/line-auth-regression-probe.cjs'), 'utf8');
  assert.doesNotMatch(source, /writeFile|appendFile|createWriteStream/);
  assert.doesNotMatch(source, /document\.cookie|localStorage|location\.href|textContent|innerHTML|outerHTML/);
  assert.doesNotMatch(source, /Authorization/);
  assert.match(source, /hostname:\s*DEBUG_HOST/);
  assert.match(source, /DEBUG_HOST = '127\.0\.0\.1'/);
  assert.match(source, /DEBUG_PORT = 9344/);

  const srcDir = path.join(__dirname, '../src');
  function productionSourceFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...productionSourceFiles(fullPath));
      else if (/\.(?:cjs|mjs|js)$/.test(entry.name)) files.push(fullPath);
    }
    return files;
  }
  for (const file of productionSourceFiles(srcDir)) {
    const runtimeSource = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(runtimeSource, /line-auth-regression-probe/, 'production runtime must not import the local authenticated LINE probe');
  }

  console.log('LINE_AUTH_REGRESSION_PROBE_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
