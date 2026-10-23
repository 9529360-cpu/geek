// The pinned WA-JS model and a plain composer must agree before paid work or send.
function createSendComposer(changed) {
  const selector = '#main footer [contenteditable="true"], #main [data-testid="conversation-compose-box-input"], '
    + '#main [contenteditable="true"][data-tab="10"]';
  const contextFields = ['composeQuotedMsg', 'composeQuotedMsgRemoteJid', 'quotedMsgAdminGroupJid', 'attachMediaContents'];
  const allowedTags = new Set(['DIV', 'P', 'SPAN', 'BR']);
  const allowedAttributes = new Set(['class', 'dir', 'style', 'data-lexical-text', 'data-lexical-linebreak']);
  let revision = 1;
  let previous = null;
  let emitter = null;
  let suppressed = false;
  let disposed = false;
  const normalize = (value) => String(value || '').replace(/\r\n?/g, '\n').replace(/\u200b/g, '').trim();
  const identity = (chat) => typeof chat?.id === 'string' ? chat.id : chat?.id?._serialized || '';
  const visible = (node) => Boolean(node?.isConnected && node.getClientRects().length && !node.hidden);
  const issue = (code = 'SEND_INTENT_UNSUPPORTED') => Object.assign(new Error(code), { code });
  const empty = (value) => value == null || value === false || value === ''
    || (Array.isArray(value) && value.length === 0)
    || (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === 0);

  function advance(reason, trusted = false) {
    if (suppressed || disposed) return;
    if (revision < Number.MAX_SAFE_INTEGER) revision += 1;
    changed({ reason, trusted, revision });
  }
  const activeChanged = () => advance('chat');
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
    return { W, chat, chatId, editor, text, footer: editor?.closest('footer') || null };
  }
  function synchronize(value) {
    if (previous && (previous.chatId !== value.chatId || previous.chat !== value.chat
        || previous.editor !== value.editor || previous.text !== value.text)) advance('context');
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
  function extraContext(footer, editor) {
    const suspicious = '[contenteditable="false"], img, video, audio, canvas, textarea, '
      + '[data-testid*="quoted"], [data-testid*="preview"], [data-testid*="forward"], '
      + '[data-testid*="edit-message"], [data-testid*="media-editor"], [data-mention-jid], [data-mention-id]';
    if ([...footer.querySelectorAll(suspicious)].some(visible)) return true;
    // A reply/edit/forward banner with an unfamiliar selector is not plain text.
    const outsideText = (node) => {
      if (node === editor || node.nodeType === 1 && (node.matches('button, [role="button"], svg') || !visible(node))) return false;
      if (node.nodeType === 3) return Boolean(node.textContent.trim());
      return [...node.childNodes].some(outsideText);
    };
    return [...footer.childNodes].some(outsideText);
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
    const attributes = chat.attributes || {};
    for (const key of contextFields) {
      if (!(key in chat) && !Object.hasOwn(attributes, key)) throw issue();
      if (!empty(key in chat ? chat[key] : attributes[key])) throw issue();
    }
    const contents = chat.getComposeContents();
    if (!contents || typeof contents !== 'object' || Array.isArray(contents) || typeof contents.text !== 'string'
        || Object.keys(contents).some((key) => !['text', 'timestamp'].includes(key))
        || normalize(contents.text) !== text || !plainTree(editor) || extraContext(footer, editor)
        || /(^|\s)@[\p{L}\p{N}_]/u.test(text)) throw issue();
    return value;
  }
  function currentChat() {
    try { return synchronize(raw()).chatId || null; } catch { return null; }
  }
  function matches(record, value) {
    return value.chatId === record.chatId && value.editor === record.editor && value.chat === record.chat
      && value.text === record.text && value.composerRevision === record.composerRevision;
  }
  function clear(record) {
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
  const input = (event) => {
    if (event.isTrusted !== true || !event.target?.closest?.(selector)) return;
    advance(event.type, true);
    if (event.type === 'input') previous = raw();
  };
  const observer = new MutationObserver((records) => {
    if (!previous?.editor || suppressed) return;
    const editor = previous.editor;
    if (records.some((record) => editor.contains(record.target)
        || [...record.addedNodes || [], ...record.removedNodes || []].some((node) => node === editor || node.contains?.(editor)))) {
      advance('node');
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['contenteditable', 'data-testid', 'data-tab'] });
  document.addEventListener('beforeinput', input, true);
  document.addEventListener('input', input, true);
  return { selector, read, currentChat, matches, clear,
    get revision() { return revision; },
    rawText: () => { try { return raw().text; } catch { return ''; } },
    dispose() {
      disposed = true; observer.disconnect(); emitter?.off?.('chat.active_chat', activeChanged);
      document.removeEventListener('beforeinput', input, true); document.removeEventListener('input', input, true);
    },
  };
}
