// Broadcast adapter only; the existing Rust owner schedules and checkpoints it.
function createTelegramKAdapter() {
  const runtime = createTelegramSendRuntime();
  const attachments = createTelegramAttachmentRuntime(runtime);
  let owner = null;
  function captureOwner() {
    // The native catalog/job generation cannot see K's internal account picker.
    // Freeze its platform identity for this whole bridge document, including
    // the gap between catalog creation and the first target preparation.
    owner ||= runtime.capture();
    if (!owner.current()) throw runtime.issue('ACCOUNT_UNAVAILABLE');
    return owner;
  }
  const audiences = createTelegramAudience({ runtime, captureOwner });
  const clean = (value) => typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 256) : '';
  function capabilities() {
    let text = false;
    try { text = captureOwner().current(); } catch {}
    return { text, scheduled: text, attachments: text, tagAll: false,
      groupMembers: text && audiences.groupMembersAvailable(), vcards: false };
  }
  async function ready() {
    const deadline = performance.now() + 12000;
    do {
      if (owner) { captureOwner(); return; }
      try { captureOwner(); return; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (performance.now() < deadline);
    throw runtime.issue('ACCOUNT_UNAVAILABLE');
  }
  async function listChats() {
    await ready();
    const snapshot = captureOwner();
    const result = [];
    const seen = new Set();
    const deadline = performance.now() + 12000;
    // These are the platform's real cached main/archive dialogs, not arbitrary
    // DOM rows or an assumed sign on a channel ID. No chat is opened/focused.
    let total = 0;
    for (const folderId of [0, 1]) {
      const dialogs = await runtime.wait(() => snapshot.managers.dialogsStorage.getFolderDialogs(folderId), snapshot, () => true, deadline);
      runtime.check(snapshot, () => true);
      if (!Array.isArray(dialogs) || (total += dialogs.length) > 20000) throw runtime.issue('CAPABILITY_UNAVAILABLE');
      for (const dialog of dialogs) {
        const id = runtime.peerNumber(String(dialog?.peerId ?? ''));
        if (id === null || seen.has(id) || dialog?._ !== 'dialog' || dialog.migratedTo) continue;
        const peer = snapshot.proxy.getPeer(id);
        if (!runtime.ordinary(peer, id, snapshot.self)) continue;
        seen.add(id);
        const name = id > 0 ? clean([peer.first_name, peer.last_name].filter((value) => typeof value === 'string').join(' ')) : clean(peer.title);
        result.push({ id: `tg:${id}`, name, realName: name, kind: id > 0 ? 'contact' : 'group' });
      }
    }
    return result;
  }
  function authorize(chatId) {
    const snapshot = captureOwner();
    const id = typeof chatId === 'string' && chatId.startsWith('tg:') ? runtime.peerNumber(chatId.slice(3)) : null;
    if (id === null) throw runtime.issue('TARGET_CHANGED');
    runtime.readPeer(snapshot, id);
    const guard = GeekBroadcastSafety.authorizeSend({ opened: true, currentChatId: `tg:${id}`,
      targetChatId: chatId, needsComposer: false });
    if (!guard.ok) throw runtime.issue('TARGET_CHANGED');
  }
  async function prepare(request) {
    if (!request || typeof request.targetId !== 'string' || request.tagAll !== false
        || !Array.isArray(request.vcards) || request.vcards.length
        || (request.attachments !== undefined && !Array.isArray(request.attachments))) {
      throw runtime.issue('CAPABILITY_UNAVAILABLE');
    }
    const files = request.attachments || [];
    if (files.length) attachments.validate(files, request.message);
    else if (!runtime.textValid(request.message)) throw runtime.issue('CAPABILITY_UNAVAILABLE');
    authorize(request.targetId);
    const frozen = { targetId: request.targetId, message: request.message, tagAll: false, vcards: [],
      attachments: files.map(({ id, name, size, mime, kind }) => ({ id, name, size, mime, kind })) };
    const ticket = files.length ? await attachments.prepare(frozen)
      : await runtime.prepare(request.targetId.slice(3), request.message);
    return { request: frozen, ticket };
  }
  async function dispatch(prepared, valid, attachmentReceipt = '') {
    try {
      if (!valid()) throw runtime.issue('CANCELLED');
      authorize(prepared?.request?.targetId);
      if (prepared?.request?.attachments.length) {
        return { status: 'confirmed', receipt: attachments.complete(prepared.ticket, attachmentReceipt) };
      }
      const result = await runtime.send(prepared.ticket, valid);
      return { status: 'confirmed', receipt: result.id };
    } catch (error) {
      return { status: !attachmentReceipt && runtime.notSubmitted(error) ? 'notSubmitted' : 'uncertain',
        code: error?.code || 'RUNTIME_FAILED' };
    }
  }
  async function dispatchAttachment(prepared, file, index, valid) {
    try {
      if (!valid()) throw runtime.issue('CANCELLED');
      authorize(prepared?.request?.targetId);
      const result = await attachments.send(prepared?.ticket, file, index, valid);
      return { status: 'confirmed', receipt: result.id };
    } catch (error) {
      return { status: index === 0 && runtime.notSubmitted(error) ? 'notSubmitted' : 'uncertain',
        code: error?.code || 'RUNTIME_FAILED' };
    }
  }
  const unavailable = () => { throw runtime.issue('CAPABILITY_UNAVAILABLE'); };
  return { capabilities, ready, listChats, prepare, dispatch,
    audienceOptions: async () => null, groupMembers: audiences.groupMembers, labelMembers: unavailable,
    resolveContacts: audiences.resolveContacts, dispatchAttachment, openChat: unavailable,
    setComposerText: unavailable, sendText: dispatch, getCurrentChat: () => {
      const id = runtime.peerNumber(location.hash.slice(1));
      return id === null ? '' : `tg:${id}`;
    } };
}
