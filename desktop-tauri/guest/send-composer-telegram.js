// K's current ChatInput and its DOM/model draft must agree. No synthetic Enter,
// editor mutation before ACK, or inferred reply/mention/attachment state.
function createTelegramSendComposer(changed) {
  const runtime = createTelegramSendRuntime();
  const notSubmittedErrors = new WeakSet();
  const selector = '[contenteditable="true"]';
  // K clickEvent.ts selects mousedown on touch-capable Windows devices. Its
  // environment check is fixed at module initialization, not inferred from UA.
  const touch = 'ontouchstart' in window
    || (typeof window.DocumentTouch === 'function' && document instanceof window.DocumentTouch);
  const visible = (node) => Boolean(node?.isConnected && !node.hidden && node.getClientRects().length);
  const normalize = (value) => String(value || '').replace(/\r\n?/g, '\n').replace(/\u200b/g, '').trim();
  const issue = (code = 'SEND_INTENT_UNSUPPORTED') => runtime.issue(code);
  let previous = null;
  let revision = 1;
  let emitter = null;
  let suppressed = false;
  let disposed = false;
  function advance(reason, trusted = false) {
    if (disposed || suppressed) return;
    if (revision < Number.MAX_SAFE_INTEGER) revision += 1;
    changed({ reason, trusted, revision });
  }
  const peerChanged = () => advance('chat');
  function watch(im) {
    if (emitter === im) return;
    emitter?.removeEventListener('peer_changing', peerChanged);
    emitter = null;
    if (typeof im?.addEventListener !== 'function' || typeof im?.removeEventListener !== 'function') throw issue();
    im.addEventListener('peer_changing', peerChanged); emitter = im;
  }
  function raw() {
    const snapshot = runtime.capture();
    const im = window.appImManager;
    watch(im);
    const chat = im?.chat;
    const input = chat?.input;
    const editor = input?.messageInput;
    const chatId = typeof chat?.peerId === 'number' ? `tg:${chat.peerId}` : '';
    const draft = input?.getCurrentInputAsDraft?.();
    return { snapshot, im, chat, input, editor, chatId, draft,
      text: normalize(editor?.innerText), inputGeneration: input?.inputValueGeneration };
  }
  function synchronize(value) {
    const signature = JSON.stringify(value.draft ? { ...value.draft, date: undefined } : null);
    if (previous && (previous.chat !== value.chat || previous.input !== value.input
        || previous.editor !== value.editor || previous.chatId !== value.chatId || previous.text !== value.text
        || previous.signature !== signature || previous.inputGeneration !== value.inputGeneration
        || previous.snapshot !== value.snapshot)) advance('context');
    previous = { ...value, signature };
    return { ...value, composerRevision: revision };
  }
  function plainTree(editor) {
    for (const child of editor.childNodes) {
      if (child.nodeType === 3) continue;
      if (child.nodeType !== 1 || !['DIV', 'P', 'SPAN', 'BR'].includes(child.tagName)
          || [...child.attributes].some((attr) => !['class', 'dir'].includes(attr.name)) || !plainTree(child)) return false;
    }
    return true;
  }
  function read() {
    const value = synchronize(raw());
    const { snapshot, chat, input, editor, chatId, text, draft } = value;
    const id = runtime.peerNumber(chatId.slice(3));
    const chats = [...document.querySelectorAll('.chat[data-type="chat"]')].filter(visible);
    if (disposed || revision >= Number.MAX_SAFE_INTEGER || id === null || String(location.hash).slice(1) !== chatId.slice(3)
        || chats.length !== 1 || chats[0] !== chat.container || chat.type !== 'chat'
        || chat.threadId || chat.monoforumThreadId || chat.isPreview || chat.isForum || chat.isBotforum
        || chat.isMonoforum || chat.isTemporaryThread || input?.chat !== chat
        || !visible(editor) || input.messageInputField?.input !== editor || !chat.container.contains(editor)
        || editor.getAttribute('contenteditable') !== 'true' || typeof input.clearInput !== 'function') throw issue();
    runtime.readPeer(snapshot, id);
    if (!runtime.textValid(text) || !Number.isSafeInteger(value.inputGeneration) || value.inputGeneration < 0) throw issue('SEND_INTENT_INVALID');
    if (draft?._ !== 'draftMessage' || typeof draft.message !== 'string' || normalize(draft.message) !== text
        || Object.keys(draft).some((key) => !['_', 'date', 'message', 'entities', 'pFlags',
          'reply_to', 'media', 'rich_message', 'effect'].includes(key))
        || (draft.entities !== undefined && (!Array.isArray(draft.entities) || draft.entities.length))
        || !draft.pFlags || Object.keys(draft.pFlags).some((key) => !['no_webpage', 'invert_media'].includes(key))
        || draft.pFlags.invert_media || /(^|\s)@[\p{L}\p{N}_]/u.test(text)
        || draft.reply_to || draft.media || draft.rich_message || draft.effect || !plainTree(editor)
        || input.editMsgId || input.replyToMsgId || input.replyToStoryId || input.replyToQuote || input.replyToPeerId
        || input.replyToMonoforumPeerId || input.replyToPollOption || input.willSendWebPage || input.suggestedPost
        || input.recording || input.ephemeralComposer || input.ephemeralCommandReceiverId || input.sendingMessage
        || input.scheduleDate || input.scheduleRepeatPeriod || input.sendSilent || input.messageInputExpanded
        || (input.sendAsPeerId && input.sendAsPeerId !== snapshot.self) || chat.savedReaction
        || (input.forwarding && Object.keys(input.forwarding).length)) throw issue();
    return { ...value, context: { kind: 'plain' }, quoteModel: null, quoteRegion: null, quoteNodes: [], quoteBody: '', quoteAuthor: '' };
  }
  function matches(record, value) {
    const frozen = record.composerState || record;
    return record.context?.kind === 'plain' && value.context?.kind === 'plain'
      && record.chatId === value.chatId && record.chat === value.chat && record.editor === value.editor
      && record.text === value.text && record.composerRevision === value.composerRevision
      && frozen.input === value.input && frozen.snapshot === value.snapshot && frozen.inputGeneration === value.inputGeneration;
  }
  function clear(record) {
    let value;
    try { value = read(); } catch { return false; }
    if (!matches(record, value)) return false;
    suppressed = true;
    try {
      // clearInput(false, true) changes the model/DOM synchronously, skips its
      // asynchronous getDraft restoration, then schedules normal draft sync.
      Promise.resolve(value.input.clearInput(false, true)).catch(() => {});
      observer.takeRecords();
      const after = raw(); previous = { ...after, signature: JSON.stringify(after.draft || null) };
      return after.chat === value.chat && after.editor === value.editor && !after.text
        && (!after.draft || after.draft.message === '');
    } catch { return false; }
    finally { suppressed = false; }
  }
  async function submit(record, text, valid) {
    const current = () => {
      if (disposed || !valid()) return false;
      try { return matches(record, read()); } catch { return false; }
    };
    try {
      if (!current()) throw issue('SEND_INTENT_CHANGED');
      const prepared = await runtime.prepare(record.chatId.slice(3), text, current);
      return await runtime.send(prepared, current);
    } catch (error) {
      // Only this runtime's private proof of zero API invocations can release
      // the shared owner's uncertain state. A boolean on an error is not proof.
      if (runtime.notSubmitted(error)) notSubmittedErrors.add(error);
      throw error;
    }
  }
  function submission(event) {
    let value;
    try { value = raw(); } catch { return { matches: false, supported: false }; }
    const popup = [...document.querySelectorAll('.popup.active, [role="dialog"]')].some(visible);
    if (event.type === 'click' || (touch && event.type === 'mousedown')) {
      // The pointer click following K's primary mousedown is not a second send.
      // A native keyboard/assistive click has detail 0 and remains a gesture.
      if (touch && event.type === 'click' && event.detail > 0) return { matches: false, supported: false };
      const button = value.input?.btnSend;
      const hit = button && (event.target === button || button.contains(event.target));
      return { matches: Boolean(hit), supported: Boolean(hit && visible(button) && !button.disabled
        && button.classList.contains('send') && value.input.sendBtnIcon === 'send' && !popup
        && (event.type !== 'mousedown' || event.button === 0)
        && (!touch || event.type !== 'click' || event.detail === 0)) };
    }
    if (event.type !== 'keydown' || event.key !== 'Enter' || event.isComposing
        || !(event.target === value.editor || value.editor?.contains(event.target))) return { matches: false, supported: false };
    // K's autocomplete owns Enter while a real helper is visible. Let its
    // original selection handler run; this is not a send gesture.
    const helpers = value.input?.autocompleteHelperController?.helpers;
    if (helpers && Number.isInteger(helpers.size) && helpers.size <= 20 && typeof helpers.values === 'function'
        && [...helpers.values()].some((helper) => helper.hidden === false && visible(helper.container)
          && typeof helper.detach === 'function')) {
      return { matches: false, supported: false };
    }
    let shortcut;
    try { shortcut = window.useAppSettings?.()?.[0]?.sendShortcut; } catch {}
    const send = shortcut === 'enter' ? !event.shiftKey && !event.ctrlKey && !event.metaKey
      : shortcut === 'ctrlEnter' ? event.ctrlKey && !event.shiftKey && !event.metaKey : null;
    return { matches: send === null || send, supported: send === true && !event.altKey && !popup };
  }
  const inputEvent = (event) => {
    if (event.isTrusted !== true) return;
    const editor = window.appImManager?.chat?.input?.messageInput;
    if (event.target !== editor && !editor?.contains(event.target)) return;
    advance(event.type, true);
    if (event.type === 'input') { try { synchronize(raw()); } catch {} }
  };
  const observer = new MutationObserver((records) => {
    if (!previous?.editor || suppressed) return;
    const scope = previous.input?.chatInput || previous.editor;
    if (records.some((record) => scope.contains(record.target)
        || [...record.addedNodes || [], ...record.removedNodes || []].some((node) => node === scope || node.contains?.(scope)))) advance('node');
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['contenteditable', 'class', 'hidden', 'data-peer-id', 'data-type'] });
  document.addEventListener('beforeinput', inputEvent, true);
  document.addEventListener('input', inputEvent, true);
  window.addEventListener('hashchange', peerChanged);
  return { selector, read, matches, clear, submit, submission,
    notSubmitted: (error) => notSubmittedErrors.has(error),
    currentChat: () => { try { return synchronize(raw()).chatId || null; } catch { return null; } },
    rawText: () => { try { return raw().text; } catch { return ''; } },
    get revision() { return revision; },
    dispose() {
      disposed = true; observer.disconnect(); runtime.dispose(); emitter?.removeEventListener('peer_changing', peerChanged);
      document.removeEventListener('beforeinput', inputEvent, true); document.removeEventListener('input', inputEvent, true);
      window.removeEventListener('hashchange', peerChanged);
    } };
}
