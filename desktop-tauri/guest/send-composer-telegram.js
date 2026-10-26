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
  const reply = createTelegramReplyContext(runtime, advance);
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
  function walk(root) {
    const nodes = [];
    const visit = (node) => {
      if (!node || node.nodeType !== 1 || nodes.length > 400) return;
      nodes.push(node);
      for (const child of node.childNodes || []) visit(child);
    };
    visit(root);
    return nodes;
  }
  function findPopup() {
    const popups = [...document.querySelectorAll('.popup.active, [role="dialog"]')].filter(visible);
    if (popups.length !== 1) return null;
    const nodes = walk(popups[0]);
    const editors = nodes.filter((node) => node.getAttribute?.('contenteditable') === 'true' && visible(node));
    const buttons = nodes.filter((node) => node.tagName === 'BUTTON' && visible(node) && node.classList?.contains('send'));
    if (editors.length !== 1 || buttons.length !== 1) return null;
    const previews = nodes.filter((node) => ['IMG', 'VIDEO'].includes(node.tagName) && visible(node)
      && !editors[0].contains(node)).length;
    if (previews > 10) return null;
    return { editor: editors[0], button: buttons[0], previews };
  }
  function mentionTokens(text, entities) {
    const found = [];
    for (const match of text.matchAll(/(^|\s)(@[\p{L}\p{N}_]{1,32})/gu)) {
      found.push({ token: match[2], offset: match.index + match[1].length, length: match[2].length });
    }
    if (found.length > 32) throw issue();
    if (entities !== undefined && !Array.isArray(entities)) throw issue();
    const list = entities || [];
    if (!found.length) { if (list.length) throw issue(); return []; }
    if (list.length !== found.length) throw issue();
    return found.map((item, index) => {
      const entity = list[index];
      if (entity?._ !== 'messageEntityMention' || entity.offset !== item.offset || entity.length !== item.length) throw issue();
      return item.token;
    });
  }
  function entitiesFor(text, tokens) {
    const entities = [];
    let from = 0;
    for (const token of tokens) {
      const at = text.indexOf(token, from);
      if (at < 0 || (at > 0 && !/\s/.test(text[at - 1]))) throw issue('SEND_INTENT_CHANGED');
      entities.push({ _: 'messageEntityMention', offset: at, length: token.length });
      from = at + token.length;
    }
    return entities;
  }
  function linkDisabled(input, draft, text) {
    const disabled = draft.pFlags.no_webpage === true;
    const preview = input.willSendWebPage;
    if (disabled) { if (preview) throw issue(); return true; }
    if (preview == null || preview === false) return false;
    const url = preview.url;
    if (typeof url !== 'string' || !/^https:\/\/\S{1,2032}$/.test(url) || !text.includes(url)) throw issue();
    return false;
  }
  function readPopup(value) {
    const popup = findPopup();
    if (!popup) return null;
    const text = normalize(popup.editor.innerText || popup.editor.textContent);
    if (!text || !runtime.captionValid(text) || /(^|\s)@[\p{L}\p{N}_]/u.test(text)) throw issue();
    const id = runtime.peerNumber(value.chatId.slice(3));
    if (id === null) throw issue();
    runtime.readPeer(value.snapshot, id);
    return { ...value, text, editor: popup.editor, popupButton: popup.button, previewCount: popup.previews,
      mentions: [], noWebpage: true, context: Object.freeze({ kind: 'popup-caption' }) };
  }
  function read() {
    const value = synchronize(raw());
    const popup = readPopup(value);
    if (popup) return popup;
    const { snapshot, chat, input, editor, chatId, text, draft } = value;
    const id = runtime.peerNumber(chatId.slice(3));
    const chats = [...document.querySelectorAll('.chat[data-type="chat"]')].filter(visible);
    if (disposed || revision >= Number.MAX_SAFE_INTEGER || id === null || String(location.hash).slice(1) !== chatId.slice(3)
        || chats.length !== 1 || chats[0] !== chat.container || chat.type !== 'chat'
        || [...document.querySelectorAll('.popup.active, [role="dialog"]')].some(visible)
        || chat.threadId || chat.monoforumThreadId || chat.isPreview || chat.isForum || chat.isBotforum
        || chat.isMonoforum || chat.isTemporaryThread || input?.chat !== chat
        || !visible(editor) || input.messageInputField?.input !== editor || !chat.container.contains(editor)
        || editor.getAttribute('contenteditable') !== 'true' || typeof input.clearInput !== 'function') throw issue();
    runtime.readPeer(snapshot, id);
    if (!runtime.textValid(text) || !Number.isSafeInteger(value.inputGeneration) || value.inputGeneration < 0) throw issue('SEND_INTENT_INVALID');
    if (draft?._ !== 'draftMessage' || typeof draft.message !== 'string' || normalize(draft.message) !== text
        || Object.keys(draft).some((key) => !['_', 'date', 'message', 'entities', 'pFlags',
          'reply_to', 'media', 'rich_message', 'effect'].includes(key))
        || !draft.pFlags || Object.keys(draft.pFlags).some((key) => !['no_webpage', 'invert_media'].includes(key))
        || draft.pFlags.invert_media
        || draft.media || draft.rich_message || draft.effect || !plainTree(editor)
        || input.editMsgId || input.replyToStoryId || input.replyToQuote || input.replyToPeerId
        || input.replyToMonoforumPeerId || input.replyToPollOption || input.suggestedPost
        || input.recording || input.ephemeralComposer || input.ephemeralCommandReceiverId || input.sendingMessage
        || input.scheduleDate || input.scheduleRepeatPeriod || input.sendSilent || input.messageInputExpanded
        || (input.sendAsPeerId && input.sendAsPeerId !== snapshot.self) || chat.savedReaction
        || (input.forwarding && Object.keys(input.forwarding).length)) throw issue();
    const mentions = mentionTokens(text, draft.entities);
    const noWebpage = linkDisabled(input, draft, text);
    return { ...value, ...reply.read(value), mentions, noWebpage };
  }
  function matches(record, value) {
    const frozen = record.composerState || record;
    if (record.context?.kind === 'popup-caption' || value.context?.kind === 'popup-caption') {
      return record.context?.kind === value.context?.kind && record.chatId === value.chatId
        && record.editor === value.editor && record.text === value.text
        && record.composerRevision === value.composerRevision && frozen.popupButton === value.popupButton
        && frozen.previewCount === value.previewCount && frozen.snapshot === value.snapshot;
    }
    return reply.matches(record, value) && record.chatId === value.chatId && record.chat === value.chat && record.editor === value.editor
      && record.text === value.text && record.composerRevision === value.composerRevision
      && frozen.input === value.input && frozen.snapshot === value.snapshot && frozen.inputGeneration === value.inputGeneration;
  }
  function clear(record) {
    // Preserve the entire quoted draft; K's helper cleanup also schedules cloud
    // draft writes and has no synchronous text-and-reply CAS contract.
    if (record.context?.kind !== 'plain') return false;
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
  async function submitPopup(record, text) {
    const state = record.composerState || record;
    const button = state.popupButton;
    const editor = record.editor;
    const snapshot = state.snapshot;
    const previewCount = state.previewCount || 0;
    const id = runtime.peerNumber(String(record.chatId || '').slice(3));
    if (typeof button?.click !== 'function' || !editor || !snapshot?.root || id === null) throw issue();
    let result = null;
    const onSent = (event) => {
      const final = event?.message;
      if (result || final?.pFlags?.out !== true || final.peerId !== id || final.message !== text) return;
      if (!Number.isSafeInteger(final.id) || final.id <= 0) return;
      if (previewCount > 1) {
        if (typeof final.grouped_id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(final.grouped_id)) return;
      } else if (final.grouped_id) return;
      result = { id: `tg:${id}:${final.id}`, ack: 1 };
    };
    snapshot.root.addEventListener('message_sent', onSent);
    let clicked = false;
    try {
      suppressed = true;
      editor.innerText = text;
      button.click();
      clicked = true;
      const deadline = performance.now() + 8000;
      while (!result) {
        if (typeof snapshot.current === 'function' && !snapshot.current()) throw runtime.issue('ACCOUNT_UNAVAILABLE', true);
        if (performance.now() >= deadline) throw runtime.issue('TIMED_OUT', true);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return result;
    } catch (error) {
      if (clicked && runtime.notSubmitted(error)) throw runtime.issue('RUNTIME_FAILED', true);
      throw error;
    } finally {
      suppressed = false;
      snapshot.root.removeEventListener('message_sent', onSent);
    }
  }
  function outputValid(text, record) {
    const state = record?.current?.composerState || record?.composerState || record;
    if (state?.context?.kind === 'popup-caption') return runtime.captionValid(text) && Boolean(String(text || '').trim());
    const tokens = state?.mentions || [];
    if (!tokens.length) return true;
    return runtime.textValid(text) && tokens.every((token) => text.split(token).length > 1);
  }
  async function submit(record, text, valid) {
    const state = record.composerState || record;
    if (record.context?.kind === 'popup-caption') {
      if (disposed || !valid()) throw issue('SEND_INTENT_CHANGED');
      try { return await submitPopup(record, text); }
      catch (error) {
        if (runtime.notSubmitted(error)) notSubmittedErrors.add(error);
        throw error;
      }
    }
    const current = () => {
      if (disposed || !valid()) return false;
      try { return matches(record, read()); } catch { return false; }
    };
    try {
      if (!current()) throw issue('SEND_INTENT_CHANGED');
      const prepared = await runtime.prepare(record.chatId.slice(3), text, current, state.telegramReply || null, {
        noWebpage: state.noWebpage === true, entities: entitiesFor(text, state.mentions || []),
      });
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
    const captionPopup = findPopup();
    if (captionPopup && (event.type === 'click' || (touch && event.type === 'mousedown'))) {
      const hit = event.target === captionPopup.button || captionPopup.button.contains?.(event.target);
      const text = normalize(captionPopup.editor.innerText || captionPopup.editor.textContent);
      const usable = Boolean(text) && runtime.captionValid(text) && !/(^|\s)@[\p{L}\p{N}_]/u.test(text);
      return { matches: Boolean(hit && usable), supported: Boolean(hit && usable) };
    }
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
  return { selector, read, matches, clear, submit, submission, outputValid,
    notSubmitted: (error) => notSubmittedErrors.has(error),
    currentChat: () => { try { return synchronize(raw()).chatId || null; } catch { return null; } },
    rawText: () => { try { return raw().text; } catch { return ''; } },
    get revision() { return revision; },
    dispose() {
      disposed = true; observer.disconnect(); reply.dispose(); runtime.dispose(); emitter?.removeEventListener('peer_changing', peerChanged);
      document.removeEventListener('beforeinput', inputEvent, true); document.removeEventListener('input', inputEvent, true);
      window.removeEventListener('hashchange', peerChanged);
    } };
}
