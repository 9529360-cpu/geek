'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  OUTPUT_KEYS,
  collectAuthenticatedLineState,
  buildProbeExpression,
  buildHostBridgeExpression,
  projectProbeState,
  formatProbeOutput,
  isGeekHostTarget,
  isLocalDebuggerSocket,
  parseTargetIndex,
  evaluateTarget,
  probeLineWebviewState,
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
  assert.deepEqual(state, Object.fromEntries(OUTPUT_KEYS.map((key) => [key, true])));
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
  assert.doesNotMatch(output, /secret-access-token-value|secret-hmac-value|example\.invalid|private-account-id/);

  const expression = buildProbeExpression();
  assert.match(expression, /accessTokenPresent/);
  assert.match(expression, /hmacProduced/);
  assert.doesNotMatch(expression, /console\.|document\.cookie|localStorage|location\.href|textContent|innerHTML|outerHTML/);

  const hostExpression = buildHostBridgeExpression(0);
  assert.match(hostExpression, /querySelectorAll\('webview'\)/);
  assert.match(hostExpression, /executeJavaScript/);
  assert.match(hostExpression, /ophjlpahpchlmihnnnihgmmeilfjmjjc/);
  assert.match(hostExpression, /PROBE_RESULT/);
  assert.doesNotMatch(hostExpression, /console\.|document\.cookie|localStorage|textContent|innerHTML|outerHTML/);

  assert.equal(isGeekHostTarget({
    type: 'page',
    url: 'file:///C:/work/geek/ui/index.html',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9344/devtools/page/abc',
  }), true);
  assert.equal(isGeekHostTarget({
    type: 'page',
    url: 'file:///C:/work/geek/ui/index.html?secret=1',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9344/devtools/page/abc',
  }), true);
  assert.equal(isGeekHostTarget({
    type: 'page',
    url: 'https://example.com/ui/index.html',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9344/devtools/page/abc',
  }), false);
  assert.equal(isGeekHostTarget({
    type: 'page',
    url: 'file:///C:/work/geek/ui/index.html',
    webSocketDebuggerUrl: 'ws://localhost:9344/devtools/page/abc',
  }), false);

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
  let nextValue = { kind: 'PROBE_RESULT', state: rawState };
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
          data: JSON.stringify({ id: request.id, result: { result: { value: nextValue } } }),
        }));
      }
    }
    close() {}
  }

  const hostTarget = {
    type: 'page',
    url: 'file:///C:/work/geek/ui/index.html',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9344/devtools/page/abc',
  };
  const evaluated = await evaluateTarget(hostTarget, 'SAFE_HOST_EXPRESSION', { WebSocketCtor: FakeWebSocket });
  assert.deepEqual(evaluated, nextValue);
  assert.equal(evaluateParams.expression, 'SAFE_HOST_EXPRESSION');
  assert.equal(evaluateParams.awaitPromise, true);
  assert.equal(evaluateParams.returnByValue, true);
  assert.equal(evaluateParams.userGesture, false);
  assert.equal(evaluateParams.includeCommandLineAPI, false);
  assert.equal(evaluateParams.silent, true);

  const probed = await probeLineWebviewState([hostTarget], 0, { WebSocketCtor: FakeWebSocket });
  assert.deepEqual(Object.keys(probed), OUTPUT_KEYS);
  assert.ok(Object.values(probed).every((value) => typeof value === 'boolean'));
  assert.doesNotMatch(JSON.stringify(probed), /secret-access-token-value|secret-hmac-value|example\.invalid|private-account-id/);
  assert.match(evaluateParams.expression, /executeJavaScript/);

  nextValue = { kind: 'LINE_TARGET_NOT_FOUND', secret: fakeToken };
  await assert.rejects(() => probeLineWebviewState([hostTarget], 0, { WebSocketCtor: FakeWebSocket }), /LINE_TARGET_NOT_FOUND/);
  nextValue = { kind: 'TARGET_INDEX_OUT_OF_RANGE', accountId: 'private-account-id' };
  await assert.rejects(() => probeLineWebviewState([hostTarget], 3, { WebSocketCtor: FakeWebSocket }), /TARGET_INDEX_OUT_OF_RANGE/);
  nextValue = { kind: 'PROBE_EVALUATION_FAILED', detail: fakeHmac };
  await assert.rejects(() => probeLineWebviewState([hostTarget], 0, { WebSocketCtor: FakeWebSocket }), /PROBE_EVALUATION_FAILED/);
  await assert.rejects(() => probeLineWebviewState([], 0, { WebSocketCtor: FakeWebSocket }), /GEEK_HOST_TARGET_NOT_FOUND/);

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
  assert.match(source, /GEEK_HOST_PAGE_SUFFIX = '\/ui\/index\.html'/);

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
