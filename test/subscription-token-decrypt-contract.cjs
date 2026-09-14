'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSubscriptionStore } = require('../src/subscription.cjs');

const ACCOUNT_NO = `GK-${'a'.repeat(32)}`;
const CIPHERTEXT = 'opaque-dpapi-token';
const PLAINTEXT_TOKEN = 'recovered-session-token';

function authenticatedDiskState() {
  return {
    token: `enc:${CIPHERTEXT}`,
    email: 'recover@example.invalid',
    user_id: 17,
    account_no: ACCOUNT_NO,
    account_ref: ACCOUNT_NO,
    remaining_chars: 42,
  };
}

(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-subscription-decrypt-'));
  const stateFile = path.join(dir, 'subscription.json');
  await fsp.writeFile(stateFile, JSON.stringify(authenticatedDiskState(), null, 2), { encoding: 'utf8', mode: 0o600 });
  const originalDisk = await fsp.readFile(stateFile, 'utf8');
  const store = createSubscriptionStore({ userDataDir: dir });
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  let decryptAttempts = 0;

  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('network must not run while subscription token decryption is unavailable');
  };

  try {
    store._injectCrypto({
      encrypt: value => String(value),
      decrypt() {
        decryptAttempts += 1;
        throw new Error('dpapi temporarily unavailable');
      },
    });

    await assert.rejects(
      store.getState(),
      error => error?.code === 'SUBSCRIPTION_TOKEN_DECRYPT_FAILED'
        && error?.cause?.message === 'dpapi temporarily unavailable',
      'encrypted token decrypt failure must stay distinguishable from a real logout'
    );
    assert.equal(await fsp.readFile(stateFile, 'utf8'), originalDisk, 'decrypt failure must not rewrite the durable encrypted session');

    await assert.rejects(
      store.refresh(),
      error => error?.code === 'SUBSCRIPTION_TOKEN_DECRYPT_FAILED',
      'refresh must stop locally when the durable token cannot be decrypted'
    );
    await assert.rejects(
      store.getTranslationToken(),
      error => error?.code === 'SUBSCRIPTION_TOKEN_DECRYPT_FAILED',
      'translation-token acquisition must stop locally when the durable token cannot be decrypted'
    );
    assert.equal(fetchCalls, 0, 'no authenticated network request may run with an unreadable encrypted token');
    assert.ok(decryptAttempts >= 3, 'failed cold loads must remain retryable rather than caching a false logged-out state');
    assert.equal(await fsp.readFile(stateFile, 'utf8'), originalDisk, 'repeated decrypt failures must preserve the encrypted session bytes');

    store._injectCrypto(null);
    await assert.rejects(
      store.getState(),
      error => error?.code === 'SECURE_STORAGE_UNAVAILABLE',
      'an encrypted token without a decryptor must fail closed instead of exposing ciphertext as a bearer token'
    );
    assert.equal(fetchCalls, 0);
    assert.equal(await fsp.readFile(stateFile, 'utf8'), originalDisk);

    store._injectCrypto({
      encrypt(value) {
        assert.equal(String(value), PLAINTEXT_TOKEN);
        return CIPHERTEXT;
      },
      decrypt(value) {
        assert.equal(String(value), CIPHERTEXT);
        return PLAINTEXT_TOKEN;
      },
    });

    const recovered = await store.getState();
    assert.equal(recovered.loggedIn, true, 'a later successful decrypt must recover the same durable session');
    assert.equal(recovered.email, 'recover@example.invalid');
    assert.equal(recovered.account_no, ACCOUNT_NO);
    assert.equal(recovered.remaining_chars, 42);

    global.fetch = async (input, options = {}) => {
      fetchCalls += 1;
      const url = String(input instanceof Request ? input.url : input);
      assert.ok(url.endsWith('/api/status'), `unexpected request: ${url}`);
      assert.equal(options?.headers?.Authorization, `Bearer ${PLAINTEXT_TOKEN}`, 'only the decrypted token may reach Authorization');
      assert.notEqual(options?.headers?.Authorization, `Bearer enc:${CIPHERTEXT}`);
      return {
        ok: true,
        status: 200,
        json: async () => ({ remaining_chars: 41 }),
      };
    };

    const refreshed = await store.refresh();
    assert.equal(refreshed.loggedIn, true);
    assert.equal(refreshed.remaining_chars, 41);
    assert.equal(fetchCalls, 1, 'recovered refresh should make exactly one status request');
    const durableAfterRecovery = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
    assert.equal(durableAfterRecovery.token, `enc:${CIPHERTEXT}`, 'successful recovery must keep the token encrypted on disk');
    assert.notEqual(durableAfterRecovery.token, PLAINTEXT_TOKEN);

    // A permanently unreadable old token must not trap the user. Login/register endpoints are
    // unauthenticated recovery boundaries: they must not depend on decrypting or sending the old token.
    const loginDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-subscription-decrypt-login-'));
    try {
      const loginFile = path.join(loginDir, 'subscription.json');
      await fsp.writeFile(loginFile, originalDisk, { encoding: 'utf8', mode: 0o600 });
      const loginStore = createSubscriptionStore({ userDataDir: loginDir });
      const newToken = 'replacement-session-token';
      const newCiphertext = 'replacement-session-ciphertext';
      let loginDecryptCalls = 0;
      const requests = [];
      loginStore._injectCrypto({
        encrypt(value) {
          assert.equal(String(value), newToken);
          return newCiphertext;
        },
        decrypt() {
          loginDecryptCalls += 1;
          throw new Error('old token is permanently unreadable');
        },
      });
      global.fetch = async (input, options = {}) => {
        const url = String(input instanceof Request ? input.url : input);
        requests.push({ url, authorization: options?.headers?.Authorization || '' });
        if (url.endsWith('/api/login')) {
          assert.equal(options?.headers?.Authorization, undefined, 'login recovery must never send or decrypt the old bearer token');
          return {
            ok: true,
            status: 200,
            json: async () => ({
              token: newToken,
              user: { id: 18, email: 'new@example.invalid', account_no: ACCOUNT_NO },
            }),
          };
        }
        if (url.endsWith('/api/status')) {
          assert.equal(options?.headers?.Authorization, `Bearer ${newToken}`, 'post-login status must use only the newly committed token');
          return { ok: true, status: 200, json: async () => ({ remaining_chars: 77 }) };
        }
        throw new Error(`unexpected request: ${url}`);
      };

      const loginResult = await loginStore.login('new@example.invalid', '0123456789');
      assert.equal(loginResult.ok, true, 'successful credentials must recover from an unreadable old local token');
      assert.equal(loginDecryptCalls, 0, 'login recovery must not attempt to decrypt the obsolete token');
      assert.equal(requests.length, 2, 'login recovery should perform login plus the normal status refresh only');
      assert.ok(requests[0].url.endsWith('/api/login'));
      assert.equal(requests[0].authorization, '');
      assert.ok(requests[1].url.endsWith('/api/status'));
      assert.equal(requests[1].authorization, `Bearer ${newToken}`);
      const loginState = await loginStore.getState();
      assert.equal(loginState.loggedIn, true);
      assert.equal(loginState.email, 'new@example.invalid');
      assert.equal(loginState.remaining_chars, 77);
      const loginDisk = JSON.parse(await fsp.readFile(loginFile, 'utf8'));
      assert.equal(loginDisk.token, `enc:${newCiphertext}`, 'recovery login must replace the unreadable ciphertext with the new encrypted token');
      assert.notEqual(loginDisk.token, newToken);
    } finally {
      fs.rmSync(loginDir, { recursive: true, force: true });
    }
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('SUBSCRIPTION_TOKEN_DECRYPT_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
