'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const readiness = require(path.join(root, 'ui', 'broadcast-chat-readiness.js'));

async function runGuest(script, window) {
  return vm.runInNewContext(script, {
    window,
    setTimeout,
    Date,
    Promise,
    JSON,
    Object,
    Array,
    String,
    Math,
  });
}

async function run() {
  // 1 + 2) Cold-start readiness is authoritative: chat.list must not run before
  // conn.isMainReady(), and a later ready state recovers automatically.
  {
    let readinessCalls = 0;
    let listCalls = 0;
    const result = await runGuest(
      readiness.createWhatsAppGetChatsScript({ timeoutMs: 100, pollMs: 1 }),
      {
        WPP: {
          conn: { isMainReady: async () => ++readinessCalls >= 3 },
          chat: {
            list: async () => {
              listCalls += 1;
              return [{ id: 'e2e-chat-a@g.us', name: 'Synthetic Group', isGroup: true }];
            },
          },
        },
      },
    );
    assert.equal(readinessCalls, 3);
    assert.equal(listCalls, 1, 'chat.list must not be sampled while WhatsApp is not main-ready');
    assert.deepEqual(JSON.parse(result), [{ id: 'e2e-chat-a@g.us', name: 'Synthetic Group', realName: '', type: '群组' }]);
  }

  // 3) Reliable main readiness plus a genuinely empty list is a valid empty result.
  {
    const result = await runGuest(
      readiness.createWhatsAppGetChatsScript({ timeoutMs: 20, pollMs: 1 }),
      { WPP: { conn: { isMainReady: async () => true }, chat: { list: async () => [] } } },
    );
    assert.deepEqual(JSON.parse(result), []);
  }

  // 4) A transient chat-store read failure remains recoverable inside the same bounded run.
  {
    let listCalls = 0;
    const result = await runGuest(
      readiness.createWhatsAppGetChatsScript({ timeoutMs: 100, pollMs: 1 }),
      {
        WPP: {
          conn: { isMainReady: async () => true },
          chat: {
            list: async () => {
              listCalls += 1;
              if (listCalls === 1) throw new Error('cold store');
              return [{ id: 'e2e-chat-b@c.us', name: 'Synthetic Contact', isGroup: false, contact: { pushname: 'Synthetic Contact' } }];
            },
          },
        },
      },
    );
    assert.equal(listCalls, 2);
    assert.equal(JSON.parse(result)[0].id, 'e2e-chat-b@c.us');
  }

  // 5 + 6) Timeout is bounded and explicitly retryable; a fresh invocation can succeed.
  {
    let listCalls = 0;
    const first = await runGuest(
      readiness.createWhatsAppGetChatsScript({ timeoutMs: 5, pollMs: 1 }),
      { WPP: { conn: { isMainReady: async () => false }, chat: { list: async () => { listCalls += 1; return []; } } } },
    );
    assert.match(first, /^ERR:WhatsApp 聊天列表仍在初始化，请关闭后重试/);
    assert.equal(listCalls, 0, 'timeout must not convert an unready store into a false empty list');

    const second = await runGuest(
      readiness.createWhatsAppGetChatsScript({ timeoutMs: 20, pollMs: 1 }),
      { WPP: { conn: { isMainReady: async () => true }, chat: { list: async () => [{ id: 'retry@c.us', name: 'Retry', isGroup: false }] } } },
    );
    assert.equal(JSON.parse(second)[0].id, 'retry@c.us');
  }

  // 7) Installer changes only the shared WhatsApp list transport and is idempotent.
  {
    const whatsappTransport = { getChats: 'WA_ORIGINAL', sendDirect: () => 'SENT' };
    const calls = [];
    const target = {
      GeekPlatformTransports: {
        forAccount(account) {
          calls.push(account.type);
          return {
            getCurrentChat() {}, listChats() {}, openChat() {}, setComposerText() {}, sendText() {},
            transport: whatsappTransport,
          };
        },
      },
    };
    const sendDirect = whatsappTransport.sendDirect;
    assert.equal(readiness.install(target), true);
    const firstScript = whatsappTransport.getChats;
    assert.match(firstScript, /__GEEK_BROADCAST_CHAT_READINESS__/);
    assert.match(firstScript, /conn\.isMainReady/);
    assert.equal(whatsappTransport.sendDirect, sendDirect, 'send transport must remain untouched');
    assert.equal(readiness.install(target), true);
    assert.equal(whatsappTransport.getChats, firstScript, 'installer must be idempotent');
    assert.deepEqual(calls, ['whatsapp', 'whatsapp']);
  }

  const helperSource = fs.readFileSync(path.join(root, 'ui', 'broadcast-chat-readiness.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
  const safetySource = fs.readFileSync(path.join(root, 'ui', 'broadcast-safety.js'), 'utf8');
  const workbenchSource = fs.readFileSync(path.join(root, 'ui', 'broadcast-workbench.js'), 'utf8');
  const e2eSource = fs.readFileSync(path.join(root, 'e2e', 'specs', 'broadcast-readiness.e2e.cjs'), 'utf8');

  // 8) Workbench must not retake readiness ownership or intercept the broadcast entry.
  assert.doesNotMatch(workbenchSource, /bc-menu-send|W\.chat\.list|isMainReady|loader\.onReady/);

  // 9) Production readiness is bounded: no interval or recursive host timer.
  assert.doesNotMatch(helperSource, /setInterval\s*\(/);
  assert.match(helperSource, /timeoutMs/);
  assert.match(helperSource, /pollMs/);
  assert.match(helperSource, /ERR:WhatsApp 聊天列表仍在初始化，请关闭后重试/);

  // 10) app.js remains the sole editor/list owner and keeps the canonical generation guards.
  assert.match(appSource, /let broadcastChatLoadSequence = 0;/);
  assert.match(appSource, /let broadcastChatsReady = false;/);
  assert.match(appSource, /const loadSequence = \+\+broadcastChatLoadSequence;/);
  assert.match(appSource, /loadSequence !== broadcastChatLoadSequence/);
  assert.match(appSource, /activeId !== ownerAccountId/);
  assert.match(appSource, /bOverlay\.classList\.contains\('hidden'\)/);
  assert.match(appSource, /broadcastChatLoadSequence \+= 1;/);
  assert.match(appSource, /bMetaEl\.textContent = '加载聊天列表…';/);

  // 11) Readiness is preloaded by the bounded broadcast loader and self-installs after app ownership exists.
  assert.match(safetySource, /loadScript\('\.\/broadcast-chat-readiness\.js', 'GeekBroadcastChatReadiness'\)/);
  assert.match(helperSource, /DOMContentLoaded/);
  assert.match(helperSource, /GeekPlatformTransports/);

  // 12) WA-JS readiness belongs only to the dedicated read transport, not app/workbench/send code.
  assert.doesNotMatch(appSource, /conn\.isMainReady/);
  assert.doesNotMatch(workbenchSource, /conn\.isMainReady/);
  assert.match(helperSource, /conn\.isMainReady/);

  // 13) The Electron regression is synthetic/read-only and never exercises broadcast sending.
  assert.doesNotMatch(e2eSource, /#broadcast-send[^\w-].*click|click\(.*#broadcast-send/s);
  assert.doesNotMatch(e2eSource, /sendText|sendDirect|broadcast-send-message/);

  console.log('BROADCAST_CHAT_READINESS_CONTRACT_OK');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
