'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSubscriptionStore } = require('../src/subscription.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function makeStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geek-token-singleflight-'));
  await fs.writeFile(path.join(dir, 'subscription.json'), JSON.stringify({ token: 'session-token' }));
  return { dir, store: createSubscriptionStore({ userDataDir: dir, requestTimeoutMs: 1000 }) };
}

(async () => {
  const originalFetch = global.fetch;
  const dirs = [];
  try {
    {
      const { dir, store } = await makeStore();
      dirs.push(dir);
      let calls = 0;
      let gate = deferred();
      global.fetch = async url => {
        assert.match(String(url), /\/api\/translation-token$/);
        calls += 1;
        return gate.promise;
      };

      const first = store.getTranslationToken();
      const second = store.getTranslationToken();
      await waitFor(() => calls === 1, 'initial token POST');
      assert.equal(calls, 1, 'cold concurrent token callers must share one POST');
      gate.resolve(response({ token: 'translation-a', expires_at: Math.floor(Date.now() / 1000) + 300 }));
      assert.deepEqual(await Promise.all([first, second]), ['translation-a', 'translation-a']);
      assert.equal(await store.getTranslationToken(), 'translation-a');
      assert.equal(calls, 1, 'fresh cache must avoid another POST');

      gate = deferred();
      const forcedA = store.getTranslationToken(true);
      const forcedB = store.getTranslationToken(true);
      await waitFor(() => calls === 2, 'forced token POST');
      assert.equal(calls, 2, 'concurrent force refreshes must still share one physical refresh');
      gate.resolve(response({ token: 'translation-b', expires_at: Math.floor(Date.now() / 1000) + 300 }));
      assert.deepEqual(await Promise.all([forcedA, forcedB]), ['translation-b', 'translation-b']);
    }

    {
      const { dir, store } = await makeStore();
      dirs.push(dir);
      const gate = deferred();
      let calls = 0;
      global.fetch = async () => {
        calls += 1;
        return gate.promise;
      };

      const pending = store.getTranslationToken();
      await waitFor(() => calls === 1, 'logout-race token POST');
      await store.logout();
      gate.resolve(response({ token: 'stale-token', expires_at: Math.floor(Date.now() / 1000) + 300 }));
      await assert.rejects(
        pending,
        error => error?.code === 'SUBSCRIPTION_SESSION_CHANGED',
        'a token response from the previous login generation must not install after logout',
      );
      await assert.rejects(
        store.getTranslationToken(),
        error => error?.code === 'SUBSCRIPTION_LOGIN_REQUIRED',
        'logout must leave no usable translation-token cache',
      );
    }

    {
      const { dir, store } = await makeStore();
      dirs.push(dir);
      let calls = 0;
      global.fetch = async () => {
        calls += 1;
        if (calls === 1) return response({ error: 'temporary' }, 503);
        return response({ token: 'recovered', expires_at: Math.floor(Date.now() / 1000) + 300 });
      };

      await assert.rejects(store.getTranslationToken());
      assert.equal(
        await store.getTranslationToken(),
        'recovered',
        'a failed token singleflight must release authority so a later caller can retry',
      );
      assert.equal(calls, 2);
    }
  } finally {
    global.fetch = originalFetch;
    for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
  }

  console.log('SUBSCRIPTION_TRANSLATION_TOKEN_SINGLEFLIGHT_OK');
})().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
