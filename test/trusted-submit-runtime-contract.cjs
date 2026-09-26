'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const permits = require('../ui/trusted-submit-permits.js');
const runtimeApi = require('../ui/trusted-submit-runtime.js');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8').replace(/\r\n?/g, '\n');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');

let seq = 0;
let time = 1000;
const authority = permits.createAuthority({
  now: () => time,
  idFactory: () => 'gesture-permit-' + (++seq),
  ttlMs: 2000,
  maxRecords: 8,
});
const runtime = runtimeApi.create({
  authority,
  familyOf: type => ({ key: type === 'telegram-k' || type === 'telegram-z' ? 'telegram' : type }),
});
const webview = { getWebContentsId: () => 77 };
const account = { id: 'account-private', partition: 'persist:webview-page-private', type: 'telegram-k' };

assert.equal(runtime.registerWebview(webview), 0);
assert.equal(runtime.generationFor(webview), 0);
const observed = runtime.observeGesture(account, webview, { protocolVersion: 1, platform: 'telegram', kind: 'keyboard' });
assert.deepEqual(
  { accepted: observed.accepted, kind: observed.kind, expiresAt: observed.expiresAt, webviewGeneration: observed.webviewGeneration },
  { accepted: true, kind: 'keyboard', expiresAt: 3000, webviewGeneration: 0 },
);
const observedJson = JSON.stringify(observed);
for (const forbidden of ['gesture-permit-1', 'account-private', 'persist:webview-page-private', '77']) {
  assert.equal(observedJson.includes(forbidden), false, 'gesture observation leaked ' + forbidden);
}
const taken = runtime.takeLatest(account, webview, 'keyboard');
assert.equal(taken.permitId, 'gesture-permit-1');
assert.equal(taken.kind, 'keyboard');
assert.throws(() => runtime.takeLatest(account, webview), error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_NO_PERMIT');

runtime.observeGesture(account, webview, { protocolVersion: 1, platform: 'telegram', kind: 'button' });
assert.equal(runtime.advanceGeneration(webview), 1);
assert.equal(runtime.generationFor(webview), 1);
assert.throws(() => runtime.takeLatest(account, webview), error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_NO_PERMIT', 'navigation generation must invalidate the previous latest permit');

runtime.observeGesture(account, webview, { protocolVersion: 1, platform: 'telegram', kind: 'keyboard' });
const staleAccount = { ...account, id: 'other-account' };
assert.throws(
  () => runtime.takeLatest(staleAccount, webview),
  error => error?.code === 'SUBMIT_PERMIT_STALE_BINDING' && error?.field === 'accountId',
);
assert.throws(() => runtime.takeLatest(account, webview), error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_NO_PERMIT', 'failed consume stays fail-closed and does not restore latest authority');

assert.throws(
  () => runtime.observeGesture(account, webview, { protocolVersion: 2, platform: 'telegram', kind: 'keyboard' }),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_PROTOCOL',
);
assert.throws(
  () => runtime.observeGesture(account, webview, { protocolVersion: 1, platform: 'whatsapp', kind: 'button' }),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_PLATFORM',
);
assert.throws(
  () => runtime.observeGesture({ ...account, type: 'whatsapp' }, webview, { protocolVersion: 1, platform: 'telegram', kind: 'button' }),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_PLATFORM',
);

assert.match(app, /GeekTrustedSubmitPermits\.createAuthority\(\)/);
assert.match(app, /GeekTrustedSubmitRuntime\.create\(\{[\s\S]*authority: trustedSubmitPermitAuthority,[\s\S]*familyOf/);
assert.match(app, /trustedSubmitRuntime\.registerWebview\(wv\);[\s\S]*did-start-navigation[\s\S]*trustedSubmitRuntime\.advanceGeneration\(wv\)/);
assert.match(app, /render-process-gone[\s\S]*trustedSubmitRuntime\.advanceGeneration\(wv\)/);
assert.match(app, /const TRUSTED_SUBMIT_CHANNEL = 'geek-trusted-submit'/);
assert.match(app, /handleTrustedSubmitGesture\(wv, event\)/);
assert.match(app, /handleLineTranslationIpc\(wv, event\); handleGeekBridgeIpc\(wv, event\); handleTrustedSubmitGesture\(wv, event\);/);
assert.match(html, /trusted-submit-permits\.js[\s\S]*trusted-submit-runtime\.js[\s\S]*send-intent-coordinator\.js[\s\S]*app\.js/);

console.log('TRUSTED_SUBMIT_RUNTIME_CONTRACT_OK');
