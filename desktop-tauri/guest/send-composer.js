// The pinned WA-JS model, source text and optional typed context must agree.
function createWhatsAppTextComposer(changed) {
  const selector = '#main footer [contenteditable="true"], #main [data-testid="conversation-compose-box-input"], '
    + '#main [contenteditable="true"][data-tab="10"]';
  const allowedTags = new Set(['DIV', 'P', 'SPAN', 'BR']);
  const allowedAttributes = new Set(['class', 'dir', 'style', 'data-lexical-text', 'data-lexical-linebreak']);
  let revision = 1;
  let previous = null;
  let emitter = null;
  let watchedChat = null;
  let watchedQuote = null;
  let unwatchQuote = () => {};
  let watchedMentions = null;
  let unwatchMentions = () => {};
  let suppressed = false;
  let disposed = false;
  const normalize = (value) => String(value || '').replace(/\r\n?/g, '\n').replace(/\u200b/g, '').trim();
  const identity = (chat) => typeof chat?.id === 'string' ? chat.id : chat?.id?._serialized || '';
  const visible = (node) => Boolean(node?.isConnected && node.getClientRects().length && !node.hidden);
  const issue = (code = 'SEND_INTENT_UNSUPPORTED') => Object.assign(new Error(code), { code });
  const mentions = createWhatsAppMentions({ normalize, visible, issue });
  const context = createSendContext({ normalize, visible, issue, mentions });

  function advance(reason, trusted = false) {
    if (suppressed || disposed) return;
    if (revision < Number.MAX_SAFE_INTEGER) revision += 1;
    changed({ reason, trusted, revision });
  }
  const activeChanged = () => advance('chat');
  const quoteChanged = () => advance('quote');
  function watchModels(chat, quote) {
    if (watchedChat !== chat) {
      for (const field of context.fields) watchedChat?.off?.(`change:${field}`, quoteChanged);
      watchedChat = typeof chat?.on === 'function' && typeof chat.off === 'function' ? chat : null;
      for (const field of context.fields) watchedChat?.on(`change:${field}`, quoteChanged);
    }
    if (watchedQuote !== quote) {
      unwatchQuote(); watchedQuote = quote;
      unwatchQuote = context.watchQuote(quote, quoteChanged);
    }
  }
  function watchRuntime() {
    const W = window.WPP;
    if (emitter === W) return;
    emitter?.off?.('chat.active_chat', activeChanged);
    emitter = null;
    if (typeof W?.on !== 'function' || typeof W?.off !== 'function') throw issue();
    W.on('chat.active_chat', activeChanged); emitter = W;
  }
  function raw() {
    const W = window.WPP;
    const chat = W?.chat?.getActiveChat?.() || null;
    const chatId = identity(chat);
    const editors = [...document.querySelectorAll(selector)].filter(visible);
    const editor = editors.length === 1 ? editors[0] : null;
    const text = editor ? normalize(editor.innerText) : '';
    const quoteState = context.state(chat, W);
    watchModels(chat, quoteState.model);
    const value = { W, chat, chatId, editor, text, quoteState, footer: editor?.closest('footer') || null };
    try { value.mentions = mentions.read(value); } catch (error) { value.mentionError = error; }
    if (value.mentions) value.text = value.mentions.text;
    if (watchedMentions && !mentions.matches(watchedMentions, value)) {
      unwatchMentions(); watchedMentions = null; unwatchMentions = () => {};
    }
    if (value.mentions && !watchedMentions) {
      watchedMentions = value.mentions.proof; unwatchMentions = mentions.watch(watchedMentions, quoteChanged);
    }
    return value;
  }
  function synchronize(value) {
    if (previous && (previous.chatId !== value.chatId || previous.chat !== value.chat
        || previous.editor !== value.editor || previous.text !== value.text
        || !context.sameState(previous.quoteState, value.quoteState))) advance('context');
    previous = value;
    return { ...value, composerRevision: revision };
  }
  function plainTree(editor) {
    const visit = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) continue;
        if (child.nodeType !== 1 || !allowedTags.has(child.tagName)
            || [...child.attributes].some((attr) => !allowedAttributes.has(attr.name))) return false;
        if (child.hasAttribute('data-lexical-text') && child.getAttribute('data-lexical-text') !== 'true') return false;
        if (!visit(child)) return false;
      }
      return true;
    };
    return visit(editor);
  }
  function read() {
    const value = synchronize(raw());
    const { W, chat, chatId, editor, footer, text } = value;
    watchRuntime();
    if (disposed || revision >= Number.MAX_SAFE_INTEGER || !editor || !footer || footer.closest('#main') === null
        || W?.isInjected !== true || W?.isReady !== true || chat?.canSend !== true
        || !/^\d[\d-]{0,39}@(c\.us|lid|g\.us)$/.test(chatId)
        || typeof chat.isGroup !== 'boolean' || chat.isGroup !== chatId.endsWith('@g.us')
        || chat.isReadOnly || chat.isNewsletter || chat.isBroadcast || chat.isParentGroup || chat.groupMetadata?.isParentGroup
        || typeof W.chat?.sendTextMessage !== 'function' || typeof chat.getComposeContents !== 'function') throw issue();
    if (!text || text.length > 10000 || new TextEncoder().encode(text).length > 32768
        || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) throw issue('SEND_INTENT_INVALID');
    if (value.mentionError) throw value.mentionError;
    const contents = chat.getComposeContents();
    if (!contents || typeof contents !== 'object' || Array.isArray(contents) || typeof contents.text !== 'string'
        || Object.keys(contents).some((key) => !['text', 'timestamp'].includes(key))
        || !value.mentions && (normalize(contents.text) !== text || !plainTree(editor)
          || /(^|\s)@[\p{L}\p{N}_]/u.test(text))) throw issue();
    return { ...value, ...context.read(value) };
  }
  function currentChat() {
    try { return synchronize(raw()).chatId || null; } catch { return null; }
  }
  function matches(record, value) {
    return value.chatId === record.chatId && value.editor === record.editor && value.chat === record.chat
      && value.text === record.text && value.composerRevision === record.composerRevision && context.matches(record, value)
      && (record.context.kind === 'mentions'
        ? mentions.matches(record.composerState?.mentions?.proof, value) : !value.mentions);
  }
  function clear(record) {
    // Pinned setInputText has no verified quote cleanup contract. A confirmed
    // reply keeps its entire source and quote; it must never clear only the text.
    if (record.context?.kind !== 'plain') return false;
    let value;
    try { value = read(); } catch { return false; }
    if (!matches(record, value) || typeof value.W.chat.setInputText !== 'function') return false;
    // In pinned WA-JS 4.7.1 this no-chatId branch mutates synchronously before
    // returning its Promise. The explicit-chatId branch awaits and is unsafe here.
    suppressed = true;
    try {
      const result = value.W.chat.setInputText('');
      Promise.resolve(result).catch(() => {});
      observer.takeRecords();
      const after = raw();
      previous = after;
      return after.chat === value.chat && after.editor === value.editor && after.text === ''
        && normalize(value.chat.getComposeContents()?.text) === '';
    } catch { return false; }
    finally { suppressed = false; }
  }
  function submission(event) {
    if (event.type === 'keydown') {
      return { matches: event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
        && !event.isComposing && Boolean(event.target?.closest?.(selector)), supported: true };
    }
    if (event.type !== 'click') return { matches: false, supported: false };
    const direct = event.target?.closest?.('[data-icon="send"], [data-testid="compose-btn-send"], [data-testid="send"], '
      + 'button[aria-label="Send"], button[aria-label="发送"]');
    const button = event.target?.closest?.('button, [role="button"]');
    const send = direct || (button?.querySelector('[data-icon="send"]') ? button : null);
    return { matches: Boolean(send), supported: Boolean(send?.closest('#main footer')) };
  }
  function submit(record, text, valid) {
    if (!valid()) throw issue('SEND_INTENT_CHANGED');
    const value = read();
    if (!matches(record, value)) throw issue('SEND_INTENT_CHANGED');
    const options = { waitForAck: true, detectMentioned: false, linkPreview: false };
    if (record.context.kind === 'reply') options.quotedMsg = record.quoteModel;
    if (record.context.kind === 'mentions') Object.assign(options, mentions.submitOptions(record.composerState.mentions.proof));
    return value.W.chat.sendTextMessage(record.chatId, text, options);
  }
  const input = (event) => {
    if (event.isTrusted !== true || !event.target?.closest?.(selector)) return;
    advance(event.type, true);
    if (event.type === 'input') previous = raw();
  };
  const observer = new MutationObserver((records) => {
    if (!previous?.editor || suppressed) return;
    const editor = previous.editor;
    const scope = previous.quoteState.source ? previous.footer : editor;
    if (records.some((record) => scope?.contains(record.target)
        || [...record.addedNodes || [], ...record.removedNodes || []].some((node) => node === editor || node.contains?.(editor)))) {
      advance('node');
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['contenteditable', 'data-testid', 'data-tab', 'data-mention-jid',
      'data-mention-id', 'data-app-text-template', 'role', 'hidden', 'aria-label', 'aria-hidden', 'title', 'src', 'srcset', 'alt'] });
  document.addEventListener('beforeinput', input, true);
  document.addEventListener('input', input, true);
  return { selector, read, currentChat, matches, clear, submission, submit,
    get revision() { return revision; },
    rawText: () => { try { return raw().text; } catch { return ''; } },
    dispose() {
      disposed = true; observer.disconnect(); emitter?.off?.('chat.active_chat', activeChanged); watchModels(null, null);
      unwatchMentions(); watchedMentions = null;
      document.removeEventListener('beforeinput', input, true); document.removeEventListener('input', input, true);
    },
  };
}

// Both composition modes feed the same SendIntent. A visible or model-owned
// attachment cannot fall through to the ordinary text sender.
function createSendComposer(changed) {
  const text = createWhatsAppTextComposer(changed);
  const caption = createWhatsAppCaption(changed);
  const current = () => caption.active() ? caption : text;
  const owner = (record) => record?.context?.kind === 'attachment' ? caption : text;
  return {
    selector: `${text.selector}, ${caption.selector}`,
    read: () => current().read(),
    currentChat: () => current().currentChat(),
    rawText: () => current().rawText(),
    submission(event) {
      const mode = current();
      const result = mode.submission(event);
      if (result.matches || mode === text) return result;
      // An unrecognized attachment preview must also fence an ordinary composer
      // gesture; otherwise its source could fall through to WhatsApp unchanged.
      return { matches: text.submission(event).matches, supported: false };
    },
    matches: (record, value) => owner(record).matches(record, value),
    submit: (record, output, valid) => owner(record).submit(record, output, valid),
    clear: (record) => owner(record).clear(record),
    outputValid: (output, record) => owner(record).outputValid?.(output) !== false,
    get revision() { return current().revision; },
    dispose() { text.dispose(); caption.dispose(); },
  };
}
