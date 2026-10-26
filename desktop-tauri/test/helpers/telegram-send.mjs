// Offline worker/event ports shaped from the reviewed Telegram K sources. The
// same test ports run with both the VM DOM and actual Chromium DOM.
import { randomUUID } from 'node:crypto';
import { File, Blob } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const safety = createRequire(import.meta.url)('../../../ui/broadcast-safety.js');
const files = ['telegram-send-runtime.js', 'telegram-send-receipt.js', 'telegram-attachments.js',
  'telegram-audience.js', 'telegram-send.js', 'telegram-reply-context.js', 'send-composer-telegram.js'];
const source = files.map((file) => readFileSync(new URL(`../../guest/${file}`, import.meta.url), 'utf8')).join('\n');
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
export const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
class Emitter {
  constructor() { this.events = new Map(); }
  addEventListener(name, callback) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(callback);
  }
  removeEventListener(name, callback) { this.events.get(name)?.delete(callback); }
  emit(name, value) { for (const callback of [...this.events.get(name) || []]) callback(value); }
  count(name) { return this.events.get(name)?.size || 0; }
}
class Element extends Emitter {
  constructor(tag, text = '') {
    super(); this.tagName = tag.toUpperCase(); this.nodeType = 1; this.isConnected = true; this.hidden = false;
    this.parentNode = null; this.childNodes = []; this.attrs = new Map(); this._text = text; this.style = {};
    this.classList = { contains: (name) => (this.attrs.get('class') || '').split(' ').includes(name) };
  }
  get innerText() { return this._text; }
  set innerText(value) { this._text = value; }
  get textContent() { return this._text; }
  set textContent(value) { this._text = value; }
  get id() { return this.attrs.get('id') || ''; }
  set id(value) { this.attrs.set('id', value); }
  get className() { return this.attrs.get('class') || ''; }
  set className(value) { this.attrs.set('class', value); }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  getClientRects() { return this.isConnected && !this.hidden ? [{}] : []; }
  contains(node) { return this === node || this.childNodes.some((child) => child.contains?.(node)); }
  append(child) { child.parentNode = this; this.childNodes.push(child); }
  remove() {
    if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter((node) => node !== this);
    this.parentNode = null; this.isConnected = false;
  }
}

// Serializable test ports only; never a substitute for the actual adapter,
// receipt matcher, bridge or SendIntent guest under test.
export function installTelegramPorts({ window, container, chatInput, editor, button }) {
  class Emitter {
    constructor() { this.events = new Map(); }
    addEventListener(name, callback) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(callback);
  }
    removeEventListener(name, callback) { this.events.get(name)?.delete(callback); }
    emit(name, value) { for (const callback of [...this.events.get(name) || []]) callback(value); }
    count(name) { return this.events.get(name)?.size || 0; }
  }
  const state = { now: 0, account: 1, self: 90, sends: [], stages: [], cancelled: [], updates: [], generated: [],
    dialogs: { 0: [{ _: 'dialog', peerId: 101 }, { _: 'dialog', peerId: -202 }], 1: [] },
    peers: new Map([[101, { _: 'user', id: 101, pFlags: {}, first_name: 'Alice' }],
      [-202, { _: 'channel', id: 202, pFlags: { megagroup: true }, title: 'Team' }]]),
    mirrors: new Map(), pending: new Map(), byServerId: new Map(), maxLength: 4096, allowed: true,
    stars: undefined, requirement: { _: 'requirementToContactEmpty' }, migrated: undefined, botforum: false,
    replyLookups: [], generateOptions: [], phoneLookups: [], memberLookups: [],
    phones: new Map([['12025550101', 101]]),
    fullGroups: new Map([[202, { _: 'channelFull', id: 202,
      pFlags: { can_view_participants: true }, participants_count: 2 }]]), fullGroupLookups: [],
    memberPages: new Map([['202:0', { _: 'channels.channelParticipants', count: 2,
      participants: [{ _: 'channelParticipant', user_id: 101 }, { _: 'channelParticipantSelf', user_id: 90 }],
      users: [], chats: [] }]]),
    shortcut: 'enter', final: 700, mode: 'short', popup: false, changes: [], clears: [] };
  const root = new Emitter(); root.myId = state.self;
  const im = new Emitter();
  const input = { messageInput: editor, messageInputField: { input: editor }, chatInput, inputValueGeneration: 0,
    btnSend: button, sendBtnIcon: 'send', getCurrentInputAsDraft: () => state.draftOverride
      || (editor.innerText ? { _: 'draftMessage', date: 1, message: editor.innerText.trim(), pFlags: {},
        reply_to: input.replyToMsgId ? { _: 'inputReplyToMessage', reply_to_msg_id: input.replyToMsgId,
          top_msg_id: chat.threadId, reply_to_peer_id: input.replyToPeerId,
          monoforum_peer_id: input.replyToMonoforumPeerId, poll_option: input.replyToPollOption,
          ...(input.replyToQuote ? { quote_text: input.replyToQuote.text } : {}) } : undefined } : undefined),
    clearInput(canSetDraft, fireEvent) {
      state.clears.push({ canSetDraft, fireEvent }); input.inputValueGeneration += 1; editor.innerText = '';
      return Promise.resolve();
    } };
  const chat = { peerId: 101, type: 'chat', container, input }; input.chat = chat; im.chat = chat;
  const outputPeer = (id) => id > 0 ? { _: 'peerUser', user_id: id }
    : state.peers.get(id)?._ === 'chat' ? { _: 'peerChat', chat_id: -id } : { _: 'peerChannel', channel_id: -id };
  const peerOf = (peer) => peer._ === 'peerUser' ? peer.user_id : -(peer.chat_id || peer.channel_id);
  const normalizePending = (message) => ({ ...structuredClone(message), mid: message.id, peerId: peerOf(message.peer_id) });
  const mirrorKey = (peer, mid) => `${peer}_history:${mid}`;
  function emitFinal(pending, { id = state.final, mid = pending.peer_id._ === 'peerChannel' ? 0x100000000 + id : id,
    text = pending.message, ...overrides } = {}) {
    const final = { ...structuredClone(pending), id, mid, message: text, ...overrides };
    delete final.pending; delete final.random_id; delete final.error;
    delete final.pFlags.is_outgoing;
    state.mirrors.set(mirrorKey(final.peerId, final.mid), final);
    root.emit('message_sent', { storageKey: `${pending.peerId}_history`, tempId: pending.mid,
      tempMessage: pending, mid: final.mid, message: final });
    return final;
  }
  const bound = new Map();
  function managers(account) {
    if (bound.has(account)) return bound.get(account);
    const result = {
      apiManager: {
        getConfig: async () => {
          if (state.configGate) await state.configGate.promise;
          return { message_length_max: state.maxLength };
        },
        invokeApiAfter(method, params, options) {
          state.sends.push({ account, method, params: structuredClone(params), options: structuredClone(options) });
          if (state.apiThrow) throw new Error('untrusted error must not escape');
          if (state.apiGate) return state.apiGate.promise;
          if (state.mode === 'error') return Promise.reject(new Error('network details'));
          if (state.mode === 'void') return Promise.resolve(undefined);
          if (state.mode === 'updates') return Promise.resolve({ _: 'updates', updates: [{ _: 'updateMessageID',
            random_id: params.random_id, id: state.final }], users: [], chats: [], date: 5, seq: 1 });
          if (state.mode === 'never') return new Promise(() => {});
          return Promise.resolve({ _: 'updateShortSentMessage', id: state.final, date: 5, pFlags: { out: true },
            pts: 1, pts_count: 1, ...(state.webpage ? { media: state.webpage } : {}) });
        },
      },
      appPeersManager: {
        getPeerMigratedTo: async () => state.migrated,
        isBotforum: async () => state.botforum,
        getStarsAmount: async () => state.stars,
        getInputPeerById: async (id) => id > 0 ? { _: 'inputPeerUser', user_id: id, access_hash: '500' }
          : state.peers.get(id)?._ === 'chat' ? { _: 'inputPeerChat', chat_id: -id }
            : { _: 'inputPeerChannel', channel_id: -id, access_hash: '600' },
      },
      appUsersManager: {
        getRequirementToContact: async () => state.requirement,
        async resolvePhone(phone) {
          state.phoneLookups.push({ account, phone, at: state.now });
          if (state.phoneGate) await state.phoneGate.promise;
          if (state.phoneError) throw state.phoneError;
          const id = state.phones.get(phone);
          if (!id) throw { type: 'PHONE_NOT_OCCUPIED' };
          return state.phoneResult || state.peers.get(id);
        },
      },
      appProfileManager: {
        async getChannelFull(id) {
          state.fullGroupLookups.push({ account, id });
          return state.fullGroups.get(id);
        },
        async getParticipants(options) {
          state.memberLookups.push({ account, options: structuredClone(options) });
          if (state.memberGate) await state.memberGate.promise;
          if (state.memberHook) state.memberHook(options);
          return state.memberPages.get(`${options.id}:${options.offset}`);
        },
      },
      appMessagesManager: {
        canSendToPeer: async () => state.allowed,
        async getInputReplyTo(options) {
          state.replyLookups.push({ account, options: structuredClone(options) });
          if (state.replyGate) await state.replyGate.promise;
          if (state.inputReplyOverride) return state.inputReplyOverride;
          return { _: 'inputReplyToMessage', reply_to_msg_id: options.replyToMsgId % 0x100000000,
            monoforum_peer_id: undefined, reply_to_peer_id: undefined, top_msg_id: undefined, poll_option: undefined };
        },
        async generateOutgoingMessage(id, options) {
          if (state.generateGate) await state.generateGate.promise;
          state.generateOptions.push(structuredClone(options));
          const next = state.generated.length + 1;
          const base = state.peers.get(id)?._ === 'channel' ? 0x100000000 + 100 : 100;
          const message = { _: 'message', id: +(base + next / 10000).toFixed(4), random_id: String(10000000 + next), date: 4,
            peer_id: outputPeer(id), from_id: { _: 'peerUser', user_id: state.self }, pending: true, pFlags: { out: true } };
          if (options.replyTo) message.reply_to = { _: 'messageReplyHeader', pFlags: {},
            reply_to_msg_id: (state.peers.get(id)?._ === 'channel' ? 0x100000000 : 0) + options.replyTo.reply_to_msg_id,
            poll_option: undefined, reply_media: undefined };
          if (state.generateHook) state.generateHook(message);
          state.generated.push(message); return structuredClone(message);
        },
        async cancelPendingMessage(randomId) { state.cancelled.push({ account, randomId }); state.pending.delete(randomId); },
      },
      apiUpdatesManager: {
        async processLocalUpdate(update) {
          state.updates.push({ account, update: structuredClone(update) });
          if (update._ === 'updateMessageID') state.byServerId.set(update.id, update.random_id);
          else {
            const random = state.byServerId.get(update.message.id);
            const pending = state.pending.get(random);
            if (pending && !state.noAck) emitFinal(pending, { id: update.message.id,
              ...(update.message.media ? { media: update.message.media } : {}) });
          }
        },
        async processUpdateMessage(updates) {
          state.updates.push({ account, update: structuredClone(updates) });
          const mapping = updates.updates.find((item) => item._ === 'updateMessageID');
          const pending = state.pending.get(mapping?.random_id);
          if (pending && !state.noAck) emitFinal(pending, { id: mapping.id });
        },
      },
      dialogsStorage: { getFolderDialogs: async (id) => state.dialogs[id] },
    };
    bound.set(account, result); return result;
  }
  const proxy = {
    getTabState: () => ({ accountNumber: state.account }), getPeer: (id) => state.peers.get(id),
    getMessageFromStorage: (key, mid) => state.mirrors.get(`${key}:${mid}`),
    invokeVoid(type, payload) {
      if (type !== 'manager' || payload.name !== 'appMessagesManager' || payload.method !== 'beforeMessageSending') {
        throw new Error('Unexpected platform request');
      }
      const message = normalizePending(payload.args[0]);
      if (payload.args[1].clearDraft !== false || 'send' in message) throw new Error('Unsafe staging request');
      state.stages.push({ account: payload.accountNumber, message });
      state.pending.set(message.random_id, message);
      if (state.stageHook) state.stageHook(message);
      if (!state.noAppend) root.emit('history_append', { storageKey: `${message.peerId}_history`, message });
    },
  };
  Object.assign(window, { rootScope: root, apiManagerProxy: proxy,
    appImManager: im, createProxiedManagersForAccount: managers, useAppSettings: () => [{ sendShortcut: state.shortcut }] });
  return { state, root, im, proxy, input, chat, emitFinal, normalizePending,
    switchAccount(account = 2, self = 91) {
      state.account = account; state.self = self; root.myId = self;
      root.emit('account_switched', { from: 1, to: account });
    } };
}

// Current K constructReplyElements/setTopInfo -> ReplyContainer/PeerTitle DOM.
// It is an offline platform port: no sender, owner or reply matcher lives here.
export function installTelegramReply({ document, container, chat, state },
  { id = 51, mid = state.peers.get(chat.peerId)?._ === 'channel' ? 0x100000000 + id : id,
    body = 'Can we send the report tomorrow?', from = chat.peerId > 0 ? chat.peerId : 102,
    author = 'Alice', model: overrides = {} } = {}) {
  const input = chat.input;
  const make = (tag, className, text) => {
    const node = document.createElement(tag); node.setAttribute('class', className);
    if (text !== undefined) node.innerText = text;
    return node;
  };
  input.replyElements?.container.remove();
  const wrapper = make('div', 'reply-wrapper rows-wrapper-row');
  const content = make('div', 'reply-wrapper-content'); wrapper.append(content);
  const icon = make('button', 'reply-icon'); content.append(icon);
  const region = make('div', 'reply quote-like quote-like-hoverable quote-like-border'); content.append(region);
  const quoteContent = make('div', 'reply-content'); region.append(quoteContent);
  const title = make('div', 'reply-title'); quoteContent.append(title);
  const peer = make('span', 'peer-title', author); peer.setAttribute('data-peer-id', from); title.append(peer);
  const value = body.trim();
  const subtitle = make('div', 'reply-subtitle', value.length > 110 ? value.slice(0, 100) + '...' : value);
  quoteContent.append(subtitle);
  content.append(make('button', 'reply-cancel'));
  input.chatInput.append(wrapper);
  container.setAttribute('class', 'chat is-helper-active');
  input.replyElements = { container: wrapper, content };
  input.replyToMsgId = mid; input.helperType = 'reply'; input.helperVisible = true;
  const model = { _: 'message', peerId: chat.peerId, id, mid, fromId: from, date: 3,
    pFlags: {}, message: body, entities: [], totalEntities: [], ...overrides };
  state.mirrors.set(`${chat.peerId}_history:${mid}`, model);
  return { wrapper, content, region, title, peer, subtitle, model };
}

export function telegramFixture({ install = true, touch = false } = {}) {
  const container = new Element('div'); container.setAttribute('class', 'chat'); container.setAttribute('data-type', 'chat');
  const chatInput = new Element('div'); container.append(chatInput);
  const editor = new Element('div', 'Please send tomorrow.'); editor.setAttribute('contenteditable', 'true'); chatInput.append(editor);
  const button = new Element('button'); button.setAttribute('class', 'send'); chatInput.append(button);
  const icon = new Element('span'); button.append(icon);
  const location = { href: 'https://web.telegram.org/k/#101', hash: '#101', hostname: 'web.telegram.org' };
  const window = new Emitter(); window.location = location; window.top = window;
  if (touch) window.ontouchstart = null;
  const ports = installTelegramPorts({ window, container, chatInput, editor, button });
  const { state } = ports;
  const timers = new Map(); let timerId = 0;
  const observers = new Set();
  const document = new Emitter(); document.visibilityState = 'visible';
  document.documentElement = new Element('html'); document.body = new Element('body');
  document.documentElement.append(document.body); document.body.append(container);
  document.createElement = (tag) => new Element(tag);
  document.getElementById = (id) => document.body.childNodes.find((node) => node.id === id) || null;
  document.querySelectorAll = (selector) => selector.startsWith('.chat[') ? [container]
    : (selector.includes('.popup') || selector.includes('dialog')) && state.popupNodes ? state.popupNodes
      : selector.includes('.popup') && state.popup ? [new Element('div')] : [];
  class Observer {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    takeRecords() { return []; }
    disconnect() { observers.delete(this); }
  }
  const context = { window, document, location, URL, TextEncoder, MutationObserver: Observer, File, Blob,
    crypto: { randomUUID },
    GeekBroadcastSafety: safety, performance: { now: () => state.now },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, at: state.now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  window.setTimeout = context.setTimeout; window.clearTimeout = context.clearTimeout;
  window.crypto = context.crypto;
  const run = (script) => runInNewContext(script, context, { timeout: 1000 });
  window.changes = state.changes;
  if (install) run(`${source}\nwindow.testApi = {
    runtime:createTelegramSendRuntime(), adapter:createTelegramKAdapter(),
    composer:createTelegramSendComposer((change)=>window.changes.push(change))};`);
  async function advance(milliseconds = 25) {
    state.now += milliseconds;
    for (const [id, timer] of [...timers]) if (timer.at <= state.now) { timers.delete(id); timer.callback(); }
    await flush();
  }
  async function until(predicate) {
    for (let i = 0; i < 100; i += 1) { await flush(); if (predicate()) return; await advance(); }
    throw new Error('Fixture did not reach its observable boundary');
  }
  async function finish(promise) {
    let done = false, value, error;
    promise.then((result) => { value = result; done = true; }, (reason) => { error = reason; done = true; });
    await until(() => done);
    if (error) throw error;
    return value;
  }
  return { ...ports, window, location, document, editor, button, icon, container, context, run,
    ...window.testApi, advance, until, finish,
    mutate(records = [{ target: editor }]) { for (const observer of observers) observer.callback(records); },
    request: (overrides = {}) => ({ targetId: 'tg:101', message: 'Hello', tagAll: false, vcards: [], attachments: [], ...overrides }),
  };
}
