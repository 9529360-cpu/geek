'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const api = require('../ui/trusted-submit-permits.js');
const source = fs.readFileSync(path.join(root, 'ui', 'trusted-submit-permits.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');

function binding(overrides = {}) {
  return {
    accountId: 'account-private',
    partition: 'persist:webview-page-account-private',
    platform: 'future-chat',
    webviewId: '91',
    webviewGeneration: 7,
    ...overrides,
  };
}

function harness(options = {}) {
  let time = options.start == null ? 1000 : options.start;
  let seq = 0;
  const authority = api.createAuthority({
    now: () => time,
    idFactory: options.idFactory || (() => 'permit-' + (++seq)),
    ttlMs: options.ttlMs || 2000,
    maxRecords: options.maxRecords || 8,
  });
  return {
    authority,
    setTime(value) { time = value; },
  };
}

const normal = harness();
const issued = normal.authority.issue({ ...binding(), kind: 'keyboard' });
assert.equal(issued.permitId, 'permit-1');
assert.equal(issued.expiresAt, 3000);
const projectedBefore = normal.authority.get(issued.permitId);
assert.deepEqual(
  { kind: projectedBefore.kind, state: projectedBefore.state, issuedAt: projectedBefore.issuedAt, expiresAt: projectedBefore.expiresAt, consumedAt: projectedBefore.consumedAt },
  { kind: 'keyboard', state: 'issued', issuedAt: 1000, expiresAt: 3000, consumedAt: null },
);
const projectedJson = JSON.stringify(projectedBefore);
for (const forbidden of ['permit-1', 'account-private', 'persist:webview-page-account-private', 'future-chat', '91']) {
  assert.equal(projectedJson.includes(forbidden), false, 'privacy-safe projection leaked ' + forbidden);
}
assert.equal(normal.authority.consume(issued.permitId, binding()).state, 'consumed');
assert.throws(
  () => normal.authority.consume(issued.permitId, binding()),
  error => error?.code === 'SUBMIT_PERMIT_REPLAY',
  'a permit must be single-use',
);

for (const field of api.BINDING_FIELDS) {
  const mismatch = harness();
  const token = mismatch.authority.issue({ ...binding(), kind: 'button' });
  const changed = binding();
  if (field === 'webviewGeneration') changed[field] += 1;
  else changed[field] = String(changed[field]) + '-other';
  assert.throws(
    () => mismatch.authority.consume(token.permitId, changed),
    error => error?.code === 'SUBMIT_PERMIT_STALE_BINDING' && error?.field === field,
    'binding mismatch must fail closed for ' + field,
  );
  assert.equal(mismatch.authority.get(token.permitId).state, 'issued', 'mismatch must not consume permit');
  assert.equal(mismatch.authority.consume(token.permitId, binding()).state, 'consumed');
}

const expiry = harness({ ttlMs: 500 });
const expiring = expiry.authority.issue({ ...binding(), kind: 'keyboard' });
expiry.setTime(1500);
assert.throws(
  () => expiry.authority.consume(expiring.permitId, binding()),
  error => error?.code === 'SUBMIT_PERMIT_EXPIRED',
);
assert.equal(expiry.authority.get(expiring.permitId).state, 'expired');

const capacity = harness({ maxRecords: 2 });
const p1 = capacity.authority.issue({ ...binding({ webviewId: '1' }), kind: 'keyboard' });
capacity.authority.issue({ ...binding({ webviewId: '2' }), kind: 'button' });
assert.throws(
  () => capacity.authority.issue({ ...binding({ webviewId: '3' }), kind: 'keyboard' }),
  error => error?.code === 'SUBMIT_PERMIT_CAPACITY',
);
capacity.authority.consume(p1.permitId, binding({ webviewId: '1' }));
capacity.authority.issue({ ...binding({ webviewId: '3' }), kind: 'keyboard' });
assert.equal(capacity.authority.size(), 2, 'consumed permits may be pruned to admit new trusted gestures');

assert.throws(
  () => normal.authority.issue({ ...binding(), kind: 'synthetic' }),
  error => error?.code === 'SUBMIT_PERMIT_INVALID' && error?.field === 'kind',
);
assert.throws(
  () => api.createAuthority({ ttlMs: 99 }),
  error => error?.code === 'SUBMIT_PERMIT_INVALID' && error?.field === 'ttlMs',
);
assert.throws(
  () => api.createAuthority({ maxRecords: 0 }),
  error => error?.code === 'SUBMIT_PERMIT_INVALID' && error?.field === 'maxRecords',
);

const duplicate = harness({ idFactory: () => 'same-permit' });
duplicate.authority.issue({ ...binding(), kind: 'keyboard' });
assert.throws(
  () => duplicate.authority.issue({ ...binding({ webviewId: '92' }), kind: 'button' }),
  error => error?.code === 'SUBMIT_PERMIT_DUPLICATE',
);

assert.doesNotMatch(source, /Math\.random/, 'permit identity must not use Math.random');
assert.doesNotMatch(source, /querySelector|executeJavaScript|ipcRenderer|sendToHost|messageText|sourceSnapshot|conversationId|chatId/, 'permit authority must not own DOM, Electron transport or message/chat payload');
assert.match(html, /platform-capabilities\.js[\s\S]*trusted-submit-permits\.js[\s\S]*send-intent-coordinator\.js[\s\S]*app\.js/);

console.log('TRUSTED_SUBMIT_PERMITS_CONTRACT_OK');
