// This code is bundled inside the native platform closure, never the shell.
// The existing transport registry selects the adapter; Rust alone owns jobs.
function createWhatsAppAdapter() {
  const identity = (value) => String(value?._serialized || value?.id?._serialized || value?.id || value || '');
  const issue = (code) => Object.assign(new Error(code), { code });
  const userId = (id) => /^[0-9]{1,30}@(c\.us|lid)$/.test(id);
  const groupId = (id) => /^[0-9]{1,30}(?:-[0-9]{1,20})?@g\.us$/.test(id);
  const supported = (chat, id) => Boolean(chat && (userId(id) || groupId(id))
    && chat.isGroup === groupId(id) && !chat.isNewsletter && !chat.isBroadcast
    && !chat.isParentGroup && !chat.groupMetadata?.isParentGroup);
  const runtime = () => {
    const W = window.WPP;
    if (W?.isInjected !== true || W?.isReady !== true
        || typeof W?.loader?.moduleRequire !== 'function'
        || typeof W?.whatsapp?._moduleIdMap?.get !== 'function') throw issue('ACCOUNT_UNAVAILABLE');
    return W;
  };
  const requireMethods = (W, paths) => {
    if (paths.some((path) => typeof path.split('.').reduce((value, key) => value?.[key], W) !== 'function')) {
      throw issue('CAPABILITY_UNAVAILABLE');
    }
  };

  function capabilities() {
    const W = runtime();
    const text = typeof W.chat?.sendTextMessage === 'function' && typeof W.chat?.get === 'function';
    return { text, scheduled: text, attachments: false,
      tagAll: text && typeof W.group?.getParticipants === 'function',
      vcards: typeof W.chat?.sendVCardContactMessage === 'function'
        && typeof W.contact?.getPnLidEntry === 'function' };
  }

  async function ready() {
    const deadline = performance.now() + 12000;
    let ready = false;
    while (performance.now() < deadline) {
      try {
        const W = runtime();
        requireMethods(W, ['conn.isMainReady', 'chat.list', 'chat.get']);
        ready = await W.conn.isMainReady() === true;
      } catch { ready = false; }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) throw issue('ACCOUNT_UNAVAILABLE');
  }

  async function listChats() {
    await ready();
    // The canonical list transport uses this capability selector. Only the
    // pinned primary WA-JS runtime is admitted, never the old fork fallback.
    window.__geekPickWpp = () => runtime();
    let chats;
    try { chats = JSON.parse(await readCanonicalChats()); }
    catch { throw issue('ACCOUNT_UNAVAILABLE'); }
    if (!Array.isArray(chats) || chats.length > 20000) throw issue('CAPABILITY_UNAVAILABLE');
    return chats.filter((chat) => supported(runtime().chat.get(chat.id), String(chat.id))).map((chat) => ({ id: String(chat.id),
      name: chat.name === chat.id ? '' : String(chat.name || '').slice(0, 256),
      realName: String(chat.realName || '').slice(0, 256), kind: chat.type === '群组' ? 'group' : 'contact' }));
  }

  async function prepare(request) {
    const W = runtime();
    requireMethods(W, ['conn.isMainReady', 'chat.get']);
    if (await W.conn.isMainReady() !== true) throw issue('ACCOUNT_UNAVAILABLE');
    const chat = W.chat.get(request.targetId);
    if (!supported(chat, request.targetId)) throw issue('CAPABILITY_UNAVAILABLE');
    const guard = GeekBroadcastSafety.authorizeSend({ opened: !!chat,
      currentChatId: identity(chat?.id), targetChatId: request.targetId, needsComposer: false });
    if (!guard.ok) throw issue('TARGET_CHANGED');
    const options = { waitForAck: true };
    if (request.message.trim()) requireMethods(W, ['chat.sendTextMessage']);
    if (request.tagAll && !request.message.trim()) throw issue('CAPABILITY_UNAVAILABLE');
    if (request.tagAll && chat.isGroup) {
      requireMethods(W, ['group.getParticipants']);
      const members = await W.group.getParticipants(request.targetId);
      const ids = Array.isArray(members) ? members.map((member) => identity(member?.id)) : [];
      if (!ids.length || ids.length > 10000 || ids.some((id) => !userId(id))) throw issue('CAPABILITY_UNAVAILABLE');
      options.mentionedList = ids;
    }
    const vcards = [];
    if (request.vcards.length) {
      requireMethods(W, ['chat.sendVCardContactMessage', 'contact.getPnLidEntry']);
      for (const card of request.vcards) {
        let id = card.id;
        if (!userId(id)) throw issue('CAPABILITY_UNAVAILABLE');
        if (id.endsWith('@lid')) {
          const pair = await W.contact.getPnLidEntry(id);
          id = identity(pair?.phoneNumber);
          if (!userId(id) || !id.endsWith('@c.us')) throw issue('CAPABILITY_UNAVAILABLE');
        }
        vcards.push({ id, name: card.name });
      }
    }
    return { request, options, vcards };
  }

  async function dispatch(prepared, valid) {
    let submitted = false;
    const receipts = [];
    const confirmed = (result) => {
      const id = typeof result?.id === 'string' ? result.id : '';
      // A real platform ID and acknowledged submission are required. A click,
      // synthetic 'submitted' ID, empty result or elapsed timer is not success.
      if (!id || id === 'submitted' || id.length > 500 || /[\u0000-\u001f]/.test(id)
          || !Number.isFinite(result.ack) || result.ack < 1) {
        throw issue('RECEIPT_MISSING');
      }
      receipts.push(id);
    };
    try {
      const W = runtime();
      const { request, options, vcards } = prepared;
      if (!valid()) throw issue('CANCELLED');
      const chat = W.chat.get(request.targetId);
      if (!supported(chat, request.targetId)) throw issue('CAPABILITY_UNAVAILABLE');
      const guard = GeekBroadcastSafety.authorizeSend({ opened: !!chat,
        currentChatId: identity(chat?.id), targetChatId: request.targetId, needsComposer: false });
      if (!guard.ok) throw issue('TARGET_CHANGED');
      if (request.message.trim()) {
        submitted = true;
        confirmed(await W.chat.sendTextMessage(request.targetId, request.message, options));
      }
      if (vcards.length) {
        if (!valid()) throw issue('CANCELLED');
        submitted = true;
        confirmed(await W.chat.sendVCardContactMessage(request.targetId, vcards, { waitForAck: true }));
      }
      if (!receipts.length) throw issue('NOT_SUBMITTED');
      if (!valid()) throw issue('CANCELLED');
      return { status: 'confirmed', receipt: receipts.join('|') };
    } catch (error) {
      return { status: submitted ? 'uncertain' : 'notSubmitted', code: error.code || 'RUNTIME_FAILED' };
    }
  }

  return { capabilities, ready, listChats, prepare, dispatch,
    getCurrentChat: () => identity(runtime().chat?.getActiveChat?.()?.id),
    openChat: () => { throw issue('CAPABILITY_UNAVAILABLE'); },
    setComposerText: () => { throw issue('CAPABILITY_UNAVAILABLE'); },
    sendText: dispatch };
}
