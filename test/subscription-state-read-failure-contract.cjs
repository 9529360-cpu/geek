'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSubscriptionStore } = require('../src/subscription.cjs');

const ACCOUNT_NO = `GK-${'e'.repeat(32)}`;
const STATE_ERROR = 'SUBSCRIPTION_STATE_RECOVERY_REQUIRED';

function createStore(userDataDir) {
  const store = createSubscriptionStore({ userDataDir });
  store._injectCrypto({
    encrypt: value => String(value),
    decrypt: value => String(value),
  });
  return store;
}

function validState(token = 'session-token') {
  return {
    token: `enc:${token}`,
    email: 'state-read@example.invalid',
    user_id: 42,
    account_no: ACCOUNT_NO,
    account_ref: ACCOUNT_NO,
    remaining_chars: 123,
  };
}

async function write(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, value, { encoding: 'utf8', mode: 0o600 });
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-subscription-state-read-'));
  const originalFetch = global.fetch;
  const originalReadFile = fsp.readFile;

  try {
    // 1. Missing file is the only implicit logged-out state.
    {
      const dir = path.join(root, 'missing');
      const store = createStore(dir);
      assert.deepEqual(await store.getState(), { loggedIn: false });
    }

    // 2. Existing malformed/empty/non-object state must fail closed and remain retryable.
    for (const [name, raw] of [
      ['malformed', '{broken-json'],
      ['empty', ''],
      ['array', '[]'],
    ]) {
      const dir = path.join(root, name);
      const file = path.join(dir, 'subscription.json');
      await write(file, raw);
      const store = createStore(dir);
      await assert.rejects(
        store.getState(),
        error => error?.code === STATE_ERROR && Boolean(error?.cause),
        `${name} state must be distinguishable from logout`
      );
      await write(file, JSON.stringify(validState(), null, 2));
      const recovered = await store.getState();
      assert.equal(recovered.loggedIn, true, `${name} failure must not cache a false logged-out state`);
      assert.equal(recovered.account_no, ACCOUNT_NO);
    }

    // 3. A transient filesystem read error must retry in the same process and must block auth traffic.
    {
      const dir = path.join(root, 'transient-read');
      const file = path.join(dir, 'subscription.json');
      await write(file, JSON.stringify(validState('transient-token'), null, 2));
      const store = createStore(dir);
      let reads = 0;
      let fetchCalls = 0;
      fsp.readFile = async (candidate, ...args) => {
        if (path.resolve(candidate) === path.resolve(file)) {
          reads += 1;
          if (reads === 1) {
            const error = new Error('simulated transient access failure');
            error.code = 'EACCES';
            throw error;
          }
        }
        return originalReadFile(candidate, ...args);
      };
      global.fetch = async () => {
        fetchCalls += 1;
        throw new Error('network must not run while local subscription state is unreadable');
      };

      await assert.rejects(
        store.getTranslationToken(),
        error => error?.code === STATE_ERROR && error?.cause?.code === 'EACCES'
      );
      assert.equal(fetchCalls, 0, 'unreadable local authority must block authenticated network traffic');
      const recovered = await store.getState();
      assert.equal(recovered.loggedIn, true, 'later retry must recover after transient read failure');
      assert.equal(reads, 2, 'failed load must not cache the false logged-out state');
      fsp.readFile = originalReadFile;
    }

    // 4. Explicit login is a recovery boundary and must replace unreadable old bytes without reading them first.
    {
      const dir = path.join(root, 'login-recovery');
      const file = path.join(dir, 'subscription.json');
      await write(file, '{corrupt-old-session');
      const store = createStore(dir);
      const requests = [];
      global.fetch = async (input, options = {}) => {
        const url = String(input instanceof Request ? input.url : input);
        requests.push({ url, authorization: options?.headers?.Authorization });
        if (url.endsWith('/api/login')) {
          assert.equal(options?.headers?.Authorization, undefined);
          return jsonResponse({
            token: 'replacement-token',
            user: { id: 43, email: 'replacement@example.invalid', account_no: ACCOUNT_NO },
          });
        }
        if (url.endsWith('/api/status')) return jsonResponse({ remaining_chars: 777 });
        throw new Error(`unexpected request: ${url}`);
      };
      const result = await store.login('replacement@example.invalid', '0123456789');
      assert.equal(result.ok, true);
      assert.equal(requests.length, 2);
      assert.ok(requests[0].url.endsWith('/api/login'));
      assert.equal(requests[0].authorization, undefined);
      const state = await store.getState();
      assert.equal(state.loggedIn, true);
      assert.equal(state.remaining_chars, 777);
      const disk = JSON.parse(await originalReadFile(file, 'utf8'));
      assert.equal(disk.token, 'enc:replacement-token');
    }

    // 5. Explicit logout/clear can likewise replace unreadable bytes with a durable tokenless tombstone.
    {
      const dir = path.join(root, 'logout-recovery');
      const file = path.join(dir, 'subscription.json');
      await write(file, '');
      const store = createStore(dir);
      assert.deepEqual(await store.logout(), { ok: true });
      assert.deepEqual(JSON.parse(await originalReadFile(file, 'utf8')), {});
      assert.deepEqual(await store.getState(), { loggedIn: false });
    }
  } finally {
    global.fetch = originalFetch;
    fsp.readFile = originalReadFile;
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('SUBSCRIPTION_STATE_READ_FAILURE_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
