'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHistoryAppender } = require('../ui/broadcast-runtime.js');

const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'ui', 'broadcast-runtime.js'), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function job(accountId, id, overrides = {}) {
  return {
    accountId,
    id,
    total: 3,
    ok: 2,
    fail: 1,
    files: [],
    attachmentRefs: [],
    message: `message-${id}`,
    ...overrides,
  };
}

(async () => {
  assert.equal(typeof createHistoryAppender, 'function', 'broadcast runtime must expose the testable history transaction owner');
  assert.match(
    runtimeSource,
    /async function appendHistory\(job\) \{[\s\S]*?getHistoryAppender\(\)\.append\(job\)/,
    'production appendHistory must delegate to the serialized history owner',
  );

  const store = new Map([
    ['account-a', []],
    ['account-b', []],
  ]);
  const events = [];
  const firstAWrite = deferred();
  const releaseFirstAWrite = deferred();
  let firstAWriteBlocked = true;
  let failJobId = '';
  let now = 1000;

  const appender = createHistoryAppender({
    now: () => ++now,
    async getAll(accountId) {
      events.push(`read:${accountId}`);
      return { sendHistory: JSON.stringify(store.get(accountId) || []) };
    },
    async set(accountId, key, value) {
      assert.equal(key, 'sendHistory');
      const next = JSON.parse(value);
      const latest = next.at(-1)?.jobId || '';
      events.push(`write:start:${accountId}:${latest}`);
      if (accountId === 'account-a' && firstAWriteBlocked) {
        firstAWriteBlocked = false;
        firstAWrite.resolve();
        await releaseFirstAWrite.promise;
      }
      if (latest === failJobId) {
        events.push(`write:fail:${accountId}:${latest}`);
        throw new Error('synthetic history write failure');
      }
      store.set(accountId, next);
      events.push(`write:done:${accountId}:${latest}`);
    },
  });

  const a1 = appender.append(job('account-a', 'a-1'));
  await firstAWrite.promise;
  const a2 = appender.append(job('account-a', 'a-2'));
  const b1 = appender.append(job('account-b', 'b-1'));

  await waitFor(() => events.includes('write:done:account-b:b-1'), 'independent account B history write');
  assert.equal(
    events.filter(event => event === 'read:account-a').length,
    1,
    'same-account second mutation must not enter its read phase while the first write is pending',
  );
  assert.deepEqual(
    store.get('account-b').map(item => item.jobId),
    ['b-1'],
    'different account history mutation must remain independent while account A is blocked',
  );
  assert.deepEqual(appender.pendingAccounts().sort(), ['account-a'], 'only blocked account A should remain pending after B completes');

  releaseFirstAWrite.resolve();
  await Promise.all([a1, a2, b1]);
  assert.deepEqual(
    store.get('account-a').map(item => item.jobId),
    ['a-1', 'a-2'],
    'same-account mutations must re-read committed history so neither terminal record is lost',
  );
  assert.ok(
    events.indexOf('read:account-a', events.indexOf('read:account-a') + 1) > events.indexOf('write:done:account-a:a-1'),
    'account A second read must occur only after account A first write commits',
  );
  assert.deepEqual(appender.pendingAccounts(), [], 'settled account tails must be released');

  failJobId = 'a-fail';
  await assert.rejects(
    appender.append(job('account-a', 'a-fail')),
    /synthetic history write failure/,
    'history write failure should surface to the caller/outer best-effort boundary',
  );
  failJobId = '';
  await appender.append(job('account-a', 'a-after-fail'));
  assert.deepEqual(
    store.get('account-a').map(item => item.jobId),
    ['a-1', 'a-2', 'a-after-fail'],
    'a failed mutation must not poison the same-account queue; later history appends must recover',
  );

  const capped = Array.from({ length: 500 }, (_, index) => ({ jobId: `old-${index}` }));
  store.set('account-cap', capped);
  await appender.append(job('account-cap', 'cap-new'));
  assert.equal(store.get('account-cap').length, 500, 'existing 500-record history bound must remain intact');
  assert.equal(store.get('account-cap')[0].jobId, 'old-1', 'history trimming must remove the oldest record first');
  assert.equal(store.get('account-cap').at(-1).jobId, 'cap-new', 'new completion must remain after history trimming');

  console.log('BROADCAST_HISTORY_MUTATION_QUEUE_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
