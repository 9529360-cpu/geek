'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSubscriptionStore } = require('../src/subscription.cjs');

const OLD_ACCOUNT_NO = `GK-${'e'.repeat(32)}`;
const NEW_ACCOUNT_NO = `GK-${'f'.repeat(32)}`;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createStore(userDataDir) {
  const store = createSubscriptionStore({ userDataDir });
  store._injectCrypto({
    encrypt: (value) => String(value),
    decrypt: (value) => String(value),
  });
  return store;
}

async function writeState(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function authenticatedState(overrides = {}) {
  return {
    token: 'enc:old-session-token',
    email: 'old@example.invalid',
    user_id: 7,
    account_no: OLD_ACCOUNT_NO,
    account_ref: OLD_ACCOUNT_NO,
    remaining_chars: 100,
    ...overrides,
  };
}

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-subscription-generation-'));
  const originalFetch = global.fetch;
  const originalReadFile = fsp.readFile;

  try {
    // 1. A short translation-token response that arrives after logout must not repopulate cache.
    {
      const dir = path.join(root, 'translation-token');
      const stateFile = path.join(dir, 'subscription.json');
      await writeState(stateFile, authenticatedState());
      const store = createStore(dir);
      assert.equal((await store.getState()).loggedIn, true);

      const started = deferred();
      const release = deferred();
      let tokenRequests = 0;
      global.fetch = async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.endsWith('/api/translation-token')) throw new Error(`unexpected request: ${url}`);
        tokenRequests += 1;
        started.resolve();
        await release.promise;
        return jsonResponse({ ok: true, token: 'stale-short-translate-jwt', expires_at: Math.floor(Date.now() / 1000) + 300 });
      };

      const tokenPromise = store.getTranslationToken();
      await started.promise;
      await store.logout();
      release.resolve();
      await assert.rejects(
        tokenPromise,
        (error) => error?.code === 'SUBSCRIPTION_SESSION_CHANGED',
        'short-token completion from the old session must be rejected after logout'
      );
      assert.deepEqual(await store.getState(), { loggedIn: false });
      assert.deepEqual(JSON.parse(await originalReadFile(stateFile, 'utf8')), {});

      await assert.rejects(
        store.getTranslationToken(),
        (error) => error?.code === 'SUBSCRIPTION_LOGIN_REQUIRED',
        'post-logout token lookup must fail locally rather than reuse a stale cached JWT'
      );
      assert.equal(tokenRequests, 1, 'logged-out token lookup must not make another authenticated token request');
    }

    // 2. A quota response from the old session must not restore old account identity/quota after logout.
    {
      const dir = path.join(root, 'quota');
      const stateFile = path.join(dir, 'subscription.json');
      await writeState(stateFile, authenticatedState());
      const store = createStore(dir);
      await store.getState();

      const started = deferred();
      const release = deferred();
      global.fetch = async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.endsWith('/api/quota')) throw new Error(`unexpected request: ${url}`);
        started.resolve();
        await release.promise;
        return jsonResponse({ remaining_chars: 999, email: 'old@example.invalid' });
      };

      const quotaPromise = store.getQuota(true);
      await started.promise;
      await store.logout();
      release.resolve();
      const quota = await quotaPromise;
      assert.equal(quota.remaining_chars, null, 'stale quota completion must fall back to current logged-out local state');
      assert.equal(quota.email, '', 'stale quota completion must not expose the old account email');
      assert.equal(quota.account_no, '', 'stale quota completion must not expose the old account number');
      assert.deepEqual(JSON.parse(await originalReadFile(stateFile, 'utf8')), {}, 'stale quota completion must not dirty the logout tombstone');
      const restarted = createStore(dir);
      assert.deepEqual(await restarted.getState(), { loggedIn: false });
    }

    // 3. A 401 from an old refresh may arrive after a newer login. It must not clear the newer session.
    {
      const dir = path.join(root, 'stale-401');
      const stateFile = path.join(dir, 'subscription.json');
      await writeState(stateFile, authenticatedState());
      const store = createStore(dir);
      await store.getState();

      const oldStatusStarted = deferred();
      const releaseOldStatus = deferred();
      let oldStatusHeld = false;
      global.fetch = async (input, options = {}) => {
        const url = String(input instanceof Request ? input.url : input);
        const authorization = options?.headers?.Authorization || options?.headers?.authorization || '';
        if (url.endsWith('/api/status') && authorization === 'Bearer old-session-token' && !oldStatusHeld) {
          oldStatusHeld = true;
          oldStatusStarted.resolve();
          await releaseOldStatus.promise;
          return jsonResponse({ error: 'unauthorized' }, 401);
        }
        if (url.endsWith('/api/login')) {
          return jsonResponse({
            ok: true,
            token: 'new-session-token',
            user: { id: 8, email: 'new@example.invalid', account_no: NEW_ACCOUNT_NO },
          });
        }
        if (url.endsWith('/api/status') && authorization === 'Bearer new-session-token') {
          return jsonResponse({ remaining_chars: 777 });
        }
        throw new Error(`unexpected request: ${url} auth=${authorization}`);
      };

      const staleRefresh = store.refresh();
      await oldStatusStarted.promise;
      const loginResult = await store.login('new@example.invalid', '0123456789');
      assert.equal(loginResult.ok, true);
      assert.equal((await store.getState()).email, 'new@example.invalid');

      releaseOldStatus.resolve();
      const refreshResult = await staleRefresh;
      assert.equal(refreshResult.loggedIn, true, 'stale old-session 401 must resolve against the newer session instead of logging it out');
      assert.equal(refreshResult.email, 'new@example.invalid');
      const current = await store.getState();
      assert.equal(current.loggedIn, true);
      assert.equal(current.email, 'new@example.invalid');
      assert.equal(current.account_no, NEW_ACCOUNT_NO);
      assert.equal(current.remaining_chars, 777);
      const disk = JSON.parse(await originalReadFile(stateFile, 'utf8'));
      assert.equal(disk.token, 'enc:new-session-token');
      assert.equal(disk.email, 'new@example.invalid');
    }

    // 4. If logout wins while login is still in flight, the late login response must not re-authenticate locally.
    {
      const dir = path.join(root, 'stale-login');
      const stateFile = path.join(dir, 'subscription.json');
      await writeState(stateFile, {});
      const store = createStore(dir);
      assert.deepEqual(await store.getState(), { loggedIn: false });

      const started = deferred();
      const release = deferred();
      global.fetch = async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.endsWith('/api/login')) throw new Error(`unexpected request: ${url}`);
        started.resolve();
        await release.promise;
        return jsonResponse({
          ok: true,
          token: 'late-login-token',
          user: { id: 9, email: 'late@example.invalid', account_no: NEW_ACCOUNT_NO },
        });
      };

      const loginPromise = store.login('late@example.invalid', '0123456789');
      await started.promise;
      await store.logout();
      release.resolve();
      await assert.rejects(
        loginPromise,
        (error) => error?.code === 'SUBSCRIPTION_SESSION_CHANGED',
        'late login response must lose to a later completed logout'
      );
      assert.deepEqual(await store.getState(), { loggedIn: false });
      assert.deepEqual(JSON.parse(await originalReadFile(stateFile, 'utf8')), {});
    }

    // 5. A cold disk read that captured the old session before logout must not complete after logout
    //    by repopulating memory or running its compatibility rewrite over the logout tombstone.
    {
      const dir = path.join(root, 'stale-cold-load');
      const stateFile = path.join(dir, 'subscription.json');
      await writeState(stateFile, authenticatedState());
      const store = createStore(dir);
      const readStarted = deferred();
      const releaseRead = deferred();
      let held = false;
      fsp.readFile = async (file, ...args) => {
        if (!held && path.resolve(file) === path.resolve(stateFile)) {
          held = true;
          const captured = await originalReadFile(file, ...args);
          readStarted.resolve();
          await releaseRead.promise;
          return captured;
        }
        return originalReadFile(file, ...args);
      };

      const staleLoad = store.getState();
      await readStarted.promise;
      await store.logout();
      releaseRead.resolve();
      assert.deepEqual(await staleLoad, { loggedIn: false }, 'old cold-load result must be discarded after logout generation changes');
      assert.deepEqual(await store.getState(), { loggedIn: false });
      fsp.readFile = originalReadFile;
      assert.deepEqual(JSON.parse(await originalReadFile(stateFile, 'utf8')), {}, 'old cold-load migration must not rewrite the logout tombstone');
    }

    // 6. Same-generation token flow remains functional and cached.
    {
      const dir = path.join(root, 'normal-token');
      const stateFile = path.join(dir, 'subscription.json');
      await writeState(stateFile, authenticatedState());
      const store = createStore(dir);
      let calls = 0;
      global.fetch = async (input) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.endsWith('/api/translation-token')) throw new Error(`unexpected request: ${url}`);
        calls += 1;
        return jsonResponse({ ok: true, token: 'current-short-token', expires_at: Math.floor(Date.now() / 1000) + 300 });
      };

      assert.equal(await store.getTranslationToken(), 'current-short-token');
      assert.equal(await store.getTranslationToken(), 'current-short-token');
      assert.equal(calls, 1, 'same-session short token should still use the existing cache');
    }
  } finally {
    global.fetch = originalFetch;
    fsp.readFile = originalReadFile;
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('SUBSCRIPTION_SESSION_GENERATION_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
