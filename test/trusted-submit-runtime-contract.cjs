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
assert.equal(runtime.composerGenerationFor(webview), 0);
assert.deepEqual(
  runtime.observeComposer(account, webview, { protocolVersion: 1, platform: 'telegram', composerGeneration: 1 }),
  { accepted: true, composerGeneration: 1, webviewGeneration: 0 },
);
assert.deepEqual(
  runtime.observeComposer(account, webview, { protocolVersion: 1, platform: 'telegram', composerGeneration: 2 }),
  { accepted: true, composerGeneration: 2, webviewGeneration: 0 },
);
assert.equal(runtime.composerGenerationFor(webview), 2);
const observed = runtime.observeGesture(account, webview, { protocolVersion: 1, platform: 'telegram', kind: 'keyboard', composerGeneration: 2 });
assert.deepEqual(
  { accepted: observed.accepted, kind: observed.kind, expiresAt: observed.expiresAt, webviewGeneration: observed.webviewGeneration, composerGeneration: observed.composerGeneration },
  { accepted: true, kind: 'keyboard', expiresAt: 3000, webviewGeneration: 0, composerGeneration: 2 },
);
const observedJson = JSON.stringify(observed);
for (const forbidden of ['gesture-permit-1', 'account-private', 'persist:webview-page-private', '77']) {
  assert.equal(observedJson.includes(forbidden), false, 'gesture observation leaked ' + forbidden);
}
const taken = runtime.takeLatest(account, webview, 'keyboard');
assert.equal(taken.permitId, 'gesture-permit-1');
assert.equal(taken.kind, 'keyboard');
assert.equal(taken.composerGeneration, 2);
assert.throws(() => runtime.observeGesture(account, webview, { protocolVersion: 1, platform: 'telegram', kind: 'button', composerGeneration: 2 }), error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_BUSY', 'an active send rejects rapid duplicate gestures');
const firstLease = { generation: taken.webviewGeneration, permitId: taken.permitId };
assert.equal(firstLease.generation, 0);
assert.equal(firstLease.permitId, taken.permitId);
assert.equal(runtime.release(webview, firstLease), true);
assert.throws(() => runtime.takeLatest(account, webview), error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_NO_PERMIT');

runtime.observeGesture(account, webview, { protocolVersion: 1, platform: 'telegram', kind: 'button', composerGeneration: 3 });
runtime.observeComposer(account, webview, { protocolVersion: 1, platform: 'telegram', composerGeneration: 4 });
assert.equal(runtime.composerGenerationFor(webview), 4);
assert.throws(
  () => runtime.takeLatest(account, webview),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_NO_PERMIT',
  'trusted edit after submit must invalidate the old unconsumed permit',
);
assert.throws(
  () => runtime.observeComposer(account, webview, { protocolVersion: 1, platform: 'telegram', composerGeneration: 3 }),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_STALE_COMPOSER' && error?.field === 'composerGeneration',
);
assert.throws(
  () => runtime.observeGesture(account, webview, { protocolVersion: 1, platform: 'telegram', kind: 'keyboard', composerGeneration: 3 }),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_STALE_COMPOSER' && error?.field === 'composerGeneration',
);

runtime.observeGesture(account, webview, { protocolVersion: 1, platform: 'telegram', kind: 'keyboard', composerGeneration: 4 });
assert.equal(runtime.advanceGeneration(webview), 1);
assert.equal(runtime.generationFor(webview), 1);
assert.equal(runtime.composerGenerationFor(webview), 0);
assert.throws(() => runtime.takeLatest(account, webview), error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_NO_PERMIT', 'navigation generation must invalidate the previous latest permit');

runtime.observeGesture(account, webview, { protocolVersion: 1, platform: 'telegram', kind: 'keyboard', composerGeneration: 6 });
const staleAccount = { ...account, id: 'other-account' };
assert.throws(
  () => runtime.takeLatest(staleAccount, webview),
  error => error?.code === 'SUBMIT_PERMIT_STALE_BINDING' && error?.field === 'accountId',
);
assert.throws(() => runtime.takeLatest(account, webview), error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_NO_PERMIT', 'failed consume stays fail-closed and does not restore latest authority');

assert.throws(
  () => runtime.observeGesture(account, webview, { protocolVersion: 1, platform: 'telegram', kind: 'keyboard', composerGeneration: -1 }),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_INVALID' && error?.field === 'composerGeneration',
);
assert.throws(
  () => runtime.observeGesture(account, webview, { protocolVersion: 2, platform: 'telegram', kind: 'keyboard', composerGeneration: 4 }),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_PROTOCOL',
);
assert.throws(
  () => runtime.observeGesture(account, webview, { protocolVersion: 1, platform: 'whatsapp', kind: 'button', composerGeneration: 5 }),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_PLATFORM',
);
assert.throws(
  () => runtime.observeGesture({ ...account, type: 'whatsapp' }, webview, { protocolVersion: 1, platform: 'telegram', kind: 'button', composerGeneration: 5 }),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_PLATFORM',
);

assert.match(app, /GeekTrustedSubmitPermits\.createAuthority\(\)/);
assert.match(app, /GeekTrustedSubmitRuntime\.create\(\{[\s\S]*authority: trustedSubmitPermitAuthority,[\s\S]*familyOf/);
assert.match(app, /trustedSubmitRuntime\.registerWebview\(wv\);[\s\S]*did-start-navigation[\s\S]*trustedSubmitRuntime\.advanceGeneration\(wv\)/);
assert.match(app, /render-process-gone[\s\S]*trustedSubmitRuntime\.advanceGeneration\(wv\)/);
assert.match(app, /const TRUSTED_SUBMIT_CHANNEL = 'geek-trusted-submit'/);
assert.match(app, /const TRUSTED_COMPOSER_CHANNEL = 'geek-trusted-composer-context'/);
assert.match(app, /handleTrustedComposerContext\(wv, event\)/);
assert.match(app, /trustedSubmitRuntime\.observeComposer\(account, wv, payload\)/);
assert.match(app, /handleTrustedSubmitGesture\(wv, event\)/);
assert.match(app, /handleLineTranslationIpc\(wv, event\); handleGeekBridgeIpc\(wv, event\); handleTrustedComposerContext\(wv, event\); handleTrustedSubmitGesture\(wv, event\);/);
assert.match(html, /trusted-submit-permits\.js[\s\S]*trusted-submit-runtime\.js[\s\S]*send-intent-coordinator\.js[\s\S]*app\.js/);
assert.doesNotMatch(fs.readFileSync(path.join(root, 'ui', 'trusted-submit-runtime.js'), 'utf8'), /binding\.platform !== 'telegram'/, 'trusted runtime must bind exact platform identity rather than hard-code Telegram');

let lineSeq = 0;
const lineAuthority = permits.createAuthority({
  now: () => 5000,
  idFactory: () => 'line-permit-' + (++lineSeq),
  ttlMs: 2000,
  maxRecords: 4,
});
const lineRuntime = runtimeApi.create({
  authority: lineAuthority,
  familyOf: type => ({ key: String(type).startsWith('line') ? 'line' : String(type) }),
});
const lineWebview = { getWebContentsId: () => 88 };
const lineAccount = { id: 'line-private', partition: 'persist:line-private', type: 'line' };
assert.equal(lineRuntime.registerWebview(lineWebview), 0);
assert.deepEqual(
  lineRuntime.observeComposer(lineAccount, lineWebview, { protocolVersion: 1, platform: 'line', composerGeneration: 1 }),
  { accepted: true, composerGeneration: 1, webviewGeneration: 0 },
);
const lineObserved = lineRuntime.observeGesture(lineAccount, lineWebview, { protocolVersion: 1, platform: 'line', kind: 'keyboard', composerGeneration: 1 });
assert.equal(lineObserved.accepted, true);
const lineTaken = lineRuntime.takeLatest(lineAccount, lineWebview, 'keyboard');
assert.equal(lineTaken.permitId, 'line-permit-1');
assert.equal(lineRuntime.release(lineWebview, { generation: lineTaken.webviewGeneration, permitId: lineTaken.permitId }), true);
assert.throws(
  () => lineRuntime.observeGesture(lineAccount, lineWebview, { protocolVersion: 1, platform: 'telegram', kind: 'keyboard', composerGeneration: 1 }),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_PLATFORM',
);

runtime.observeGesture(account, webview, { protocolVersion: 1, platform: 'telegram', kind: 'keyboard', composerGeneration: 7 });
const currentTaken = runtime.takeLatest(account, webview);
const currentLease = { generation: currentTaken.webviewGeneration, permitId: currentTaken.permitId };
assert.equal(currentLease.generation, 1);
assert.equal(runtime.release(webview, firstLease), false, 'stale release lease cannot clear a newer active generation');
assert.throws(() => runtime.observeGesture(account, webview, { protocolVersion: 1, platform: 'telegram', kind: 'button', composerGeneration: 7 }), error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_BUSY');
assert.equal(runtime.release(webview, currentLease), true);
console.log('TRUSTED_SUBMIT_RUNTIME_CONTRACT_OK');
