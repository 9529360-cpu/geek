'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'translation-whatsapp-rehydrate.js'), 'utf8');

function loadHostModule() {
  const document = {
    readyState: 'loading',
    addEventListener() {},
    querySelectorAll() { return []; },
    documentElement: {},
  };
  const context = vm.createContext({
    window: {},
    document,
    MutationObserver: class { observe() {} disconnect() {} },
  });
  vm.runInContext(source, context, { filename: 'translation-whatsapp-rehydrate.js' });
  return context.window.GeekWhatsAppTranslationRehydrate;
}

function createGuestHarness(originalTranslate) {
  let chatId = 'chat-a';
  const timers = [];
  const observers = [];
  const rows = [];
  const main = {
    querySelectorAll() { return rows; },
  };
  const document = {
    title: 'WhatsApp',
    documentElement: {},
    querySelector(selector) { return selector === '#main' ? main : null; },
  };
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() {}
  }
  const window = {
    WPP: { chat: { getActiveChat: () => ({ id: { _serialized: chatId } }) } },
    __geekTranslateVisibleMessage: originalTranslate,
    __geekGetTranslationSetting: () => ({ displayTranslation: true, translationMode: 'auto' }),
    __geekRefreshTranslationView() {},
  };
  const context = vm.createContext({
    window,
    document,
    location: { hostname: 'web.whatsapp.com' },
    MutationObserver: FakeMutationObserver,
    setTimeout(callback) { timers.push(callback); return timers.length; },
    clearTimeout() {},
    setInterval(callback) { return { callback }; },
    clearInterval() {},
    Promise,
    Object,
    Math,
    String,
    Array,
  });
  const api = loadHostModule();
  vm.runInContext(api.guestInstallerSource(), context, { filename: 'whatsapp-translation-admission-guest.js' });
  const flushTimers = () => {
    while (timers.length) timers.shift()();
  };
  return {
    window,
    rows,
    observers,
    flushTimers,
    setChat(next) { chatId = next; },
  };
}

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

(async () => {
  const moduleApi = loadHostModule();
  const guestSource = moduleApi.guestInstallerSource();
  assert.match(guestSource, /BACKGROUND_ACTIVE_LIMIT = 2/, 'WhatsApp background display translation must reserve a small fixed active budget');
  assert.match(guestSource, /BACKGROUND_QUEUE_LIMIT = 8/, 'WhatsApp background display translation queue must be bounded');
  assert.match(guestSource, /clearQueuedBackground\(\)/, 'chat generation changes must discard queued obsolete work');
  assert.match(guestSource, /translationMode: 'click'/, 'pre-existing history rows must be rendered as on-demand instead of auto fan-out');

  let active = 0;
  let maxActive = 0;
  let started = 0;
  const releases = [];
  const harness = createGuestHarness(row => new Promise(resolve => {
    started += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    releases.push(() => { active -= 1; resolve(row.id); });
  }));
  harness.flushTimers();
  const wrapped = harness.window.__geekTranslateVisibleMessage;
  assert.equal(wrapped.__geekBackgroundAdmission, true, 'visible-message translation must be wrapped by bounded admission');
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.window.__geekWhatsAppTranslationAdmission)),
    { activeLimit: 2, queueLimit: 8 },
    'runtime diagnostics must expose the fixed admission budget'
  );

  const burst = Array.from({ length: 12 }, (_, index) => wrapped({ id: `m-${index}`, dataset: {} }));
  await tick();
  assert.equal(started, 2, 'a dense visible-message burst must start at most two translations immediately');
  assert.equal(maxActive, 2, 'background active concurrency must never exceed two');

  while (releases.length) {
    releases.shift()();
    await tick();
  }
  const burstResults = await Promise.all(burst);
  assert.equal(started, 10, 'overflow work must be dropped instead of creating an unbounded pending backlog');
  assert.equal(burstResults.filter(value => value === false).length, 2, 'exactly the overflow beyond active plus queue capacity must be discarded');
  assert.equal(maxActive, 2, 'draining the bounded queue must preserve the active limit');

  let staleStarted = 0;
  const staleReleases = [];
  const staleHarness = createGuestHarness(row => new Promise(resolve => {
    staleStarted += 1;
    staleReleases.push(() => resolve(row.id));
  }));
  staleHarness.flushTimers();
  const staleWrapped = staleHarness.window.__geekTranslateVisibleMessage;
  const staleTasks = Array.from({ length: 7 }, (_, index) => staleWrapped({ id: `old-${index}`, dataset: {} }));
  await tick();
  assert.equal(staleStarted, 2, 'only the active background slots may reach translation before a chat switch');
  staleHarness.setChat('chat-b');
  for (const observer of staleHarness.observers) observer.callback([]);
  staleHarness.flushTimers();
  await tick();
  assert.equal(staleStarted, 2, 'queued work from the old chat must be discarded before remote execution');
  while (staleReleases.length) staleReleases.shift()();
  const staleResults = await Promise.all(staleTasks);
  assert.equal(staleResults.filter(value => value === false).length, 5, 'all queued old-chat work must settle as discarded');

  let capturedMode = '';
  const historyHarness = createGuestHarness(() => {
    capturedMode = historyHarness.window.__geekGetTranslationSetting('chat-a').translationMode;
    return Promise.resolve(true);
  });
  historyHarness.flushTimers();
  await historyHarness.window.__geekTranslateVisibleMessage({ id: 'history-1', dataset: { geekTranslationInitialHistory: '1' } });
  assert.equal(capturedMode, 'click', 'pre-existing history rows must not silently start automatic cloud translation');
  assert.equal(historyHarness.window.__geekGetTranslationSetting('chat-a').translationMode, 'auto', 'history compatibility shim must restore the user setting immediately');

  console.log('WHATSAPP_TRANSLATION_ADMISSION_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
