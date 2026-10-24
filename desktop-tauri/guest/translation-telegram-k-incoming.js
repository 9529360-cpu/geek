// Read-only Web K provenance. These are short-lived source observations, not a
// translation queue: translation.js still owns every UUID, request and result.
// tweb exposes rootScope/apiManagerProxy/appImManager in production (debug.ts).
// history_multiappend comes from onUpdateNewMessage, unlike DOM/history loading.
function telegramKIncoming(scope, eligibility, invalidate) {
  const seen = new Set();
  const receipts = new Map();
  const MAX_OBSERVATIONS = 1000;
  const MAX_BYTES = 2 * 1024 * 1024;
  const SPECIAL_PEERS = new Set([777000, 489000, 1271266957, 2666000]);
  let source = null;
  let subscriptions = [];
  let bytes = 0;
  let closed = false;
  const integer = (value) => Number.isSafeInteger(value) && value > 0;
  const peerNumber = (value) => Number.isSafeInteger(value) && value !== 0;
  const normal = (value) => value.replace(/\u200b/g, '').trim();
  const flags = (value) => value && typeof value === 'object' && !Array.isArray(value);
  function discard(key) {
    const receipt = receipts.get(key);
    if (receipt) bytes -= receipt.text.length * 2;
    receipts.delete(key);
  }
  function reset() { receipts.clear(); bytes = 0; }
  function changed() { reset(); invalidate(); }
  function available() {
    const root = window.rootScope; const proxy = window.apiManagerProxy; const im = window.appImManager;
    if (!root || !proxy || !im || !integer(root.myId)
        || typeof root.addEventListener !== 'function' || typeof root.removeEventListener !== 'function'
        || typeof im.addEventListener !== 'function' || typeof im.removeEventListener !== 'function'
        || typeof proxy.getMessageFromStorage !== 'function' || typeof proxy.getPeer !== 'function') return null;
    return { root, proxy, im, myId: root.myId };
  }
  function current() {
    const page = scope(); const live = available();
    if (!page || !live || !source || live.root !== source.root || live.proxy !== source.proxy
        || live.im !== source.im || live.myId !== source.myId) return null;
    const chat = live.im.chat; const peer = Number(page.peer);
    if (!peerNumber(peer) || String(peer) !== page.peer || peer === live.myId || SPECIAL_PEERS.has(peer)
        || !chat || chat.container !== page.outer || chat.peerId !== peer || chat.type !== 'chat'
        || chat.threadId || chat.monoforumThreadId || chat.isPreview || chat.isForum || chat.isBotforum
        || chat.isMonoforum || chat.isTemporaryThread) return null;
    const peerModel = live.proxy.getPeer(peer);
    if (!peerModel || peerModel.id !== Math.abs(peer) || !flags(peerModel.pFlags)) return null;
    const group = peer < 0;
    if (group) {
      if (peerModel._ !== 'chat' && !(peerModel._ === 'channel' && peerModel.pFlags.megagroup === true)) return null;
      if (peerModel.pFlags.broadcast || peerModel.pFlags.forum || peerModel.pFlags.monoforum
          || peerModel.pFlags.left || peerModel.pFlags.deactivated) return null;
    } else if (peerModel._ !== 'user' || peerModel.pFlags.self || peerModel.pFlags.deleted) return null;
    return { ...live, ...page, chat, peer, group };
  }
  function messageProof(message, live) {
    const f = message?.pFlags;
    if (!message || message._ !== 'message' || !flags(f)
        || (f.out !== undefined && f.out !== false) || f.is_outgoing || f.post || f.welcome_template
        || f.from_scheduled || f.is_scheduled || f.ephemeral || message.edit_date !== undefined
        || message.media !== undefined || message.action !== undefined || message.grouped_id !== undefined
        || message.peerId !== live.peer || !integer(message.mid) || !integer(message.date)
        || !integer(message.fromId) || message.fromId === live.myId
        || (!live.group && message.fromId !== live.peer) || typeof message.message !== 'string') return null;
    const text = message.message;
    if (!normal(text) || text.length > 10000 || new TextEncoder().encode(text).length > 32768
        || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) return null;
    return { text, sentAt: message.date, mid: message.mid, fromId: message.fromId };
  }
  function receive(message) {
    try {
      const live = current();
      if (!live || !integer(message?.mid) || message.peerId !== live.peer) return;
      const key = `${live.myId}:${live.peer}:${message.mid}`;
      // Never evict an observed identity to admit a replay. Capacity falls back to manual.
      if (seen.has(key) || seen.size >= MAX_OBSERVATIONS) return;
      seen.add(key);
      const policy = eligibility(`tg:${live.peer}`); const proof = messageProof(message, live);
      const now = Math.floor(Date.now() / 1000);
      if (!policy || !proof || proof.sentAt < policy.after || proof.sentAt > now + 60
          || (live.group && !policy.groupAuto) || bytes + proof.text.length * 2 > MAX_BYTES) return;
      const observed = performance.now();
      receipts.set(key, { ...proof, key, chat: live.chat, container: live.container, myId: live.myId,
        peer: live.peer, group: live.group, observed, claimed: false });
      bytes += proof.text.length * 2;
    } catch { /* Missing/changed platform interfaces never affect manual translation. */ }
  }
  function edited(event) {
    try {
      const live = current();
      if (!live || event?.peerId !== live.peer || !integer(event.mid)) return;
      discard(`${live.myId}:${live.peer}:${event.mid}`);
      invalidate();
    } catch { changed(); }
  }
  function sync() {
    if (closed) return;
    for (const [key, receipt] of receipts) if (performance.now() - receipt.observed > 45000) discard(key);
    const next = available();
    if (!next && !source && !subscriptions.length) return;
    if (next && source && next.root === source.root && next.proxy === source.proxy
        && next.im === source.im && next.myId === source.myId) return;
    for (const [object, name, listener] of subscriptions) {
      try { object.removeEventListener(name, listener); } catch { /* old instance */ }
    }
    subscriptions = []; source = null; changed();
    if (!next) return;
    source = next;
    try {
      for (const [object, name, listener] of [[next.root, 'history_multiappend', receive],
        [next.root, 'message_edit', edited], [next.root, 'user_auth', changed], [next.im, 'peer_changing', changed]]) {
        object.addEventListener(name, listener); subscriptions.push([object, name, listener]);
      }
    } catch { source = null; reset(); }
  }
  function proof(root, messageId, text) {
    try {
      const live = current();
      if (!live) return null;
      const receipt = receipts.get(`${live.myId}:${live.peer}:${messageId}`);
      const policy = eligibility(`tg:${live.peer}`);
      if (!receipt || !policy) return null;
      const age = performance.now() - receipt.observed;
      if (age > 45000 || (!receipt.claimed && age > 5000)) { discard(receipt.key); return null; }
      if (receipt.chat !== live.chat || receipt.container !== live.container
          || receipt.sentAt < policy.after || (receipt.group && !policy.groupAuto)
          || root.getAttribute('role') !== 'article' || !root.classList.contains('is-in')
          || root.classList.contains('is-out') || root.getAttribute('data-timestamp') !== String(receipt.sentAt)
          || normal(receipt.text) !== text) { discard(receipt.key); return null; }
      // History-only cache read; unlike getMessageByPeer this cannot fall back to admin logs.
      const model = live.proxy.getMessageFromStorage(`${live.peer}_history`, receipt.mid);
      if (!model) return null; // A mirror may arrive after its new-message event.
      const latest = messageProof(model, live);
      if (!latest || latest.text !== receipt.text || latest.sentAt !== receipt.sentAt || latest.fromId !== receipt.fromId) {
        discard(receipt.key); return null;
      }
      return { incoming: true, sentAt: receipt.sentAt, automaticProof: receipt.key };
    } catch { return null; }
  }
  return {
    sync, reset, proof,
    claim(entry) {
      const receipt = receipts.get(entry.automaticProof);
      if (!receipt || receipt.claimed) return false;
      receipt.claimed = true;
      return true;
    },
    close() {
      closed = true; reset();
      for (const [object, name, listener] of subscriptions) {
        try { object.removeEventListener(name, listener); } catch { /* old instance */ }
      }
      subscriptions = []; source = null; seen.clear();
    },
  };
}
