// Read-only production Web A source, Ajaxy/telegram-tt f67a40879a7d78c2683ec5a296cf55bc22417d56.
// worker/connector.ts + worker.ts: native module Worker, { payloads: [{ type: 'updates', updates }] }.
// mtpUpdateHandler.ts: new => updateMessage/isFromNew/isFull; edits omit isFromNew.
// updateManager.ts also replays difference.newMessages: a new connection establishes a fresh time fence.
// This installer runs at document start. It never reads outgoing requests, credentials or method responses.
function installTelegramAIncomingObserver() {
  const name = '__geekTauriTelegramAIncomingSource';
  if (window[name]) return true;
  const url = window.location;
  if (window !== window.top || document.readyState !== 'loading' || url?.protocol !== 'https:'
      || url.hostname !== 'web.telegram.org' || (url.port && url.port !== '443')
      || !['/a', '/a/'].includes(url.pathname) || url.search || url.username || url.password
      || typeof window.Worker !== 'function') return false;
  const NativeWorker = window.Worker;
  const listeners = new Set();
  const peers = new Map();
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const integer = (value) => Number.isSafeInteger(value) && value > 0;
  const peerId = (value) => typeof value === 'string' && /^-?[1-9]\d{0,18}$/.test(value)
    && BigInt(value) >= -9223372036854775808n && BigInt(value) <= 9223372036854775807n;
  const forbidden = ['isForum', 'isMonoforum', 'isBotForum', 'isNotJoined', 'isForbidden', 'isRestricted'];
  let candidate = null;
  let count = 0;
  let epoch = 0;
  let after = 0;
  let myId = '';
  let authorized = false;
  let connected = false;
  let stopped = false;
  const ready = () => !stopped && Boolean(candidate && myId && authorized && connected);
  const publish = (event) => {
    for (const listener of listeners) {
      try { listener(Object.freeze(event)); } catch { /* An observer cannot interrupt Telegram. */ }
    }
  };
  function changed() {
    epoch += 1;
    after = Math.floor(Date.now() / 1000) + 1;
    publish({ type: 'reset' });
  }
  function chat(value, id, complete) {
    if (!peerId(id) || id[0] !== '-' || !object(value) || (value.id !== undefined && value.id !== id)) return;
    if (forbidden.some((field) => value[field] !== undefined && typeof value[field] !== 'boolean')) {
      peers.delete(id); publish({ type: 'peer', chatId: id }); return;
    }
    const old = peers.get(id);
    if (!complete && !old) return;
    if (!old && peers.size >= 256) return;
    const next = { ...old, id };
    if (complete || value.type !== undefined) next.type = value.type;
    for (const field of forbidden) {
      if (complete || Object.hasOwn(value, field)) next[field] = value[field] === true;
    }
    if (Object.values(next).some((part) => typeof part !== 'string' && typeof part !== 'boolean')) return;
    peers.set(id, Object.freeze(next));
    if (old && JSON.stringify(old) !== JSON.stringify(next)) publish({ type: 'peer', chatId: id });
  }
  function message(update) {
    if (!peerId(update.chatId) || !integer(update.id)) return;
    const value = update.message;
    const content = value?.content;
    let body = null;
    const blocked = ['sendingState', 'previousLocalId', 'editDate', 'groupedId', 'postAuthorTitle',
      'guestChatViaId', 'ephemeralId', 'ephemeralBotId', 'scheduleRepeatPeriod', 'ttlPeriod'];
    const flags = ['isEdited', 'isScheduled', 'isFromScheduled', 'isDeleting', 'isInAlbum', 'isEphemeral', 'isTypingDraft'];
    if (update.isFromNew === true && update.isFull === true && object(value)
        && value.id === update.id && value.chatId === update.chatId && value.isOutgoing === false
        && integer(value.date) && !blocked.some((key) => value[key] !== undefined)
        && !flags.some((key) => value[key]) && object(content) && Object.keys(content).length === 1
        && object(content.text) && typeof content.text.text === 'string') {
      const text = content.text.text;
      if (text.trim() && text.length <= 10000 && new TextEncoder().encode(text).length <= 32768
          && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)
          && (value.senderId === undefined || (peerId(value.senderId) && value.senderId[0] !== '-'))) {
        body = Object.freeze({ text, sentAt: value.date, senderId: value.senderId });
      }
    }
    publish({ type: 'message', chatId: update.chatId, messageId: String(update.id),
      fresh: update.isFromNew === true && update.isFull === true, body });
  }
  function update(value) {
    if (!object(value)) return;
    switch (value['@type']) {
      case 'updateAuthorizationState': {
        const next = value.authorizationState === 'authorizationStateReady';
        if (authorized !== next || !next) {
          authorized = next;
          if (!next) { myId = ''; peers.clear(); }
          changed();
        }
        break;
      }
      case 'updateCurrentUser': {
        const next = value.currentUser?.id;
        const id = peerId(next) && next[0] !== '-' ? next : '';
        if (id !== myId) { myId = id; peers.clear(); changed(); }
        break;
      }
      case 'updateConnectionState': {
        const next = value.connectionState === 'connectionStateReady';
        if (connected !== next || !next) { connected = next; changed(); }
        break;
      }
      case 'updateEntities': {
        if (!object(value.chats)) break;
        const keys = Object.keys(value.chats);
        if (keys.length > 256) { peers.clear(); changed(); break; }
        for (const id of keys) chat(value.chats[id], id, true);
        break;
      }
      case 'updateChat': chat(value.chat, value.id, false); break;
      case 'updateChatLeave':
        if (peerId(value.id)) { peers.delete(value.id); publish({ type: 'peer', chatId: value.id }); }
        break;
      case 'updateMessage': message(value); break;
      case 'deleteMessages': {
        if (!Array.isArray(value.ids) || value.ids.length > 2000
            || (value.chatId !== undefined && !peerId(value.chatId))) { changed(); break; }
        const ids = value.ids.filter(integer).map(String);
        publish({ type: 'delete', chatId: value.chatId, ids: Object.freeze(ids) });
        break;
      }
      default: break; // Especially updateSession, methodResponse and authorization payload details.
    }
  }
  function observe(worker) {
    candidate?.remove();
    candidate = null; myId = ''; authorized = false; connected = false; peers.clear(); changed();
    if (++count > 8) { stopped = true; return; }
    const record = { remove: () => {} };
    const receive = (event) => {
      if (candidate !== record || stopped || event.isTrusted !== true) return;
      try {
        const payloads = event.data?.payloads;
        if (!Array.isArray(payloads) || payloads.length > 256) { changed(); return; }
        for (const payload of payloads) {
          if (payload?.type !== 'updates') continue;
          if (!Array.isArray(payload.updates) || payload.updates.length > 2000) { changed(); return; }
          for (const item of payload.updates) update(item);
        }
      } catch { changed(); }
    };
    const failure = () => { if (candidate === record) { connected = false; changed(); } };
    worker.addEventListener('message', receive);
    worker.addEventListener('messageerror', failure);
    worker.addEventListener('error', failure);
    record.remove = () => {
      worker.removeEventListener('message', receive);
      worker.removeEventListener('messageerror', failure);
      worker.removeEventListener('error', failure);
    };
    candidate = record;
  }
  const accepts = (args) => {
    try {
      if (args[1]?.type !== 'module' || args[1]?.name !== '') return false;
      const source = new URL(args[0], url.href);
      // Official vite.config.ts uses base './' and worker entryFileNames '[name]-[hash].js'.
      return source.origin === url.origin && /^\/a\/worker-[\w-]{6,64}\.js$/.test(source.pathname)
        && !source.search && !source.hash && !source.username && !source.password;
    } catch { return false; }
  };
  const api = Object.freeze({
    state: () => Object.freeze({ epoch, after, myId, ready: ready() }),
    peer: (id) => peers.get(id) || null,
    subscribe(listener) {
      if (typeof listener !== 'function' || listeners.size >= 4) return null;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  try {
    window.Worker = new Proxy(NativeWorker, { construct(target, args, constructor) {
      const worker = Reflect.construct(target, args, constructor);
      if (accepts(args)) { try { observe(worker); } catch { stopped = true; changed(); } }
      return worker;
    } });
    Object.defineProperty(window, name, { value: api });
    return true;
  } catch { return false; }
}

// Short-lived proof only. translation.js owns the request UUID, quota, retries and rendered result.
function telegramAIncoming(scope, eligibility, invalidate) {
  const receipts = new Map();
  const seen = new Set();
  const SPECIAL_PEERS = new Set(['777000', '489000', '1271266957', '2666000']);
  let source = null;
  let unsubscribe = null;
  let binding = null;
  let bytes = 0;
  let after = 0;
  let closed = false;
  const normal = (text) => text.replace(/\u200b/g, '').trim();
  function reset() {
    receipts.clear(); bytes = 0;
    after = Math.floor(Date.now() / 1000) + 1;
  }
  function discard(key) {
    const value = receipts.get(key);
    if (value) bytes -= value.text.length * 2;
    receipts.delete(key);
  }
  function changed() { reset(); invalidate(); }
  function sync() {
    if (closed) return;
    for (const [key, value] of receipts) if (performance.now() - value.observed > 45000) discard(key);
    const next = window.__geekTauriTelegramAIncomingSource || null;
    if (next !== source) {
      unsubscribe?.(); unsubscribe = null; source = null; binding = null; changed();
      if (next && typeof next.state === 'function' && typeof next.peer === 'function' && typeof next.subscribe === 'function') {
        source = next; unsubscribe = source.subscribe(receive);
        if (!unsubscribe) source = null;
      }
    }
    const state = source?.state(); const page = scope();
    const valid = state?.ready && page && state.myId !== page.peer && !SPECIAL_PEERS.has(page.peer);
    const nextBinding = valid ? { ...state, ...page } : null;
    if ((!nextBinding && binding) || (nextBinding && (!binding || nextBinding.epoch !== binding.epoch
        || nextBinding.myId !== binding.myId || nextBinding.peer !== binding.peer || nextBinding.container !== binding.container))) {
      binding = nextBinding; changed();
    }
  }
  function current() {
    sync();
    if (!binding || !source?.state().ready) return null;
    const group = binding.peer[0] === '-';
    if (group) {
      const peer = source.peer(binding.peer);
      if (!peer || !['chatTypeBasicGroup', 'chatTypeSuperGroup'].includes(peer.type)
          || peer.isForum || peer.isMonoforum || peer.isBotForum || peer.isNotJoined || peer.isForbidden || peer.isRestricted) return null;
    }
    return { ...binding, group };
  }
  function receive(event) {
    if (closed) return;
    try {
      if (event.type === 'reset') { sync(); return; }
      const live = current();
      if (!live || (event.chatId !== undefined && event.chatId !== live.peer)) return;
      if (event.type === 'peer') { changed(); return; }
      if (event.type === 'delete') {
        for (const id of event.ids) {
          const key = `${live.myId}:${live.peer}:${id}`;
          discard(key); if (seen.size < 1000) seen.add(key);
        }
        invalidate(); return;
      }
      if (event.type !== 'message') return;
      const key = `${live.myId}:${live.peer}:${event.messageId}`;
      if (!event.fresh) {
        discard(key); if (seen.size < 1000) seen.add(key);
        invalidate(); return;
      }
      if (seen.has(key)) {
        const old = receipts.get(key);
        if (old && (!event.body || old.text !== event.body.text || old.sentAt !== event.body.sentAt
            || old.senderId !== event.body.senderId)) { discard(key); invalidate(); }
        return;
      }
      if (seen.size >= 1000) return;
      seen.add(key);
      const policy = eligibility(`tg:${live.peer}`); const body = event.body;
      const sender = body?.senderId ?? (live.group ? '' : live.peer);
      const now = Math.floor(Date.now() / 1000);
      if (!policy || !body || !sender || sender === live.myId || (!live.group && sender !== live.peer)
          || body.sentAt < Math.max(policy.after, live.after, after) || body.sentAt > now + 60
          || (live.group && !policy.groupAuto) || bytes + body.text.length * 2 > 2 * 1024 * 1024) return;
      receipts.set(key, { ...body, key, container: live.container, observed: performance.now(), claimed: false });
      bytes += body.text.length * 2;
    } catch { changed(); }
  }
  function proof(root, messageId, text) {
    try {
      const live = current();
      if (!live) return null;
      const key = `${live.myId}:${live.peer}:${messageId}`;
      const receipt = receipts.get(key); const policy = eligibility(`tg:${live.peer}`);
      if (!receipt || !policy) return null;
      const age = performance.now() - receipt.observed;
      if (age > 45000 || (!receipt.claimed && age > 5000)) { discard(key); return null; }
      if (receipt.container !== live.container || root.classList.contains('own')
          || receipt.sentAt < Math.max(policy.after, live.after, after) || (live.group && !policy.groupAuto)
          || normal(receipt.text) !== text) { discard(key); return null; }
      return { incoming: true, sentAt: receipt.sentAt, automaticProof: key };
    } catch { return null; }
  }
  return {
    sync, reset, proof,
    claim(entry) {
      const receipt = receipts.get(entry.automaticProof);
      if (!receipt || receipt.claimed) return false;
      receipt.claimed = true; return true;
    },
    close() { closed = true; unsubscribe?.(); unsubscribe = null; source = null; binding = null; reset(); seen.clear(); },
  };
}
