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
  function captionValid(text, limit = 1024) {
    return typeof text === 'string' && text.length <= limit
      && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
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
  async function verify(snapshot, id, text, valid, deadline = performance.now() + 12000, kinds = null) {
    check(snapshot, valid);
    readPeer(snapshot, id);
    const managers = snapshot.managers;
    const call = (operation) => wait(operation, snapshot, valid, deadline);
    const rights = { image: 'send_photos', video: 'send_videos', document: 'send_docs' };
    if (kinds !== null) {
      if (!Array.isArray(kinds) || !kinds.length || kinds.length > 3 || kinds.some((kind) => !Object.hasOwn(rights, kind))) {
        throw issue('CAPABILITY_UNAVAILABLE');
      }
      const limit = await call(() => managers.apiManager.getLimit('caption'));
      if (!Number.isSafeInteger(limit) || limit < 1 || !captionValid(text, Math.min(1024, limit))) {
        throw issue('CAPABILITY_UNAVAILABLE');
      }
    } else {
      const config = await call(() => managers.apiManager.getConfig());
      if (!Number.isInteger(config?.message_length_max) || config.message_length_max < 1
          || !textValid(text, Math.min(4096, config.message_length_max))) throw issue('CAPABILITY_UNAVAILABLE');
    }
    check(snapshot, valid);
    const migrated = await call(() => managers.appPeersManager.getPeerMigratedTo(id));
    check(snapshot, valid);
    if (migrated) throw issue('TARGET_CHANGED');
    if (await call(() => managers.appPeersManager.isBotforum(id)) !== false) throw issue('CAPABILITY_UNAVAILABLE');
    check(snapshot, valid);
    for (const action of kinds === null ? ['send_plain'] : [...new Set(kinds.map((kind) => rights[kind]))]) {
      if (await call(() => managers.appMessagesManager.canSendToPeer(id, undefined, action)) !== true) {
        throw issue('CAPABILITY_UNAVAILABLE');
      }
      check(snapshot, valid);
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
  async function verifyReply(snapshot, id, reply, valid, deadline) {
    if (reply === null) return null;
    check(snapshot, valid);
    if (reply.snapshot !== snapshot || reply.peerId !== id || !Number.isSafeInteger(reply.mid) || reply.mid <= 0
        || !Number.isInteger(reply.id) || reply.id <= 0 || reply.id > 2147483647
        || snapshot.proxy.getMessageFromStorage(`${id}_history`, reply.mid) !== reply.model
        || reply.model?.id !== reply.id || reply.model?.mid !== reply.mid || reply.model?.peerId !== id) {
      throw issue('CAPABILITY_UNAVAILABLE');
    }
    // K's ChatInput draft contains its local mid. The read-only official helper
    // converts it to a server int and rejects ephemeral/unsupported identities.
    const value = await wait(() => snapshot.managers.appMessagesManager.getInputReplyTo({
      peerId: id, replyToMsgId: reply.mid,
    }), snapshot, valid, deadline);
    if (value?._ !== 'inputReplyToMessage' || value.reply_to_msg_id !== reply.id
        || Object.keys(value).some((key) => !['_', 'reply_to_msg_id', 'monoforum_peer_id',
          'reply_to_peer_id', 'top_msg_id', 'poll_option'].includes(key)
          || !['_', 'reply_to_msg_id'].includes(key) && value[key] !== undefined)) throw issue('CAPABILITY_UNAVAILABLE');
    check(snapshot, valid);
    return { _: 'inputReplyToMessage', reply_to_msg_id: reply.id };
  }
  function mentionEntities(text, entities) {
    if (!Array.isArray(entities) || entities.length > 32) throw issue('CAPABILITY_UNAVAILABLE');
    return entities.map((entity) => {
      if (entity?._ !== 'messageEntityMention' || !Number.isInteger(entity.offset) || entity.offset < 0
          || !Number.isInteger(entity.length) || entity.length < 2 || entity.length > 33
          || entity.offset + entity.length > text.length) throw issue('CAPABILITY_UNAVAILABLE');
      const token = text.slice(entity.offset, entity.offset + entity.length);
      if (!/^@[\p{L}\p{N}_]{1,32}$/u.test(token)) throw issue('CAPABILITY_UNAVAILABLE');
      if (entity.offset > 0 && !/\s/.test(text[entity.offset - 1])) throw issue('CAPABILITY_UNAVAILABLE');
      return { _: 'messageEntityMention', offset: entity.offset, length: entity.length };
    });
  }
  async function prepare(chatId, text, valid = () => true, reply = null, options = null) {
    try {
      const id = peerNumber(chatId);
      if (id === null || !textValid(text)) throw issue('CAPABILITY_UNAVAILABLE');
      const snapshot = capture();
      const deadline = performance.now() + 12000;
      await verify(snapshot, id, text, valid, deadline);
      await verifyReply(snapshot, id, reply, valid, deadline);
      const noWebpage = !options || options.noWebpage !== false;
      const entities = mentionEntities(text, options?.entities || []);
      return { snapshot, id, text, reply, used: false, noWebpage, entities };
    } catch (error) {
      // This entire phase is read-only. Do not accept a platform error's
      // claimed submission flag or expose its arbitrary error text/code.
      throw notSubmittedErrors.has(error) ? error : issue('RUNTIME_FAILED');
    }
  }
  async function prepareAttachments(chatId, text, kinds, valid = () => true) {
    try {
      const id = peerNumber(chatId);
      if (id === null || !captionValid(text)) throw issue('CAPABILITY_UNAVAILABLE');
      const snapshot = capture();
      await verify(snapshot, id, text, valid, performance.now() + 12000, kinds);
      return { snapshot, id, text };
    } catch (error) {
      throw notSubmittedErrors.has(error) ? error : issue('RUNTIME_FAILED');
    }
  }
  const verifyAttachment = (prepared, kind, text, valid, deadline) =>
    verify(prepared.snapshot, prepared.id, text, valid, deadline, [kind]);
  async function send(prepared, valid) {
    if (!prepared || prepared.used) throw issue('NOT_SUBMITTED');
    prepared.used = true;
    const { snapshot, id, text, reply = null, noWebpage = true, entities = [] } = prepared;
    let staged = false;
    let submitted = false;
    let message = null;
    let receipt = null;
    try {
      const deadline = performance.now() + 12000;
      const inputPeer = await verify(snapshot, id, text, valid, deadline);
      const inputReply = await verifyReply(snapshot, id, reply, valid, deadline);
      message = await wait(() => snapshot.managers.appMessagesManager.generateOutgoingMessage(id,
        inputReply ? { replyTo: inputReply } : {}), snapshot, valid, deadline);
      check(snapshot, valid);
      const replyMid = reply?.mid ?? null;
      if (!validTelegramPending(message, id, snapshot.self, replyMid)) throw issue('CAPABILITY_UNAVAILABLE');
      // generateOutgoingMessage's send/promise properties are non-enumerable.
      // Only this explicit plain template crosses back to the worker: no send
      // closure exists for Telegram's pending/retry UI to invoke automatically.
      message = { _: 'message', id: message.id, random_id: message.random_id, date: message.date,
        from_id: { _: 'peerUser', user_id: snapshot.self }, peer_id: { ...message.peer_id },
        pFlags: { out: true }, pending: true, message: text, entities,
        ...(replyMid === null ? {} : { reply_to: { _: 'messageReplyHeader', pFlags: {}, reply_to_msg_id: replyMid } }) };
      receipt = createTelegramSendReceipt(snapshot, message, id, text, () => {
        check(snapshot, valid);
      }, null, replyMid, noWebpage !== true);
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
        peer: inputPeer, message: text, random_id: message.random_id, entities,
        no_webpage: noWebpage !== false, clear_draft: false, ...(inputReply ? { reply_to: inputReply } : {}),
      }, { noErrorBox: true, rawError: true, ignoreErrors: true });
      Promise.resolve(work).then((updates) => applyTelegramSendUpdates(snapshot.managers, message, updates, null, noWebpage !== true))
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
  return { capture, ordinary, peerNumber, textValid, captionValid, readPeer, check, wait, prepare, send, issue,
    prepareAttachments, verifyAttachment,
    notSubmitted: (error) => notSubmittedErrors.has(error),
    dispose() {
      disposed = true;
      for (const name of events) watching?.removeEventListener(name, invalidate);
      previous = null; watching = null;
    } };
}
