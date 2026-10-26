import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

// Offline native Worker boundary; only this fixture can label an event trusted.
// Wire shapes come from telegram-tt f67a408 worker.ts, mtpUpdateHandler.ts and entityProcessor.ts.
const { composeTelegramAObserver } = createRequire(import.meta.url)('../../scripts/prepare-translation.cjs');
export function telegramARuntime(f, { readyState = 'loading', initialize = true } = {}) {
  const instances = [];
  class Worker {
    constructor(url, options) { this.url = url; this.options = options; this.listeners = new Map(); this.sent = []; instances.push(this); }
    addEventListener(type, listener) {
      const set = this.listeners.get(type) || new Set(); set.add(listener); this.listeners.set(type, set);
    }
    removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
    postMessage(...args) { this.sent.push(args); }
    terminate() { this.terminated = true; }
    emit(data, { trusted = true, type = 'message' } = {}) {
      for (const listener of [...(this.listeners.get(type) || [])]) listener({ isTrusted: trusted, data: structuredClone(data) });
    }
  }
  f.document.readyState = readyState;
  f.window.Worker = Worker;
  class ClockDate extends Date { static now() { return f.state.unix * 1000; } }
  runInNewContext(composeTelegramAObserver(), {
    window: f.window, document: f.document, Date: ClockDate, URL, TextEncoder,
  });
  const installed = Boolean(f.window.__geekTauriTelegramAIncomingSource);
  let worker;
  const create = (url = 'https://web.telegram.org/a/worker-abc12345.js', options = { type: 'module', name: '' }) => {
    worker = new f.window.Worker(url, options); return worker;
  };
  const updates = (...values) => worker.emit({ payloads: [{ type: 'updates', updates: values }] });
  const ready = (id = '900') => updates(
    { '@type': 'updateConnectionState', connectionState: 'connectionStateReady' },
    { '@type': 'updateAuthorizationState', authorizationState: 'authorizationStateReady' },
    { '@type': 'updateCurrentUser', currentUser: { id }, currentUserFullInfo: {} },
  );
  const peer = (id, fields = {}) => updates({ '@type': 'updateEntities', chats: {
    [id]: { id, type: 'chatTypeBasicGroup', title: 'Synthetic group', ...fields },
  } });
  const message = (row, fields = {}) => ({ id: Number(row.root.getAttribute('data-message-id')),
    chatId: f.window.location.hash.slice(1), isOutgoing: false, date: f.state.unix,
    content: { text: { text: row.body.textContent } }, ...fields });
  const receive = (row, fields = {}, updateFields = {}) => {
    const value = message(row, fields);
    updates({ '@type': 'updateMessage', id: value.id, chatId: value.chatId, message: value,
      isFromNew: true, isFull: true, ...updateFields }); return value;
  };
  const nextSecond = () => { f.state.unix += 1; f.state.now += 1000; };
  if (initialize) { create(); ready(); }
  return { installed, Worker, instances, get worker() { return worker; }, create, ready, peer, message, receive,
    updates, nextSecond, get source() { return f.window.__geekTauriTelegramAIncomingSource; } };
}
