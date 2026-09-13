'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSubscriptionStore } = require('../src/subscription.cjs');

const ACCOUNT_NO = `GK-${'b'.repeat(32)}`;

function createStore(userDataDir) {
  const store = createSubscriptionStore({ userDataDir });
  store._injectCrypto({
    encrypt: (value) => String(value),
    decrypt: (value) => String(value),
  });
  return store;
}

async function writeJson(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-subscription-commit-'));
  const originalFetch = global.fetch;
  const originalRename = fsp.rename;

  try {
    // 1. Login API succeeds, but persisting the new token fails after clear() committed {}.
    //    The login call must reject and memory must remain aligned with durable logged-out state.
    {
      const dir = path.join(root, 'login-failure');
      const stateFile = path.join(dir, 'subscription.json');
      await writeJson(stateFile, {});
      const store = createStore(dir);
      assert.deepEqual(await store.getState(), { loggedIn: false });

      global.fetch = async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith('/api/login')) {
          return jsonResponse({
            ok: true,
            token: 'new-session-token',
            user: { id: 42, email: 'new@example.invalid', account_no: ACCOUNT_NO },
          });
        }
        throw new Error(`unexpected request after failed login persistence: ${url}`);
      };

      let targetRenames = 0;
      fsp.rename = async (from, to) => {
        if (path.resolve(to) === path.resolve(stateFile)) {
          targetRenames += 1;
          if (targetRenames === 2) {
            const error = new Error('simulated login token durable commit failure');
            error.code = 'EPERM';
            throw error;
          }
        }
        return originalRename(from, to);
      };

      await assert.rejects(
        store.login('new@example.invalid', '0123456789'),
        /simulated login token durable commit failure/,
        'login must reject when its token cannot be durably committed'
      );
      assert.equal(targetRenames, 2, 'fixture must fail the token save after clear() durable commit');
      assert.deepEqual(
        await store.getState(),
        { loggedIn: false },
        'failed token persistence must not leave a phantom logged-in in-memory session'
      );
      assert.deepEqual(JSON.parse(await fsp.readFile(stateFile, 'utf8')), {}, 'disk must remain on the last committed logged-out state');
      const restarted = createStore(dir);
      assert.deepEqual(await restarted.getState(), { loggedIn: false }, 'restart and current process must agree after failed login persistence');
    }

    // 2. An authenticated refresh receives new quota, but persisting it fails.
    //    The catch path may mark networkError, but it must expose the last committed quota, not the uncommitted candidate.
    {
      fsp.rename = originalRename;
      const dir = path.join(root, 'refresh-failure');
      const stateFile = path.join(dir, 'subscription.json');
      await writeJson(stateFile, {
        token: 'enc:old-session-token',
        email: 'old@example.invalid',
        user_id: 7,
        account_no: ACCOUNT_NO,
        account_ref: ACCOUNT_NO,
        remaining_chars: 123,
      });
      const store = createStore(dir);
      const before = await store.getState();
      assert.equal(before.loggedIn, true);
      assert.equal(before.remaining_chars, 123);

      global.fetch = async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith('/api/status')) return jsonResponse({ remaining_chars: 999 });
        throw new Error(`unexpected refresh request: ${url}`);
      };

      fsp.rename = async (from, to) => {
        if (path.resolve(to) === path.resolve(stateFile)) {
          const error = new Error('simulated refresh durable commit failure');
          error.code = 'EPERM';
          throw error;
        }
        return originalRename(from, to);
      };

      const refreshed = await store.refresh();
      assert.equal(refreshed.loggedIn, true);
      assert.equal(refreshed.networkError, true, 'refresh persistence failure must stay observable as an unsuccessful refresh');
      assert.equal(refreshed.remaining_chars, 123, 'failed refresh persistence must keep the last committed in-memory quota');
      assert.equal((await store.getState()).remaining_chars, 123, 'store memory must not advance before durable commit');
      assert.equal(JSON.parse(await fsp.readFile(stateFile, 'utf8')).remaining_chars, 123, 'disk must retain the previous committed quota');
    }

    // 3. Normal successful login/save must still keep memory and restart state identical.
    {
      fsp.rename = originalRename;
      const dir = path.join(root, 'success');
      const stateFile = path.join(dir, 'subscription.json');
      await writeJson(stateFile, {});
      const store = createStore(dir);
      global.fetch = async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.endsWith('/api/login')) {
          return jsonResponse({
            ok: true,
            token: 'committed-session-token',
            user: { id: 99, email: 'committed@example.invalid', account_no: ACCOUNT_NO },
          });
        }
        if (url.endsWith('/api/status')) return jsonResponse({ remaining_chars: 777 });
        throw new Error(`unexpected success request: ${url}`);
      };

      await store.login('committed@example.invalid', '0123456789');
      const current = await store.getState();
      assert.equal(current.loggedIn, true);
      assert.equal(current.email, 'committed@example.invalid');
      assert.equal(current.remaining_chars, 777);

      const disk = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
      assert.equal(disk.token, 'enc:committed-session-token');
      assert.equal(disk.remaining_chars, 777);
      const restarted = createStore(dir);
      const afterRestart = await restarted.getState();
      assert.equal(afterRestart.loggedIn, true);
      assert.equal(afterRestart.email, current.email);
      assert.equal(afterRestart.remaining_chars, current.remaining_chars);
      assert.equal(afterRestart.account_no, current.account_no);
    }
  } finally {
    global.fetch = originalFetch;
    fsp.rename = originalRename;
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('SUBSCRIPTION_DURABLE_COMMIT_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
