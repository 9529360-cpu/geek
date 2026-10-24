'use strict';

const vm = require('node:vm');
const { File, Blob } = require('node:buffer');
const { compose } = require('../scripts/prepare-platform.cjs');

// Execute the actual build composition, including the canonical registry, chat
// reader and send guard. Only the external WA-JS runtime and browser clock are fake.
const source = compose();
const ids = Object.freeze({ contact: '100@c.us', lid: '200@lid', group: '300-400@g.us' });
const uuid = (value) => `${String(value).padStart(8, '0')}-1111-4111-8111-111111111111`;
const copy = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const flush = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function wid(id) {
  return { _serialized: id, toString: () => id };
}

function chat(id, fields = {}) {
  return { id: wid(id), isGroup: id.endsWith('@g.us'), name: `Chat ${id}`,
    contact: { pushname: `Person ${id}` }, ...fields };
}

function receipt(id = 'true_100@c.us_TEST0001', ack = 1) {
  return { id, ack, sendMsgResult: { messageSendResult: 'OK' } };
}

function fixture({ iframe = false, generation = uuid(1), attachments = false } = {}) {
  let nextId = 10;
  let nextTimer = 0;
  const clock = { now: 1000, wall: 1700000000000 };
  const timers = new Map();
  const models = new Map(Object.values(ids).map((id) => [id, chat(id)]));
  const sends = [];
  const behavior = {};
  const state = { ready: true };
  const outbound = (kind, target, value, options) => {
    const call = copy({ kind, target, options });
    call.value = kind === 'file' ? value : copy(value);
    sends.push(call);
    return behavior[kind] ? behavior[kind](call) : receipt(`true_${target}_TEST${sends.length}`);
  };
  const WPP = {
    isInjected: true,
    isReady: true,
    loader: { moduleRequire() {} },
    whatsapp: { _moduleIdMap: new Map() },
    conn: { isMainReady: () => state.ready },
    chat: {
      get: (id) => models.get(id),
      list: () => behavior.list ? behavior.list() : [...models.values()],
      getActiveChat: () => models.get(ids.lid),
      sendTextMessage: (target, value, options) => outbound('text', target, value, options),
      sendVCardContactMessage: (target, value, options) => outbound('cards', target, value, options),
    },
    group: {
      getParticipants: (target) => behavior.participants ? behavior.participants(target)
        : [{ id: wid(ids.contact) }, { id: wid(ids.lid) }],
    },
    contact: {
      getPnLidEntry: (id) => behavior.lookup ? behavior.lookup(id) : { phoneNumber: wid(ids.contact) },
    },
  };
  if (attachments) {
    WPP.chat.sendFileMessage = (target, value, options) => outbound('file', target, value, options);
  }
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.wall])); }
    static now() { return clock.wall; }
  }
  const window = { WPP };
  window.top = iframe ? {} : window;
  const context = vm.createContext({
    window,
    File, Blob, Uint8Array, atob, btoa,
    performance: { now: () => clock.now },
    Date: FakeDate,
    setTimeout: (callback, delay = 0) => {
      const id = ++nextTimer;
      timers.set(id, { at: clock.now + Math.max(0, Number(delay) || 0), callback });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(source, context, { timeout: 1000 });
  const bridge = window.__geekTauriPlatform;
  if (bridge) bridge.bind(generation);

  const start = (operation, payload = {}, options = {}) => {
    const request = { id: uuid(nextId++), generation, platformId: 'whatsapp', operation, payload, ...options };
    return { id: request.id, request, accepted: bridge.begin(request) };
  };
  const draft = (fields = {}) => ({ attemptId: uuid(nextId++), targetId: ids.contact,
    message: 'Synthetic test message', tagAll: false, vcards: [], ...fields });
  const read = (id, expected = generation) => copy(bridge.read(expected, id));
  const advance = async (duration) => {
    const end = clock.now + duration;
    await flush();
    for (let runs = 0; ; runs += 1) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      if (runs >= 1000) throw new Error('Fixture timer did not settle');
      clock.now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
      await flush();
    }
    clock.now = end;
    await flush();
  };
  return { bridge, window, WPP, generation, clock, models, sends, behavior, state, start, draft, read, advance, flush };
}

module.exports = { fixture, ids, uuid, wid, chat, receipt, deferred };
