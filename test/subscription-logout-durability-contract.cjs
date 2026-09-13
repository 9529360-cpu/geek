'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSubscriptionStore } = require('../src/subscription.cjs');

function persistedState() {
  const accountNo = `GK-${'a'.repeat(32)}`;
  return {
    token: 'enc:persisted-session-token',
    email: 'logout-contract@example.invalid',
    user_id: 42,
    account_no: accountNo,
    account_ref: accountNo,
    remaining_chars: 1234,
    quota_cache: {
      remaining_chars: 1234,
      email: 'logout-contract@example.invalid',
      account_no: accountNo,
      account_ref: accountNo,
    },
  };
}

function createStore(userDataDir) {
  const store = createSubscriptionStore({ userDataDir });
  store._injectCrypto({
    encrypt: (value) => String(value),
    decrypt: (value) => String(value),
  });
  return store;
}

async function writePersistedState(stateFile) {
  await fsp.mkdir(path.dirname(stateFile), { recursive: true });
  await fsp.writeFile(stateFile, JSON.stringify(persistedState(), null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-subscription-logout-'));
  const stateFile = path.join(dir, 'subscription.json');
  const originalRm = fsp.rm;
  const originalRename = fsp.rename;

  try {
    // Regression proof: filesystem deletion is not a safe logout authority.
    await writePersistedState(stateFile);
    const store = createStore(dir);
    assert.equal((await store.getState()).loggedIn, true, 'fixture must begin authenticated');

    let rmCalls = 0;
    fsp.rm = async () => {
      rmCalls += 1;
      const error = new Error('simulated antivirus/file-lock deletion failure');
      error.code = 'EPERM';
      throw error;
    };

    assert.deepEqual(await store.logout(), { ok: true }, 'logout should succeed after durable tokenless state commit');
    assert.equal(rmCalls, 0, 'logout durability must not depend on deleting subscription.json');

    const diskAfterLogout = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
    assert.deepEqual(diskAfterLogout, {}, 'successful logout must persist a fully tokenless/accountless tombstone');
    for (const forbidden of ['token', 'email', 'user_id', 'account_no', 'account_ref', 'remaining_chars', 'quota_cache']) {
      assert.equal(Object.hasOwn(diskAfterLogout, forbidden), false, `logout tombstone must not retain ${forbidden}`);
    }

    const restarted = createStore(dir);
    assert.deepEqual(await restarted.getState(), { loggedIn: false }, 'restart after successful logout must not resurrect the old session');

    // Failure semantics: if the atomic tombstone cannot commit, logout must not claim success
    // or make memory disagree with the still-authoritative authenticated disk state.
    fsp.rm = originalRm;
    await writePersistedState(stateFile);
    const failingStore = createStore(dir);
    assert.equal((await failingStore.getState()).loggedIn, true, 'second fixture must begin authenticated');

    fsp.rename = async (from, to) => {
      if (path.resolve(to) === path.resolve(stateFile)) {
        const error = new Error('simulated durable state commit failure');
        error.code = 'EPERM';
        throw error;
      }
      return originalRename(from, to);
    };

    await assert.rejects(
      failingStore.logout(),
      /simulated durable state commit failure/,
      'logout must reject when the tokenless durable state cannot commit'
    );
    assert.equal((await failingStore.getState()).loggedIn, true, 'failed durable logout must keep the in-memory authenticated state');
    const diskAfterFailure = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
    assert.equal(diskAfterFailure.token, 'enc:persisted-session-token', 'failed logout must leave the original durable token authoritative');
  } finally {
    fsp.rm = originalRm;
    fsp.rename = originalRename;
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('SUBSCRIPTION_LOGOUT_DURABILITY_CONTRACT_OK');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
