'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSubscriptionStore } = require('../src/subscription.cjs');

const ACCOUNT_NO = `GK-${'e'.repeat(32)}`;

function persistedState() {
  return {
    token: 'enc:durable-session-token',
    email: 'durability@example.invalid',
    user_id: 71,
    account_no: ACCOUNT_NO,
    account_ref: ACCOUNT_NO,
    remaining_chars: 321,
  };
}

function createStore(userDataDir) {
  const store = createSubscriptionStore({ userDataDir });
  store._injectCrypto({
    encrypt: value => String(value),
    decrypt: value => String(value),
  });
  return store;
}

async function seed(file) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(persistedState(), null, 2), { encoding: 'utf8', mode: 0o600 });
}

function tokenResponse() {
  return new Response(JSON.stringify({
    token: 'short-lived-translation-token',
    expires_at: Math.floor(Date.now() / 1000) + 300,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installDurabilityProbe({ stateFile, failFileSync = false, failDirectorySync = false }) {
  const originalOpen = fsp.open;
  const originalRename = fsp.rename;
  const originalRm = fsp.rm;
  const events = [];
  const tempFile = `${stateFile}.tmp`;
  const directory = path.dirname(stateFile);
  let stateRenames = 0;

  fsp.open = async (target, flags, mode) => {
    const resolved = path.resolve(String(target));
    if (resolved === path.resolve(directory) && flags === 'r') {
      events.push('open-dir');
      return {
        async sync() {
          events.push('sync-dir');
          if (failDirectorySync) {
            const error = new Error('synthetic directory fsync failure');
            error.code = 'EPERM';
            throw error;
          }
        },
        async close() {
          events.push('close-dir');
        },
      };
    }

    const handle = await originalOpen(target, flags, mode);
    if (resolved !== path.resolve(tempFile) || flags !== 'w') return handle;
    events.push('open-temp');
    return {
      async writeFile(content, encoding) {
        events.push('write-temp');
        return handle.writeFile(content, encoding);
      },
      async sync() {
        events.push('sync-temp');
        if (failFileSync) {
          const error = new Error('synthetic subscription temp fsync failure');
          error.code = 'EIO';
          throw error;
        }
        return handle.sync();
      },
      async close() {
        events.push('close-temp');
        return handle.close();
      },
    };
  };

  fsp.rename = async (from, to) => {
    if (path.resolve(String(to)) === path.resolve(stateFile)) {
      stateRenames += 1;
      events.push('rename-state');
    }
    return originalRename(from, to);
  };

  fsp.rm = async (target, options) => {
    if (path.resolve(String(target)) === path.resolve(tempFile)) events.push('remove-temp');
    return originalRm(target, options);
  };

  return {
    events,
    stateRenames: () => stateRenames,
    restore() {
      fsp.open = originalOpen;
      fsp.rename = originalRename;
      fsp.rm = originalRm;
    },
  };
}

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'geek-subscription-crash-durable-'));
  const originalFetch = global.fetch;
  try {
    global.fetch = async (input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/api/translation-token')) return tokenResponse();
      throw new Error(`unexpected network request: ${url}`);
    };

    // Successful logout must flush the complete sibling temp before rename and then
    // flush the parent directory before reporting the state transition committed.
    {
      const dir = path.join(root, 'success');
      const stateFile = path.join(dir, 'subscription.json');
      await seed(stateFile);
      const store = createStore(dir);
      assert.equal((await store.getState()).loggedIn, true);
      const lease = await store.getTranslationAuthorization();
      const probe = installDurabilityProbe({ stateFile });
      try {
        assert.deepEqual(await store.logout(), { ok: true });
        assert.deepEqual(probe.events, [
          'open-temp',
          'write-temp',
          'sync-temp',
          'close-temp',
          'rename-state',
          'open-dir',
          'sync-dir',
          'close-dir',
        ], 'subscription commit must be temp write -> file fsync -> close -> rename -> directory fsync');
        assert.equal(probe.stateRenames(), 1);
        assert.throws(
          () => store.assertTranslationAuthorizationCurrent(lease),
          error => error?.code === 'SUBSCRIPTION_SESSION_CHANGED',
          'successful durable logout must advance/abort the prior authorization generation'
        );
      } finally {
        probe.restore();
      }
      const restarted = createStore(dir);
      assert.deepEqual(await restarted.getState(), { loggedIn: false }, 'durably committed logout must remain logged out after restart');
    }

    // A file fsync failure is precommit. It must prevent rename, clean the temp,
    // keep the authenticated memory/disk authority, and keep the old generation valid.
    {
      const dir = path.join(root, 'file-sync-failure');
      const stateFile = path.join(dir, 'subscription.json');
      await seed(stateFile);
      const store = createStore(dir);
      assert.equal((await store.getState()).loggedIn, true);
      const lease = await store.getTranslationAuthorization();
      const probe = installDurabilityProbe({ stateFile, failFileSync: true });
      try {
        await assert.rejects(
          store.logout(),
          error => error?.code === 'EIO',
          'logout must reject if the tombstone temp cannot be flushed before publication'
        );
        assert.equal(probe.stateRenames(), 0, 'unflushed subscription state must never be renamed into authority');
        assert.deepEqual(probe.events, [
          'open-temp',
          'write-temp',
          'sync-temp',
          'close-temp',
          'remove-temp',
        ]);
        assert.equal((await store.getState()).loggedIn, true, 'failed precommit logout must keep in-memory authentication');
        assert.doesNotThrow(
          () => store.assertTranslationAuthorizationCurrent(lease),
          'failed precommit logout must not advance or abort the session generation'
        );
        await assert.rejects(fsp.readFile(`${stateFile}.tmp`, 'utf8'), error => error?.code === 'ENOENT');
        const disk = JSON.parse(await fsp.readFile(stateFile, 'utf8'));
        assert.equal(disk.token, 'enc:durable-session-token', 'previous durable token must remain authoritative after fsync failure');
      } finally {
        probe.restore();
      }
    }

    // Directory fsync is attempted only after publication and remains best effort
    // for Windows/filesystems that reject directory handles/fsync. The already
    // published tombstone must not be reported as rolled back.
    {
      const dir = path.join(root, 'directory-sync-unsupported');
      const stateFile = path.join(dir, 'subscription.json');
      await seed(stateFile);
      const store = createStore(dir);
      assert.equal((await store.getState()).loggedIn, true);
      const lease = await store.getTranslationAuthorization();
      const probe = installDurabilityProbe({ stateFile, failDirectorySync: true });
      try {
        assert.deepEqual(await store.logout(), { ok: true }, 'unsupported directory fsync must stay best effort after rename');
        assert.ok(probe.events.indexOf('rename-state') < probe.events.indexOf('sync-dir'));
        assert.equal(probe.events.at(-1), 'close-dir', 'directory handle must close even when fsync is unsupported');
        assert.throws(
          () => store.assertTranslationAuthorizationCurrent(lease),
          error => error?.code === 'SUBSCRIPTION_SESSION_CHANGED'
        );
      } finally {
        probe.restore();
      }
      const restarted = createStore(dir);
      assert.deepEqual(await restarted.getState(), { loggedIn: false });
    }

    console.log('SUBSCRIPTION_STATE_CRASH_DURABILITY_CONTRACT_OK');
  } finally {
    global.fetch = originalFetch;
    fsp.open = require('node:fs/promises').open;
    fsp.rename = require('node:fs/promises').rename;
    fsp.rm = require('node:fs/promises').rm;
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
