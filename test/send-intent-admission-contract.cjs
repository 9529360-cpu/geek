'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const permitApi = require('../ui/trusted-submit-permits.js');
const trustedRuntimeApi = require('../ui/trusted-submit-runtime.js');
const coordinatorApi = require('../ui/send-intent-coordinator.js');
const admissionApi = require('../ui/send-intent-admission.js');
const source = fs.readFileSync(path.join(root, 'ui', 'send-intent-admission.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');

function harness(options = {}) {
  let time = options.start == null ? 1000 : options.start;
  let permitSeq = 0;
  let intentSeq = 0;
  const familyOf = type => ({ key: type === 'telegram-z' || type === 'telegram-k' ? 'telegram' : type });
  const authority = permitApi.createAuthority({
    now: () => time,
    idFactory: () => 'permit-' + (++permitSeq),
    ttlMs: options.ttlMs || 2000,
    maxRecords: options.permitMaxRecords || 16,
  });
  const trustedSubmitRuntime = trustedRuntimeApi.create({ authority, familyOf });
  const coordinator = coordinatorApi.createCoordinator({
    now: () => time,
    idFactory: () => 'intent-' + (++intentSeq),
    maxRecords: options.intentMaxRecords || 16,
  });
  const admission = admissionApi.create({ trustedSubmitRuntime, coordinator, familyOf });
  return {
    authority,
    trustedSubmitRuntime,
    coordinator,
    admission,
    setTime(value) { time = value; },
  };
}

function account(overrides = {}) {
  return {
    id: 'account-A',
    partition: 'persist:webview-page-account-A',
    type: 'telegram-k',
    ...overrides,
  };
}

function webview(id = 77) {
  return { getWebContentsId: () => id };
}

function input(accountValue, webviewValue, overrides = {}) {
  return {
    account: accountValue,
    webview: webviewValue,
    expectedKind: 'keyboard',
    conversationId: 'conversation-private',
    composerGeneration: 4,
    sourceSnapshot: 'PRIVATE-SOURCE-TEXT',
    transformPolicy: { enabled: true, target: 'it' },
    deadlineAt: 5000,
    ...overrides,
  };
}

const happy = harness();
const a = account();
const wv = webview();
happy.trustedSubmitRuntime.registerWebview(wv);
happy.trustedSubmitRuntime.observeGesture(a, wv, {
  protocolVersion: 1,
  platform: 'telegram',
  kind: 'keyboard',
});
const created = happy.admission.begin(input(a, wv));
assert.equal(created.intentId, 'intent-1');
assert.equal(created.state, 'created');
assert.equal(created.platform, 'telegram');
const projection = JSON.stringify(created);
for (const forbidden of ['permit-1', 'account-A', 'persist:webview-page-account-A', 'conversation-private', 'PRIVATE-SOURCE-TEXT']) {
  assert.equal(projection.includes(forbidden), false, 'admission projection leaked ' + forbidden);
}
assert.equal(happy.coordinator.readSource(created.intentId), 'PRIVATE-SOURCE-TEXT');
assert.equal(happy.coordinator.readTransformPolicy(created.intentId).target, 'it');
happy.coordinator.startTransform(created.intentId);
happy.coordinator.markReady(created.intentId);
assert.equal(
  happy.coordinator.beginCommit(created.intentId, {
    accountId: a.id,
    partition: a.partition,
    platform: 'telegram',
    webviewId: '77',
    webviewGeneration: 0,
    conversationId: 'conversation-private',
    composerGeneration: 4,
    submitPermitId: 'permit-1',
  }).state,
  'committing',
);
assert.equal(happy.coordinator.markSent(created.intentId).state, 'sent');
assert.throws(
  () => happy.admission.begin(input(a, wv)),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_NO_PERMIT',
  'one trusted gesture must admit at most one intent',
);

const wrongKind = harness();
const wkAccount = account();
const wkWebview = webview();
wrongKind.trustedSubmitRuntime.registerWebview(wkWebview);
wrongKind.trustedSubmitRuntime.observeGesture(wkAccount, wkWebview, {
  protocolVersion: 1,
  platform: 'telegram',
  kind: 'button',
});
assert.throws(
  () => wrongKind.admission.begin(input(wkAccount, wkWebview)),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_KIND_MISMATCH',
);
assert.throws(
  () => wrongKind.admission.begin(input(wkAccount, wkWebview, { expectedKind: 'button' })),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_NO_PERMIT',
  'wrong-kind attempt must not restore the latest permit',
);

const staleAccount = harness();
const sa = account();
const saWebview = webview();
staleAccount.trustedSubmitRuntime.registerWebview(saWebview);
staleAccount.trustedSubmitRuntime.observeGesture(sa, saWebview, {
  protocolVersion: 1,
  platform: 'telegram',
  kind: 'keyboard',
});
assert.throws(
  () => staleAccount.admission.begin(input(account({ id: 'account-B' }), saWebview)),
  error => error?.code === 'SUBMIT_PERMIT_STALE_BINDING' && error?.field === 'accountId',
);

const staleWebview = harness();
let currentWebContentsId = 77;
const movingWebview = { getWebContentsId: () => currentWebContentsId };
const swAccount = account();
staleWebview.trustedSubmitRuntime.registerWebview(movingWebview);
staleWebview.trustedSubmitRuntime.observeGesture(swAccount, movingWebview, {
  protocolVersion: 1,
  platform: 'telegram',
  kind: 'keyboard',
});
currentWebContentsId = 78;
assert.throws(
  () => staleWebview.admission.begin(input(swAccount, movingWebview)),
  error => error?.code === 'SUBMIT_PERMIT_STALE_BINDING' && error?.field === 'webviewId',
);

const staleGeneration = harness();
const sgAccount = account();
const sgWebview = webview();
staleGeneration.trustedSubmitRuntime.registerWebview(sgWebview);
staleGeneration.trustedSubmitRuntime.observeGesture(sgAccount, sgWebview, {
  protocolVersion: 1,
  platform: 'telegram',
  kind: 'keyboard',
});
staleGeneration.trustedSubmitRuntime.advanceGeneration(sgWebview);
assert.throws(
  () => staleGeneration.admission.begin(input(sgAccount, sgWebview)),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_NO_PERMIT',
);

const expired = harness({ ttlMs: 500 });
const exAccount = account();
const exWebview = webview();
expired.trustedSubmitRuntime.registerWebview(exWebview);
expired.trustedSubmitRuntime.observeGesture(exAccount, exWebview, {
  protocolVersion: 1,
  platform: 'telegram',
  kind: 'keyboard',
});
expired.setTime(1500);
assert.throws(
  () => expired.admission.begin(input(exAccount, exWebview)),
  error => error?.code === 'SUBMIT_PERMIT_EXPIRED',
);

const capacity = harness({ intentMaxRecords: 1 });
const capAccount = account();
const capWebview = webview();
capacity.trustedSubmitRuntime.registerWebview(capWebview);
capacity.coordinator.begin({
  accountId: 'existing-account',
  partition: 'persist:existing',
  platform: 'future-chat',
  webviewId: '1',
  webviewGeneration: 0,
  conversationId: 'existing-conversation',
  composerGeneration: 0,
  submitPermitId: 'existing-permit',
  sourceSnapshot: 'x',
  transformPolicy: {},
  deadlineAt: 5000,
});
capacity.trustedSubmitRuntime.observeGesture(capAccount, capWebview, {
  protocolVersion: 1,
  platform: 'telegram',
  kind: 'keyboard',
});
assert.throws(
  () => capacity.admission.begin(input(capAccount, capWebview)),
  error => error?.code === 'SEND_INTENT_CAPACITY',
);
assert.throws(
  () => capacity.admission.begin(input(capAccount, capWebview)),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_NO_PERMIT',
  'coordinator failure must not restore consumed authority',
);

const badDeadline = harness();
const bdAccount = account();
const bdWebview = webview();
badDeadline.trustedSubmitRuntime.registerWebview(bdWebview);
badDeadline.trustedSubmitRuntime.observeGesture(bdAccount, bdWebview, {
  protocolVersion: 1,
  platform: 'telegram',
  kind: 'keyboard',
});
assert.throws(
  () => badDeadline.admission.begin(input(bdAccount, bdWebview, { deadlineAt: 1000 })),
  error => error?.code === 'SEND_INTENT_INVALID' && error?.field === 'deadlineAt',
);
assert.throws(
  () => badDeadline.admission.begin(input(bdAccount, bdWebview, { deadlineAt: 5000 })),
  error => error?.code === 'TRUSTED_SUBMIT_RUNTIME_NO_PERMIT',
);

assert.doesNotMatch(source, /querySelector|executeJavaScript|ipcRenderer|sendToHost|window\.WPP|GeekBroadcast|translation\.translate/, 'admission must not own platform, bridge, Broadcast or transform mechanics');
assert.doesNotMatch(source, /input\.(accountId|partition|platform|webviewId|webviewGeneration|submitPermitId)/, 'private binding identity must be derived from trusted host owners');
assert.match(html, /trusted-submit-permits\.js[\s\S]*trusted-submit-runtime\.js[\s\S]*send-intent-coordinator\.js[\s\S]*send-intent-admission\.js[\s\S]*app\.js/);

console.log('SEND_INTENT_ADMISSION_CONTRACT_OK');
