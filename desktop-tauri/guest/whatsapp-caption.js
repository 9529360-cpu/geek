// Read the real ATTACH drawer and READY model before its original onSendMedia
// closes the preview. Only the existing SendIntent may call submit.
function createWhatsAppCaption(changed) {
  const selector = '[contenteditable="true"][data-testid="media-caption-input-container"][role="textbox"]';
  const sendPath = 'M4.4 19.43a.99.99 0 0 1-.95-.1.93.93 0 0 1-.45-.83V14l8-2-8-2V5.5c0-.37.15-.65.45-.84'
    + 'a1 1 0 0 1 .95-.09l15.4 6.5c.42.19.63.5.63.93 0 .43-.21.74-.63.93l-15.4 6.5Z';
  const viewOncePaths = [
    'M12 2a10 10 0 1 0 .16 20 1.11 1.11 0 1 0-.03-2.22A7.8 7.8 0 0 1 4.23 12a7.78 7.78 0 0 1 7.9-7.78'
      + 'A1.11 1.11 0 1 0 12.16 2H12Zm4.86 1.26a1.11 1.11 0 1 0-1.08 1.94l.22.13a1.11 1.11 0 1 0 1.14-1.9'
      + 'l-.28-.17Zm2.19 3.22a1.11 1.11 0 0 1 1.53.38l.16.28a1.11 1.11 0 0 1-1.94 1.08 7.86 7.86 0 0 0-.13-.22'
      + 'c-.31-.52-.14-1.2.38-1.52ZM22 11.84a1.11 1.11 0 1 0-2.22.03 7.8 7.8 0 0 1 0 .26 1.11 1.11 0 0 0 2.22.03'
      + ' 9.93 9.93 0 0 0 0-.32Zm-1.69 3.51c.54.3.73.97.43 1.5l-.16.3a1.11 1.11 0 1 1-1.9-1.15l.12-.22'
      + 'c.3-.54.98-.73 1.51-.43Zm-3.17 5.23a1.11 1.11 0 1 0-1.14-1.9l-.22.12a1.11 1.11 0 0 0 1.08 1.94l.28-.16Z',
    'M12 10.5v3.75a.73.73 0 0 0 .75.75.73.73 0 0 0 .75-.75v-4.5a.73.73 0 0 0-.75-.75h-1.5a.73.73 0 0 0-.75.75'
      + '.73.73 0 0 0 .75.75H12Z',
  ];
  const allowed = new Set(['class', 'dir', 'style', 'data-lexical-text', 'data-lexical-linebreak']);
  const modelFields = ['id', 'file', 'state', 'mediaPrep', 'caption', 'type', 'mimetype', 'filename', 'quality',
    'mediaEditorData', 'editedFile', 'isGif', 'isVcardOverMmsDocument', 'stickerMaker', 'fullPreview',
    'documentPageCount', 'fullPreviewSize', 'isPasswordProtected', 'preview', 'exception'];
  const dataFields = ['mediaBlob', 'filehash', 'type', 'mimetype', 'size', 'isViewOnce', 'isGif', 'filename'];
  const mediaReader = createWhatsAppCaptionMedia();
  const ids = new WeakMap();
  const proofs = new WeakSet();
  let revision = 1, previous = null, disposed = false, emitter = null, wasActive = false;
  let watched = [], subscriptions = [];
  const issue = (code = 'SEND_INTENT_UNSUPPORTED') => Object.assign(new Error(code), { code });
  const idOf = (value) => typeof value === 'string' ? value : value?._serialized || '';
  const visible = (node) => Boolean(node?.isConnected && !node.hidden && node.getClientRects().length);
  const listenable = (value) => typeof value?.on === 'function' && typeof value.off === 'function';
  const normalize = (value) => String(value || '').replace(/\r\n?/g, '\n').trim();
  const same = (left, right) => left.length === right.length && left.every((item, index) => item === right[index]);
  const outputValid = (text) => typeof text === 'string' && Boolean(text.trim()) && [...text].length <= 1024
    && new TextEncoder().encode(text).length <= 32768 && !/[\x00-\x08\x0b-\x1f\x7f\u200b]/.test(text);

  function advance(reason, trusted = false) {
    if (disposed) return;
    if (revision < Number.MAX_SAFE_INTEGER) revision += 1;
    changed({ reason, trusted, revision });
  }
  const modelChanged = () => advance('attachment');
  const chatChanged = () => advance('chat');
  function watchRuntime(W) {
    if (emitter === W) return;
    emitter?.off?.('chat.active_chat', chatChanged); emitter = null;
    if (!listenable(W)) return;
    W.on('chat.active_chat', chatChanged); emitter = W;
  }
  function watchModels(value) {
    const models = value.models || [];
    const next = [value.chat, value.collection, value.collection?.selection,
      ...models.flatMap((media) => [media, media?.mediaPrep?.mediaData])];
    if (same(watched, next)) return;
    for (const [target, name] of subscriptions) target.off(name, modelChanged);
    subscriptions = []; watched = next;
    const bind = (target, names) => {
      if (!listenable(target)) return;
      for (const name of names) { target.on(name, modelChanged); subscriptions.push([target, name]); }
    };
    bind(value.chat, ['change:id', 'change:attachMediaContents', 'change:composeQuotedMsg',
      'change:composeQuotedMsgRemoteJid', 'change:quotedMsgAdminGroupJid']);
    bind(value.collection, ['add', 'remove', 'reset', 'active-change', 'change:isStickerMaker']);
    bind(value.collection?.selection, ['all']);
    for (const media of models) {
      bind(media, modelFields.map((name) => `change:${name}`));
      bind(media?.mediaPrep?.mediaData, ['change', ...dataFields.map((name) => `change:${name}`)]);
    }
  }
  function scopeOf(editor) {
    for (let node = editor?.parentNode; node?.nodeType === 1; node = node.parentNode) {
      if (String(node.className || '').split(/\s+/).includes('copyable-area')) return node;
    }
    return null;
  }
  function iconButton(node, name, paths) {
    if (!visible(node) || !node.matches('button, [role="button"]')) return false;
    // Production WDSSvgComponentBase deliberately omits the requested testid.
    // Bind to the actual icon title/path instead of inventing a data-icon.
    const icons = [...node.querySelectorAll('svg')];
    return icons.length === 1 && icons[0].querySelector('title')?.textContent === name
      && same([...icons[0].querySelectorAll('path')].map((path) => path.getAttribute('d')), paths);
  }
  const sendButton = (node) => iconButton(node, 'ic-send-filled', [sendPath]);
  const viewOnceOff = (node) => iconButton(node, 'wds-ic-view-once', viewOncePaths);
  function plainText(editor) {
    let count = 0;
    const nodes = [], values = [];
    const visit = (node, depth = 0) => {
      if (++count > 512 || depth > 8) throw issue();
      nodes.push(node);
      if (node.nodeType === 3) { values.push(node.textContent); return node.textContent; }
      if (node.nodeType !== 1 || !['P', 'SPAN', 'BR'].includes(node.tagName)
          || !visible(node) || [...node.attributes].some((attr) => !allowed.has(attr.name))
          || node.hasAttribute('style') && node.getAttribute('style').trim() !== ''
          || node.hasAttribute('data-lexical-text') && node.getAttribute('data-lexical-text') !== 'true') throw issue();
      const direction = node.getAttribute('dir');
      if (direction !== null && !['ltr', 'rtl', 'auto'].includes(direction)) throw issue();
      values.push(JSON.stringify([node.tagName, [...node.attributes].map((attr) => [attr.name, attr.value]).sort()]));
      if (node.tagName === 'BR') { if (node.childNodes.length) throw issue(); return '\n'; }
      if (node.tagName === 'P' && node.childNodes.length === 1 && node.childNodes[0].tagName === 'BR') {
        visit(node.childNodes[0], depth + 1); return '';
      }
      return [...node.childNodes].map((child) => visit(child, depth + 1)).join('');
    };
    const children = [...editor.childNodes];
    const paragraphs = children.some((node) => node.tagName === 'P');
    if (paragraphs && children.some((node) => node.tagName !== 'P')) throw issue();
    const text = children.map((node) => visit(node)).join(paragraphs ? '\n' : '');
    if (!outputValid(text) || /(^|\s)@[\p{L}\p{N}_]/u.test(text)) throw issue();
    return { text: normalize(text), parsable: text, nodes, nodeValues: values };
  }
  function raw() {
    const W = window.WPP;
    watchRuntime(W);
    const chat = W?.chat?.getActiveChat?.() || null;
    const editors = [...document.querySelectorAll(selector)].filter(visible);
    const editor = editors.length === 1 ? editors[0] : null;
    const collection = chat?.attachMediaContents;
    const media = collection?.getActive?.() || null;
    const data = media?.mediaPrep?.mediaData || null;
    const list = collection?.getModelsArray?.();
    const models = Array.isArray(list) && list.length <= 10 ? list : [];
    const value = { W, chat, chatId: idOf(chat?.id), collection, media, data, models, editor, footer: scopeOf(editor) };
    watchModels(value);
    return value;
  }
  function active() {
    if (disposed) return false;
    const known = [...document.querySelectorAll(selector)].some(visible);
    let present = known;
    try {
      const W = window.WPP;
      watchRuntime(W);
      const collection = W?.chat?.getActiveChat?.()?.attachMediaContents;
      present ||= Boolean(collection && collection.length !== 0);
    } catch { /* A visible known drawer still owns submission when WPP is unavailable. */ }
    if (!present) { previous = null; watchModels({}); }
    if (wasActive !== present) { wasActive = present; advance('attachment'); }
    return present;
  }
  function previewOf(value) {
    const { media, editor, footer } = value;
    const src = media.fullPreview;
    if (typeof src !== 'string' || !/^blob:https:\/\/web\.whatsapp\.com\/[\da-f-]+$/i.test(src)) throw issue();
    let query, background = null;
    if (media.type === 'image') {
      background = media.mediaEditorData.getBackground?.()?.getImage?.();
      if (typeof window.HTMLImageElement !== 'function' || !(background instanceof window.HTMLImageElement)
          || background.src !== src) throw issue();
      query = '[data-testid="media-editor-canvas"] img';
    } else if (media.type === 'video') query = '[data-animate-attach-media] video';
    else {
      if (media.mimetype !== 'application/pdf' || !Number.isSafeInteger(media.documentPageCount)
          || media.documentPageCount < 1 || media.isPasswordProtected) throw issue();
      query = '[data-js-attach-preview] img';
    }
    for (let scope = editor.parentNode; scope && scope !== footer; scope = scope.parentNode) {
      const nodes = [...scope.querySelectorAll(query)].filter(visible);
      if (!nodes.length) continue;
      if (nodes.length !== 1 || nodes[0].getAttribute('src') !== src
          || nodes[0].src !== src || media.type !== 'video' && nodes[0].complete !== true
          || media.type === 'video' && (nodes[0].srcObject != null
            || nodes[0].currentSrc && nodes[0].currentSrc !== src || nodes[0].querySelector('source'))) throw issue();
      return { previewNode: nodes[0], previewScope: scope, previewSrc: src, background };
    }
    throw issue();
  }
  function filmstripOf(value, items) {
    if (items.length === 1) return { tablist: null, tabs: [], thumbs: [], thumbValues: [] };
    const { footer, media } = value;
    const lists = [...footer.querySelectorAll('[role="tablist"]')].filter(visible);
    if (lists.length !== 1) throw issue();
    const tablist = lists[0], tabs = [...tablist.querySelectorAll('[role="tab"]')].filter(visible);
    if (tabs.length !== items.length) throw issue();
    const thumbs = [], thumbValues = [], sources = new Set();
    tabs.forEach((tab, index) => {
      const item = items[index], selected = item.media === media;
      if (tab.closest('[role="tablist"]') !== tablist || tab.getAttribute('aria-posinset') !== String(index + 1)
          || tab.getAttribute('aria-setsize') !== String(items.length) || tab.getAttribute('aria-selected') !== String(selected)) throw issue();
      let src = item.preview;
      if (item.media.type === 'image') {
        if (src !== item.fullPreview || typeof src !== 'string' || !/^blob:https:\/\/web\.whatsapp\.com\/[\da-f-]+$/i.test(src)) throw issue();
      } else {
        if (!selected || item.media.type !== 'video' || typeof src !== 'string' || !src
            || !/^[A-Za-z\d+/]+={0,2}$/.test(src) || src !== item.data.preview) throw issue();
        src = `data:image/jpeg;base64,${src}`;
      }
      const images = [...tab.querySelectorAll('img')].filter(visible);
      if (images.length !== 1 || images[0].getAttribute('src') !== src || images[0].src !== src
          || images[0].complete !== true || sources.has(src)) throw issue();
      sources.add(src); thumbs.push(images[0]); thumbValues.push(src);
    });
    return { tablist, tabs, thumbs, thumbValues };
  }
  function read() {
    const value = raw();
    const { W, chat, chatId, collection, media, models, editor, footer } = value;
    const types = W?.whatsapp;
    if (disposed || revision >= Number.MAX_SAFE_INTEGER || W?.isReady !== true || W?.isInjected !== true
        || !types || typeof types.ChatModel !== 'function' || !(chat instanceof types.ChatModel)
        || typeof types.Wid !== 'function' || !(chat.id instanceof types.Wid) || chat.id.toString() !== chatId
        || !/^[1-9]\d{0,29}(?:-\d{1,20})?@(c\.us|lid|g\.us)$/.test(chatId)
        || chat.canSend !== true || typeof chat.isGroup !== 'boolean' || chat.isGroup !== chatId.endsWith('@g.us')
        || chat.isReadOnly || chat.isNewsletter || chat.isBroadcast || chat.isParentGroup || chat.groupMetadata?.isParentGroup
        || chat.composeQuotedMsg != null || chat.composeQuotedMsgRemoteJid != null || chat.quotedMsgAdminGroupJid != null
        || !listenable(chat) || !listenable(collection) || models.some((item) => !listenable(item) || !listenable(item?.mediaPrep?.mediaData))
        || !Number.isSafeInteger(collection.length) || collection.length < 1 || collection.length > 10
        || collection.isStickerMaker !== false || models.length !== collection.length || new Set(models).size !== models.length
        || typeof collection.get !== 'function' || typeof collection.selection?.getVal !== 'function'
        || !models.includes(media) || models.some((item) => collection.get(item?.id) !== item)
        || collection.selection.getVal() !== media
        || !visible(editor) || !visible(footer) || !footer.contains(editor)) throw issue();
    const items = models.map((item) => mediaReader.read(W, item));
    if (items.reduce((total, item) => total + item.blob.size, 0) > 1024 * 1024 * 1024) throw issue();
    if (items.length > 1 && (typeof window.crypto?.subtle?.digest !== 'function'
        || typeof collection.getPreviewableMedias !== 'function' || !same(collection.getPreviewableMedias(), models)
        || !Array.isArray(collection.selection.list) || !same(collection.selection.list, models)
        || items.some((item) => item.media !== media && (item.media.type !== 'image' || item.caption != null && item.caption !== ''))
        || !['image', 'video'].includes(media.type))) throw issue();
    const buttons = [...footer.querySelectorAll('button, [role="button"]')].filter(sendButton);
    const editors = [...footer.querySelectorAll('[contenteditable="true"]')].filter(visible);
    const toggles = [...footer.querySelectorAll('button, [role="button"]')].filter((node) => visible(node)
      && /^wds-ic-view-once(?:-filled)?$/.test(node.querySelector('svg title')?.textContent || ''));
    if (!same(editors, [editor]) || footer.querySelectorAll('input[type="file"]').length !== 1 || buttons.length !== 1
        || buttons[0].getAttribute('aria-disabled') === 'true' || buttons[0].disabled
        || media.type === 'document' && toggles.length !== 0
        || media.type !== 'document' && (toggles.length !== 1 || !viewOnceOff(toggles[0])
          || toggles[0].getAttribute('aria-pressed') !== 'false')
        || footer.querySelector('[data-app-text-template], [data-mention-id], [data-mention-jid]')) throw issue();
    const content = plainText(editor);
    if (typeof media.caption !== 'string' || media.caption !== content.parsable) throw issue();
    const preview = previewOf(value);
    const filmstrip = filmstripOf(value, items);
    const fingerprint = items.flatMap((item) => [item.media, ...item.fingerprint]);
    const owner = items.length === 1 ? media : collection;
    if (items.length > 1) fingerprint.push(media);
    let identity = ids.get(owner);
    if (!identity || !same(identity.fingerprint, fingerprint)) {
      identity = { fingerprint, id: crypto.randomUUID() }; ids.set(owner, identity);
    }
    const proof = { ...value, ...content, ...preview, ...filmstrip, items, fingerprint,
      button: buttons[0], toggle: toggles[0] || null, context: Object.freeze({ kind: 'attachment', attachmentId: identity.id }) };
    if (previous && !equivalent(previous, proof)) advance('attachment');
    previous = proof; proofs.add(proof);
    return { ...value, text: proof.text, context: proof.context, captionProof: proof, composerRevision: revision };
  }
  function equivalent(left, right) {
    return ['W', 'chat', 'chatId', 'collection', 'media', 'data', 'editor', 'footer', 'text', 'parsable',
      'button', 'toggle', 'previewNode', 'previewScope', 'previewSrc', 'background', 'tablist']
      .every((key) => left[key] === right[key])
      && same(left.fingerprint, right.fingerprint) && same(left.nodes, right.nodes) && same(left.nodeValues, right.nodeValues)
      && same(left.tabs, right.tabs) && same(left.thumbs, right.thumbs) && same(left.thumbValues, right.thumbValues)
      && left.items.length === right.items.length && left.items.every((item, index) => mediaReader.equivalent(item, right.items[index]));
  }
  function matches(record, value) {
    const proof = record.composerState?.captionProof || record.captionProof;
    return Boolean(proof && proofs.has(proof) && value.captionProof && proofs.has(value.captionProof)
      && record.context?.kind === 'attachment' && record.context.attachmentId === value.context.attachmentId
      && record.composerRevision === value.composerRevision && equivalent(proof, value.captionProof));
  }
  function submit(record, text, valid) {
    if (!valid() || !outputValid(text)) throw issue('SEND_INTENT_CHANGED');
    const value = read();
    if (!matches(record, value)) throw issue('SEND_INTENT_CHANGED');
    const proof = value.captionProof;
    if (proof.items.length === 1) return mediaReader.send(proof.W, proof.items[0], proof.chat, proof.chatId, text);
    return submitBatch(record, proof, text, valid);
  }
  async function submitBatch(record, proof, text, valid) {
    const check = () => {
      if (!valid() || !matches(record, read())) throw issue('SEND_INTENT_CHANGED');
    };
    const messageIds = [];
    let ack = Infinity;
    for (const item of proof.items) {
      check();
      const result = await mediaReader.send(proof.W, item, proof.chat, proof.chatId, item.media === proof.media ? text : '');
      check();
      if (messageIds.includes(result.id)) throw issue('SEND_INTENT_RECEIPT_MISSING');
      messageIds.push(result.id); ack = Math.min(ack, result.ack);
    }
    // This is a client aggregate proof of all validated, ordered server keys.
    // No first/last message is presented as a receipt for the entire batch.
    const input = new TextEncoder().encode(JSON.stringify({ attachmentId: proof.context.attachmentId,
      chatId: proof.chatId, messageIds }));
    const digest = await window.crypto.subtle.digest('SHA-256', input);
    check();
    const bytes = new Uint8Array(digest);
    if (bytes.length !== 32) throw issue('SEND_INTENT_RECEIPT_MISSING');
    const hash = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return { id: `wa-batch:${messageIds.length}:${hash}`, ack };
  }
  function submission(event) {
    if (!active()) return { matches: false, supported: false };
    const target = event.target, button = target?.closest?.('button, [role="button"]');
    const editors = [...document.querySelectorAll(selector)].filter(visible);
    const scope = editors.length === 1 ? scopeOf(editors[0]) : null;
    // A known Send icon with a changed path is still a submission gesture. The
    // strict reader rejects its proof instead of passing the source to Flow.
    const hit = Boolean(scope?.contains(button) && visible(button)
      && button.querySelector('svg title')?.textContent === 'ic-send-filled');
    if (event.type === 'click') return { matches: hit, supported: true };
    if (event.type === 'keydown' && hit && ['Enter', ' '].includes(event.key) && !event.shiftKey && !event.ctrlKey
        && !event.altKey && !event.metaKey && !event.isComposing) return { matches: true, supported: true };
    // Caption Enter follows a preference not exposed by the pinned facade. The
    // original button remains available; Shift+Enter continues to insert a line.
    const caption = target?.closest?.(selector);
    const ordinary = event.type === 'keydown' && event.key === 'Enter' && !event.shiftKey && !event.ctrlKey
      && !event.altKey && !event.metaKey && !event.isComposing;
    return { matches: Boolean(ordinary && caption), supported: false };
  }
  const input = (event) => {
    if (event.isTrusted && event.target?.closest?.(selector)) advance(event.type, true);
  };
  const filmstripGesture = (event) => {
    // SingleSelection.init emits nothing when the active index is unchanged,
    // even if other items were reordered. Fence the real draggable-list gesture
    // before React's onReorder, including an A-to-B-to-A change within one task.
    const list = previous?.tablist;
    if (!event.isTrusted || !visible(list) || !list.contains(event.target)) return;
    if (event.type === 'dragstart' || ['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      advance('attachment');
    }
  };
  const observer = new MutationObserver((records) => {
    if (!previous) return;
    const { editor, footer, button, toggle, previewNode, tablist } = previous;
    const parts = [editor, button, toggle, previewNode, tablist];
    if (records.some((record) => parts.some((node) => node?.contains(record.target))
        || record.target === footer || [...record.addedNodes || [], ...record.removedNodes || []]
          .some((node) => [...parts, footer].some((part) => part && (node === part || node.contains?.(part)))))) {
      advance('attachment');
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['contenteditable', 'data-testid', 'aria-pressed', 'aria-disabled', 'aria-hidden', 'role',
      'hidden', 'class', 'style', 'dir', 'd', 'src', 'data-app-text-template', 'data-lexical-text',
      'aria-selected', 'aria-posinset', 'aria-setsize'] });
  document.addEventListener('beforeinput', input, true); document.addEventListener('input', input, true);
  document.addEventListener('dragstart', filmstripGesture, true); document.addEventListener('keydown', filmstripGesture, true);
  return { selector, active, read, matches, submission, submit, outputValid, clear: () => false,
    get revision() { return revision; },
    currentChat: () => { try { return raw().chatId || null; } catch { return null; } },
    rawText: () => { try { return normalize(plainText(raw().editor).text); } catch { return ''; } },
    dispose() {
      disposed = true; observer.disconnect(); emitter?.off?.('chat.active_chat', chatChanged);
      for (const [target, name] of subscriptions) target.off(name, modelChanged);
      subscriptions = []; watched = []; previous = null;
      document.removeEventListener('beforeinput', input, true); document.removeEventListener('input', input, true);
      document.removeEventListener('dragstart', filmstripGesture, true); document.removeEventListener('keydown', filmstripGesture, true);
    } };
}
