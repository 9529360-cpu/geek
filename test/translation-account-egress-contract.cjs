'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createTranslationRuntime } = require('../src/translation-runtime.cjs');
const { createSubscriptionStore } = require('../src/subscription.cjs');
const { mainFrameIpcEvent } = require('./helpers/main-frame-ipc-event.cjs');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createPool() {
  return {
    endpoints: ['https://translate.example'],
    healthCheckAll: async () => ({ primary: true }),
    pick: () => ({ endpoint: 'https://translate.example', route: 'primary' }),
    reportFailure() {},
    reportSuccess() {},
    reportInconclusive() {},
  };
}

(async () => {
  {
    const handlers = new Map();
    const networkCalls = [];
    const authorizationController = new AbortController();
    const accounts = new Map([
      ['A', { id: 'A', partition: 'persist:webview-page-A' }],
      ['B', { id: 'B', partition: 'persist:webview-page-B' }],
    ]);
    const sessions = new Map(
      [...accounts.values()].map(account => [
        account.partition,
        {
          partition: account.partition,
          async fetch(url, request = {}) {
            networkCalls.push({
              partition: account.partition,
              url: String(url),
              intent: request.headers?.['X-Geek-Translation-Intent'] || '',
            });
            if (String(url).includes('/api/translation-token')) {
              return jsonResponse({ token: 'translation-token', expires_at: Math.floor(Date.now() / 1000) + 300 });
            }
            if (String(url).endsWith('/v1/translate')) {
              return jsonResponse({ text: 'hello', source: 'auto', target: 'en' });
            }
            throw new Error(`unexpected account-session fetch: ${url}`);
          },
        },
      ])
    );

    const subscriptionStore = {
      async getQuota() {
        return { remaining_chars: 1000 };
      },
      async getTranslationAuthorization(options = {}) {
        assert.equal(typeof options.fetchImpl, 'function', 'translation authorization must receive the account-bound transport');
        await options.fetchImpl('https://subscription.example/api/translation-token', { method: 'POST' });
        return Object.freeze({
          token: 'translation-token',
          generation: 1,
          signal: authorizationController.signal,
        });
      },
      assertTranslationAuthorizationCurrent(lease) {
        assert.equal(lease?.generation, 1);
        assert.equal(lease?.signal, authorizationController.signal);
      },
    };

    const runtime = createTranslationRuntime({
      ipcMain: {
        handle(channel, handler) {
          handlers.set(channel, handler);
        },
        removeHandler(channel) {
          handlers.delete(channel);
        },
      },
      fs: {
        readFile: async () => '',
        appendFile: async () => {},
        mkdir: async () => {},
      },
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: value => Buffer.from(value),
        decryptString: value => Buffer.from(value).toString(),
      },
      getUserDataDir: () => '/tmp/geek-translation-egress-test',
      accountState: {
        findById(id) {
          return accounts.get(String(id)) || null;
        },
      },
      createGatewayPool: createPool,
      assertSafeTranslationOutput: ({ output }) => output,
      assertTrustedSender: () => {},
      assertValidAccountId: value => {
        if (!accounts.has(String(value))) throw new Error('invalid account');
      },
      getSubscriptionStore: () => subscriptionStore,
      getSessionForPartition: partition => sessions.get(String(partition)),
      fetchImpl: async url => {
        throw new Error(`remote translation traffic bypassed account Session: ${url}`);
      },
      randomUUID: () => 'request-egress-1',
    }).install();

    const event = mainFrameIpcEvent({ id: 77 });
    const translate = handlers.get('translation:translate');
    for (const accountId of ['A', 'B']) {
      const result = await translate(event, {
        accountId,
        text: '你好',
        source: 'auto',
        target: 'en',
        refresh: true,
        intent: 'outgoing-send',
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.result.text, 'hello');
    }

    const accountACalls = networkCalls.filter(call => call.partition === 'persist:webview-page-A');
    const accountBCalls = networkCalls.filter(call => call.partition === 'persist:webview-page-B');
    assert.equal(accountACalls.some(call => call.url.includes('/api/translation-token')), true, 'account A authorization must use account A Session');
    assert.equal(accountACalls.some(call => call.url.endsWith('/v1/translate')), true, 'account A gateway request must use account A Session');
    assert.equal(accountBCalls.some(call => call.url.includes('/api/translation-token')), true, 'account B authorization must use account B Session');
    assert.equal(accountBCalls.some(call => call.url.endsWith('/v1/translate')), true, 'account B gateway request must use account B Session');
    assert.equal(
      networkCalls.every(call => call.intent === '' || call.intent === 'outgoing-send'),
      true,
      'translation intent metadata must remain bounded to translation gateway requests'
    );

    runtime.dispose();
  }

  {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geek-subscription-egress-'));
    try {
      await fs.writeFile(path.join(dir, 'subscription.json'), JSON.stringify({
        token: 'enc:session-token',
        email: 'test@example.invalid',
      }));
      const store = createSubscriptionStore({ userDataDir: dir });
      store._injectCrypto({
        encrypt: value => value,
        decrypt: value => value,
      });

      const calls = [];
      function transport(name) {
        return async (url) => {
          calls.push({ name, url: String(url) });
          await new Promise(resolve => setTimeout(resolve, name === 'A' ? 10 : 1));
          return jsonResponse({
            token: `token-${name}`,
            expires_at: Math.floor(Date.now() / 1000) + 300,
          });
        };
      }

      const [leaseA, leaseB] = await Promise.all([
        store.getTranslationAuthorization(true, { networkKey: 'persist:webview-page-A', fetchImpl: transport('A') }),
        store.getTranslationAuthorization(true, { networkKey: 'persist:webview-page-B', fetchImpl: transport('B') }),
      ]);

      assert.equal(leaseA.token, 'token-A');
      assert.equal(leaseB.token, 'token-B');
      assert.equal(calls.filter(call => call.name === 'A').length, 1, 'account A must own its token request transport');
      assert.equal(calls.filter(call => call.name === 'B').length, 1, 'account B must own its token request transport');
      assert.equal(calls.every(call => call.url.endsWith('/api/translation-token')), true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }

  {
    const mainSource = await fs.readFile(path.join(__dirname, '../src/main.cjs'), 'utf8');
    assert.match(
      mainSource,
      /createTranslationRuntime\([\s\S]{0,1200}getSessionForPartition:\s*\(partition\)\s*=>\s*session\.fromPartition\(partition,\s*\{\s*cache:\s*true\s*\}\)/,
      'main process must compose Translation Runtime with the account partition Session'
    );
  }

  console.log('TRANSLATION_ACCOUNT_EGRESS_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
