'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readiness = require(path.join(root, 'ui', 'broadcast-chat-readiness.js'));

function sequence(values, fallback) {
  let index = 0;
  return async () => {
    const value = index < values.length ? values[index++] : fallback;
    if (value instanceof Error) throw value;
    return value;
  };
}

async function run() {
  const states = [];
  let now = 0;
  const sleep = async ms => { now += ms; };

  // 1 + 2) A transient empty list while WPP is not ready must stay loading;
  // once main readiness is established, later real chats are accepted automatically.
  {
    const listChats = sequence([[], [{ id: 'e2e-chat-a@g.us', name: 'Synthetic Group', isGroup: true }]], []);
    const result = await readiness.loadBroadcastChatsWithReadiness({
      family: 'whatsapp',
      isReady: sequence([false, true], true),
      listChats,
      isCurrent: () => true,
      now: () => now,
      sleep,
      timeoutMs: 1000,
      pollMs: 100,
      onState: state => states.push(state),
    });
    assert.equal(result.state, 'ready');
    assert.equal(result.chats.length, 1);
    assert.ok(states.includes('loading'));
  }

  // 3) A reliably ready WPP with a genuinely empty list is a valid ready result.
  {
    const result = await readiness.loadBroadcastChatsWithReadiness({
      family: 'whatsapp', isReady: async () => true, listChats: async () => [],
      isCurrent: () => true, now: () => now, sleep, timeoutMs: 500, pollMs: 50,
    });
    assert.deepEqual(result, { state: 'ready', chats: [] });
  }

  // 4) A transient list failure remains recoverable.
  {
    const result = await readiness.loadBroadcastChatsWithReadiness({
      family: 'whatsapp', isReady: async () => true,
      listChats: sequence([new Error('cold store'), [{ id: 'e2e-chat-b@c.us' }]], []),
      isCurrent: () => true, now: () => now, sleep, timeoutMs: 500, pollMs: 50,
    });
    assert.equal(result.state, 'ready');
    assert.equal(result.chats.length, 1);
  }

  // 5) Timeout is retryable and never masquerades as an empty ready result.
  {
    now = 0;
    const result = await readiness.loadBroadcastChatsWithReadiness({
      family: 'whatsapp', isReady: async () => false, listChats: async () => [],
      isCurrent: () => true, now: () => now, sleep, timeoutMs: 250, pollMs: 100,
    });
    assert.equal(result.state, 'retryable');
    assert.equal(Object.hasOwn(result, 'chats'), false);
  }

  // 6) Retry starts a clean run after a timeout.
  {
    now = 0;
    const first = await readiness.loadBroadcastChatsWithReadiness({
      family: 'whatsapp', isReady: async () => false, listChats: async () => [],
      isCurrent: () => true, now: () => now, sleep, timeoutMs: 100, pollMs: 50,
    });
    const second = await readiness.loadBroadcastChatsWithReadiness({
      family: 'whatsapp', isReady: async () => true, listChats: async () => [{ id: 'retry@c.us' }],
      isCurrent: () => true, now: () => now, sleep, timeoutMs: 100, pollMs: 50,
    });
    assert.equal(first.state, 'retryable');
    assert.equal(second.state, 'ready');
    assert.equal(second.chats[0].id, 'retry@c.us');
  }

  // 7) Closing the overlay invalidates the current run and discards later results.
  {
    now = 0;
    let current = true;
    const result = await readiness.loadBroadcastChatsWithReadiness({
      family: 'whatsapp', isReady: async () => false, listChats: async () => [],
      isCurrent: () => current, now: () => now,
      sleep: async ms => { now += ms; current = false; }, timeoutMs: 500, pollMs: 50,
    });
    assert.equal(result.state, 'cancelled');
  }

  // 8) Switching owner A -> B invalidates A before it can publish a late result.
  {
    now = 0;
    let owner = 'A';
    const result = await readiness.loadBroadcastChatsWithReadiness({
      family: 'whatsapp', isReady: async () => false, listChats: async () => [],
      isCurrent: () => owner === 'A', now: () => now,
      sleep: async ms => { now += ms; owner = 'B'; }, timeoutMs: 500, pollMs: 50,
    });
    assert.equal(result.state, 'cancelled');
  }

  // 9 + 10) Telegram and LINE keep their one-shot list semantics and never enter WPP polling.
  for (const family of ['telegram', 'line']) {
    let readyCalls = 0;
    let listCalls = 0;
    const chats = [{ id: `${family}-chat` }];
    const result = await readiness.loadBroadcastChatsWithReadiness({
      family,
      isReady: async () => { readyCalls += 1; return false; },
      listChats: async () => { listCalls += 1; return chats; },
      isCurrent: () => true, now: () => now, sleep, timeoutMs: 100, pollMs: 10,
    });
    assert.equal(result.state, 'ready');
    assert.equal(result.chats, chats);
    assert.equal(readyCalls, 0, `${family} must not use WhatsApp readiness`);
    assert.equal(listCalls, 1, `${family} must preserve one-shot list loading`);
  }

  const helperSource = fs.readFileSync(path.join(root, 'ui', 'broadcast-chat-readiness.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
  const workbenchSource = fs.readFileSync(path.join(root, 'ui', 'broadcast-workbench.js'), 'utf8');
  const htmlSource = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');

  // 11) Workbench must not retake ownership of readiness or intercept the broadcast entry.
  assert.doesNotMatch(workbenchSource, /bc-menu-send|W\.chat\.list|isMainReady|loader\.onReady/);

  // 12) The bounded state machine uses no unbounded interval timer.
  assert.doesNotMatch(helperSource, /setInterval\s*\(/);
  assert.match(helperSource, /timeoutMs/);
  assert.match(helperSource, /pollMs/);

  // Integration contract: app remains the owner and exposes explicit loading/ready/retryable UX.
  assert.match(appSource, /GeekBroadcastChatReadiness/);
  assert.match(appSource, /broadcastChatLoadState/);
  assert.match(appSource, /WhatsApp 联系人与群组/);
  assert.match(appSource, /聊天列表仍在初始化/);
  assert.match(appSource, /重试/);
  assert.match(appSource, /WPP\.conn\.isMainReady|isMainReady/);
  assert.ok(htmlSource.indexOf('broadcast-chat-readiness.js') < htmlSource.indexOf('app.js'), 'readiness helper must load before app.js');

  console.log('BROADCAST_CHAT_READINESS_CONTRACT_OK');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
