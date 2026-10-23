// Telegram K production projections, reviewed at morethanwords/tweb commit
// 654ffd809aa402f31357db2a13c462b4e5b69a23. No general manager bridge is exposed.
function createTelegramSendRuntime() {
  const notSubmittedErrors = new WeakSet();
  const issue = (code, submitted = false) => {
    const error = Object.assign(new Error(code), { code, submitted });
    if (submitted === false) notSubmittedErrors.add(error);
    return error;
  };
  const peerNumber = (value) => typeof value === 'string' && /^-?[1-9]\d{0,15}$/.test(value)
    && Number.isSafeInteger(Number(value)) && String(Number(value)) === value ? Number(value) : null;
  const ordinary = (peer, id, self) => {
    if (!peer || !peer.pFlags || typeof peer.pFlags !== 'object' || peer.id !== Math.abs(id) || id === self
        || [777000, 489000, 1271266957, 2666000].includes(id)) return false;
    const flags = peer.pFlags;
    if (['self', 'deleted', 'min', 'left', 'deactivated', 'broadcast', 'forum', 'monoforum',
      'gigagroup', 'slowmode_enabled', 'bot_forum_view', 'bot_forum_can_manage_topics'].some((key) => flags[key])) return false;
    if (peer.migrated_to || peer.send_paid_messages_stars) return false;
    return id > 0 ? peer._ === 'user' : peer._ === 'chat' || (peer._ === 'channel' && flags.megagroup === true);
  };
  let epoch = 0;
  let previous = null;
  let watching = null;
  let disposed = false;
  const events = ['user_auth', 'account_switched', 'logging_out', 'state_cleared'];
  const invalidate = () => { epoch += 1; previous = null; };
  function locationValid() {
    try {
      const url = new URL(location.href);
      return url.protocol === 'https:' && url.hostname === 'web.telegram.org' && /^\/k\/?$/.test(url.pathname)
        && (!url.port || url.port === '443') && !url.username && !url.password && !url.search && window.top === window;
    } catch { return false; }
  }
  function capture() {
    const root = window.rootScope;
    const proxy = window.apiManagerProxy;
    const factory = window.createProxiedManagersForAccount;
    const self = root?.myId;
    const account = proxy?.getTabState?.()?.accountNumber;
    if (disposed || !locationValid() || !Number.isSafeInteger(self) || self <= 0
        || !Number.isInteger(account) || account < 1 || account > 100
        || typeof factory !== 'function' || typeof proxy?.getPeer !== 'function'
        || typeof proxy?.invokeVoid !== 'function' || typeof proxy?.getMessageFromStorage !== 'function'
        || typeof root?.addEventListener !== 'function' || typeof root?.removeEventListener !== 'function') {
      throw issue('ACCOUNT_UNAVAILABLE');
    }
    if (watching !== root) {
      for (const name of events) watching?.removeEventListener(name, invalidate);
      watching = root;
      for (const name of events) root.addEventListener(name, invalidate);
      invalidate();
    }
    if (previous && previous.root === root && previous.proxy === proxy && previous.self === self
        && previous.account === account && previous.factory === factory && previous.epoch === epoch) return previous;
    const frozen = { root, proxy, self, account, factory, epoch, managers: factory(account) };
    frozen.current = () => !disposed && locationValid() && epoch === frozen.epoch
      && window.rootScope === root && root.myId === self && window.apiManagerProxy === proxy
      && window.createProxiedManagersForAccount === factory && proxy.getTabState?.()?.accountNumber === account;
    previous = frozen;
    return frozen;
  }
  function check(snapshot, valid) {
    if (!snapshot.current()) throw issue('ACCOUNT_UNAVAILABLE');
    if (typeof valid !== 'function' || !valid()) throw issue('CANCELLED');
  }
  function readPeer(snapshot, id) {
    const peer = snapshot.proxy.getPeer(id);
    if (!ordinary(peer, id, snapshot.self)) throw issue('CAPABILITY_UNAVAILABLE');
    return peer;
  }
  function textValid(text, limit = 4096) {
    return typeof text === 'string' && text.trim().length > 0 && text.length <= limit
      && new TextEncoder().encode(text).length <= 32768 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
  }
  async function wait(operation, snapshot, valid, deadline) {
    check(snapshot, valid);
    const settled = Promise.resolve().then(operation).then((value) => ({ value }), () => ({ failed: true }));
    while (true) {
      check(snapshot, valid);
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw issue('TIMED_OUT');
      let timer;
      const result = await Promise.race([settled, new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), Math.min(50, remaining));
      })]);
      clearTimeout(timer);
      if (result !== null) {
        check(snapshot, valid);
        if (result.failed) throw issue('RUNTIME_FAILED');
        return result.value;
      }
    }
  }
  async function verify(snapshot, id, text, valid, deadline = performance.now() + 12000) {
    check(snapshot, valid);
    readPeer(snapshot, id);
    const managers = snapshot.managers;
    const call = (operation) => wait(operation, snapshot, valid, deadline);
    const config = await call(() => managers.apiManager.getConfig());
    check(snapshot, valid);
    if (!Number.isInteger(config?.message_length_max) || config.message_length_max < 1
        || !textValid(text, Math.min(4096, config.message_length_max))) throw issue('CAPABILITY_UNAVAILABLE');
    const migrated = await call(() => managers.appPeersManager.getPeerMigratedTo(id));
    check(snapshot, valid);
    if (migrated) throw issue('TARGET_CHANGED');
    if (await call(() => managers.appPeersManager.isBotforum(id)) !== false) throw issue('CAPABILITY_UNAVAILABLE');
    check(snapshot, valid);
    if (await call(() => managers.appMessagesManager.canSendToPeer(id, undefined, 'send_plain')) !== true) {
      throw issue('CAPABILITY_UNAVAILABLE');
    }
    check(snapshot, valid);
    if (id > 0) {
      const requirement = await call(() => managers.appUsersManager.getRequirementToContact(id));
      check(snapshot, valid);
      if (requirement?._ !== 'requirementToContactEmpty') throw issue('CAPABILITY_UNAVAILABLE');
    } else {
      const stars = await call(() => managers.appPeersManager.getStarsAmount(id));
      check(snapshot, valid);
      if (stars !== undefined && stars !== 0) throw issue('CAPABILITY_UNAVAILABLE');
    }
    readPeer(snapshot, id);
    const inputPeer = await call(() => managers.appPeersManager.getInputPeerById(id));
    check(snapshot, valid);
    const peer = readPeer(snapshot, id);
    const key = id > 0 ? 'user_id' : peer._ === 'chat' ? 'chat_id' : 'channel_id';
    const type = id > 0 ? 'inputPeerUser' : peer._ === 'chat' ? 'inputPeerChat' : 'inputPeerChannel';
    if (inputPeer?._ !== type || inputPeer[key] !== Math.abs(id)
        || (type !== 'inputPeerChat' && !/^-?\d{1,20}$/.test(String(inputPeer.access_hash)))) {
      throw issue('CAPABILITY_UNAVAILABLE');
    }
    return inputPeer;
  }
  async function prepare(chatId, text, valid = () => true) {
    try {
      const id = peerNumber(chatId);
      if (id === null || !textValid(text)) throw issue('CAPABILITY_UNAVAILABLE');
      const snapshot = capture();
      await verify(snapshot, id, text, valid);
      return { snapshot, id, text, used: false };
    } catch (error) {
      // This entire phase is read-only. Do not accept a platform error's
      // claimed submission flag or expose its arbitrary error text/code.
      throw notSubmittedErrors.has(error) ? error : issue('RUNTIME_FAILED');
    }
  }
  async function send(prepared, valid) {
    if (!prepared || prepared.used) throw issue('NOT_SUBMITTED');
    prepared.used = true;
    const { snapshot, id, text } = prepared;
    let staged = false;
    let submitted = false;
    let message = null;
    let receipt = null;
    try {
      const deadline = performance.now() + 12000;
      const inputPeer = await verify(snapshot, id, text, valid, deadline);
      message = await wait(() => snapshot.managers.appMessagesManager.generateOutgoingMessage(id, {}), snapshot, valid, deadline);
      check(snapshot, valid);
      if (!validTelegramPending(message, id, snapshot.self)) throw issue('CAPABILITY_UNAVAILABLE');
      // generateOutgoingMessage's send/promise properties are non-enumerable.
      // Only this explicit plain template crosses back to the worker: no send
      // closure exists for Telegram's pending/retry UI to invoke automatically.
      message = { _: 'message', id: message.id, random_id: message.random_id, date: message.date,
        from_id: { _: 'peerUser', user_id: snapshot.self }, peer_id: { ...message.peer_id },
        pFlags: { out: true }, pending: true, message: text, entities: [] };
      receipt = createTelegramSendReceipt(snapshot, message, id, text, () => {
        check(snapshot, valid);
      });
      check(snapshot, valid);
      staged = true;
      // beforeMessageSending returns the whole storage Map; invokeVoid avoids
      // cloning chat history. Exact history_append below acknowledges staging,
      // never delivery. clearDraft is deliberately false for later composer CAS.
      snapshot.proxy.invokeVoid('manager', { name: 'appMessagesManager', method: 'beforeMessageSending',
        args: [message, { sequential: true, clearDraft: false }], accountNumber: snapshot.account });
      await receipt.pending();
      check(snapshot, valid);
      readPeer(snapshot, id);
      submitted = true;
      const work = snapshot.managers.apiManager.invokeApiAfter('messages.sendMessage', {
        peer: inputPeer, message: text, random_id: message.random_id, entities: [],
        no_webpage: true, clear_draft: false,
      }, { noErrorBox: true, rawError: true, ignoreErrors: true });
      Promise.resolve(work).then((updates) => applyTelegramSendUpdates(snapshot.managers, message, updates))
        .catch(() => receipt.failed());
      return await receipt.confirmed();
    } catch (error) {
      if (staged && !submitted && message) {
        // The bound account owns this temp ID even after a tab account switch.
        try { Promise.resolve(snapshot.managers.appMessagesManager.cancelPendingMessage(message.random_id)).catch(() => {}); } catch {}
      }
      throw issue(error?.code || 'RUNTIME_FAILED', submitted);
    } finally { receipt?.dispose(); }
  }
  return { capture, ordinary, peerNumber, textValid, readPeer, check, wait, prepare, send, issue,
    notSubmitted: (error) => notSubmittedErrors.has(error),
    dispose() {
      disposed = true;
      for (const name of events) watching?.removeEventListener(name, invalidate);
      previous = null; watching = null;
    } };
}
