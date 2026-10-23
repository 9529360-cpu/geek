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
    'documentPageCount', 'fullPreviewSize', 'isPasswordProtected'];
  const dataFields = ['mediaBlob', 'filehash', 'type', 'mimetype', 'size', 'isViewOnce', 'isGif', 'filename'];
  const metadataKeys = new Set(('type directPath mediaKey mediaKeyTimestamp encFilehash mediaStage size loadedSize '
    + 'filehash mimetype mediaBlob renderableUrl fullHeight fullWidth aspectRatio rgbaBuffer rgbaHeight rgbaWidth '
    + 'animationDuration animatedAsNewMsg isAnimated isFirstParty isFromStickerMaker isAvatar isAiSticker isLottie '
    + 'stickerPremiumStatus stickerPackId stickerPackName stickerPackPublisher stickerMakerSourceType singleLoopDuration '
    + 'firstFrameLength firstFrameSidecar emojis accessibilityLabel progressiveStage isViewOnce staticUrl preview sidecar '
    + 'duration isGif gifAttribution suspiciousContent filename pageCount documentPreview isPasswordProtected '
    + 'isVcardOverMmsDocument parsedVcards extractedLottieSticker fullPreviewSize fullPreviewData subtype waveform').split(' '));
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
    const next = [value.chat, value.collection, value.media, value.data];
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
    bind(value.media, modelFields.map((name) => `change:${name}`));
    bind(value.data, ['change', ...dataFields.map((name) => `change:${name}`)]);
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
    const value = { W, chat, chatId: idOf(chat?.id), collection, media, data, editor, footer: scopeOf(editor) };
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
  function blobOf(value, types) {
    const BlobType = window.Blob;
    if (typeof BlobType === 'function' && value instanceof BlobType) return value;
    if (typeof types.OpaqueData !== 'function' || !(value instanceof types.OpaqueData)
        || value.released !== false || typeof value.getBlob !== 'function') throw issue();
    const blob = value.getBlob();
    if (typeof BlobType !== 'function' || !(blob instanceof BlobType)) throw issue();
    return blob;
  }
  function mediaSnapshot(data, blob) {
    // BaseModel.toJSON copies its declared props. Clone only that known schema;
    // no mutable platform model, URL or OpaqueData crosses the sender's awaits.
    if (typeof data.toJSON !== 'function') throw issue();
    const values = data.toJSON();
    if (!values || Object.prototype.toString.call(values) !== '[object Object]') throw issue();
    let bytes = 0, count = 0;
    const clone = (value, depth = 0) => {
      if (++count > 4096 || depth > 8) throw issue();
      if (value == null || typeof value === 'boolean') return value;
      if (typeof value === 'number') { if (!Number.isFinite(value)) throw issue(); return value; }
      if (typeof value === 'string') { bytes += value.length * 2; if (bytes > 1024 * 1024) throw issue(); return value; }
      if (ArrayBuffer.isView(value) || Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
        const buffer = ArrayBuffer.isView(value) ? value.buffer : value;
        if (Object.prototype.toString.call(buffer) !== '[object ArrayBuffer]') throw issue();
        bytes += value.byteLength;
        if (bytes > 1024 * 1024 || typeof window.structuredClone !== 'function') throw issue();
        return window.structuredClone(value);
      }
      if (Array.isArray(value)) return value.map((item) => clone(item, depth + 1));
      if (Object.prototype.toString.call(value) !== '[object Object]') throw issue();
      const result = {};
      for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!Object.hasOwn(descriptor, 'value') || ['__proto__', 'constructor', 'prototype'].includes(name)) throw issue();
        result[name] = clone(descriptor.value, depth + 1);
      }
      return result;
    };
    const snapshot = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(values))) {
      if (!metadataKeys.has(key) || !Object.hasOwn(descriptor, 'value') || descriptor.value !== data[key]) throw issue();
      if (key === 'mediaBlob') { if (descriptor.value !== data.mediaBlob) throw issue(); snapshot.mediaBlob = blob; }
      else if (key !== 'renderableUrl' && key !== 'staticUrl') snapshot[key] = clone(descriptor.value);
    }
    if (snapshot.mediaBlob !== blob || snapshot.filehash !== data.filehash || snapshot.type !== data.type
        || snapshot.size !== blob.size || snapshot.mimetype !== blob.type) throw issue();
    return snapshot;
  }
  function sameMetadata(left, right) {
    if (left === right) return true;
    if (left == null || right == null || typeof left !== 'object' || typeof right !== 'object') return false;
    const binary = (value) => ArrayBuffer.isView(value) || Object.prototype.toString.call(value) === '[object ArrayBuffer]';
    if (binary(left) || binary(right)) {
      if (!binary(left) || !binary(right) || left.byteLength !== right.byteLength) return false;
      const bytes = (value) => new Uint8Array(value.buffer || value, value.byteOffset || 0, value.byteLength);
      const expected = bytes(right);
      return bytes(left).every((value, index) => value === expected[index]);
    }
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && sameMetadata(left[key], right[key]));
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
  function read() {
    const value = raw();
    const { W, chat, chatId, collection, media, data, editor, footer } = value;
    const types = W?.whatsapp;
    if (disposed || revision >= Number.MAX_SAFE_INTEGER || W?.isReady !== true || W?.isInjected !== true
        || !types || typeof types.ChatModel !== 'function' || !(chat instanceof types.ChatModel)
        || typeof types.Wid !== 'function' || !(chat.id instanceof types.Wid) || chat.id.toString() !== chatId
        || !/^[1-9]\d{0,29}(?:-\d{1,20})?@(c\.us|lid|g\.us)$/.test(chatId)
        || chat.canSend !== true || typeof chat.isGroup !== 'boolean' || chat.isGroup !== chatId.endsWith('@g.us')
        || chat.isReadOnly || chat.isNewsletter || chat.isBroadcast || chat.isParentGroup || chat.groupMetadata?.isParentGroup
        || chat.composeQuotedMsg != null || chat.composeQuotedMsgRemoteJid != null || chat.quotedMsgAdminGroupJid != null
        || !listenable(chat) || !listenable(collection) || !listenable(media) || !listenable(data)
        || collection.length !== 1 || collection.isStickerMaker !== false || typeof collection.getModelsArray !== 'function'
        || typeof collection.get !== 'function' || typeof collection.selection?.getVal !== 'function'
        || typeof types.AttachMediaModel !== 'function' || !(media instanceof types.AttachMediaModel)
        || collection.get(media.id) !== media || !same(collection.getModelsArray(), [media]) || collection.selection.getVal() !== media
        || !visible(editor) || !visible(footer) || !footer.contains(editor)) throw issue();
    const prep = media.mediaPrep, edit = media.mediaEditorData;
    if (typeof types.MediaPrep !== 'function' || !(prep instanceof types.MediaPrep) || typeof prep.sendToChat !== 'function'
        || typeof types.MediaDataModel !== 'function' || !(data instanceof types.MediaDataModel)
        || media.state !== 'ready' || !['image', 'video', 'document'].includes(media.type)
        || prep.baseType !== media.type || data.type !== media.type || media.quality !== 'Standard'
        || media.stickerMaker || media.isGif || media.isVcardOverMmsDocument || media.exception
        || data.isGif || data.isViewOnce || data.isVcardOverMmsDocument || data.isFromStickerMaker || data.isAvatar
        || data.isAiSticker || data.isPasswordProtected
        || typeof edit?.hasEdits !== 'function' || edit.hasEdits() !== false
        || typeof edit.getSending !== 'function' || edit.getSending() !== false
        || typeof media.canUndoMediaEditorData !== 'function' || media.canUndoMediaEditorData() !== false
        || typeof media.canRedoMediaEditorData !== 'function' || media.canRedoMediaEditorData() !== false) throw issue();
    const blob = blobOf(data.mediaBlob, types);
    if (media.file !== data.mediaBlob || media.editedFile !== data.mediaBlob || !Number.isSafeInteger(blob.size)
        || blob.size <= 0 || blob.size > 512 * 1024 * 1024 || data.size !== blob.size
        || typeof data.filehash !== 'string' || !/^[A-Za-z\d+/]{43}=$/.test(data.filehash)
        || data.mimetype !== media.mimetype || data.mimetype !== blob.type
        || !/^[a-z\d!#$&^_.+-]+\/[a-z\d!#$&^_.+-]+$/i.test(data.mimetype)
        || media.type !== 'document' && !data.mimetype.startsWith(`${media.type}/`)) throw issue();
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
    const payload = mediaSnapshot(data, blob);
    const fingerprint = [prep, data, data.mediaBlob, blob, data.filehash, media.type, media.mimetype,
      media.filename, media.quality, media.file, media.editedFile];
    let identity = ids.get(media);
    if (!identity || !same(identity.fingerprint, fingerprint)) {
      identity = { fingerprint, id: crypto.randomUUID() }; ids.set(media, identity);
    }
    const proof = { ...value, ...content, ...preview, payload, prep, blob, holder: data.mediaBlob, edit, fingerprint,
      button: buttons[0], toggle: toggles[0] || null, context: Object.freeze({ kind: 'attachment', attachmentId: identity.id }) };
    if (previous && !equivalent(previous, proof)) advance('attachment');
    previous = proof; proofs.add(proof);
    return { ...value, text: proof.text, context: proof.context, captionProof: proof, composerRevision: revision };
  }
  function equivalent(left, right) {
    return ['W', 'chat', 'chatId', 'collection', 'media', 'data', 'editor', 'footer', 'prep', 'blob', 'holder',
      'edit', 'text', 'parsable', 'button', 'toggle', 'previewNode', 'previewScope', 'previewSrc', 'background']
      .every((key) => left[key] === right[key])
      && same(left.fingerprint, right.fingerprint) && same(left.nodes, right.nodes) && same(left.nodeValues, right.nodeValues)
      && sameMetadata(left.payload, right.payload);
  }
  function matches(record, value) {
    const proof = record.composerState?.captionProof || record.captionProof;
    return Boolean(proof && proofs.has(proof) && value.captionProof && proofs.has(value.captionProof)
      && record.context?.kind === 'attachment' && record.context.attachmentId === value.context.attachmentId
      && record.composerRevision === value.composerRevision && equivalent(proof, value.captionProof));
  }
  function receipt(proof, output, expectedKey, result) {
    const types = proof.W.whatsapp, msg = result?.msg, key = msg?.id;
    if (result?.messageSendResult !== 'OK' || typeof types.MsgModel !== 'function' || !(msg instanceof types.MsgModel)
        || typeof types.MsgKey !== 'function' || !(key instanceof types.MsgKey) || !expectedKey
        || key.toString() !== expectedKey || key._serialized !== expectedKey || key.fromMe !== true
        || !(key.remote instanceof types.Wid) || key.remote.toString() !== proof.chatId
        || key.remote._serialized !== proof.chatId || msg.type !== proof.fingerprint[5] || msg.caption !== output
        || msg.filehash !== proof.fingerprint[4] || msg.size !== proof.blob.size
        || !Number.isFinite(msg.ack) || msg.ack < 1) throw issue('SEND_INTENT_RECEIPT_MISSING');
    return { id: expectedKey, ack: msg.ack };
  }
  function submit(record, text, valid) {
    if (!valid() || !outputValid(text)) throw issue('SEND_INTENT_CHANGED');
    const value = read();
    if (!matches(record, value)) throw issue('SEND_INTENT_CHANGED');
    const proof = value.captionProof;
    let key = null, invalidKey = false;
    const options = { caption: text, type: proof.media.type, isViewOnce: false, addEvenWhilePreparing: false,
      onMsgKeyCreated(value) {
        const types = proof.W.whatsapp, serialized = value?._serialized;
        if (key || typeof types.MsgKey !== 'function' || !(value instanceof types.MsgKey)
            || typeof serialized !== 'string' || serialized.length > 500 || /[\x00-\x20\x7f]/.test(serialized)
            || value.toString() !== serialized || value.fromMe !== true
            || !(value.remote instanceof types.Wid) || value.remote.toString() !== proof.chatId) invalidKey = true;
        else key = serialized;
      } };
    // The original prep is mutable across MediaPrepSendToChat's internal awaits.
    // Its public constructor gives this invocation a private prepared model with
    // a deep snapshot and the already verified immutable Blob. Never freeze or
    // modify the original preview or call the Flow that closes it before send.
    const types = proof.W.whatsapp;
    const prepared = new types.MediaPrep(proof.fingerprint[5], Promise.resolve(proof.payload));
    if (!(prepared instanceof types.MediaPrep) || prepared === proof.prep || prepared.baseType !== proof.fingerprint[5]
        || !(prepared.mediaData instanceof types.MediaDataModel) || prepared.mediaData === proof.data
        || typeof prepared.waitForPrep !== 'function' || typeof prepared.sendToChat !== 'function') throw issue();
    const pending = prepared.sendToChat({ chat: proof.chat, options });
    return Promise.resolve(pending).then((result) => receipt(proof, text, invalidKey ? null : key, result));
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
  const observer = new MutationObserver((records) => {
    if (!previous) return;
    const { editor, footer, button, toggle, previewNode } = previous;
    if (records.some((record) => [editor, button, toggle, previewNode].some((node) => node?.contains(record.target))
        || record.target === footer || [...record.addedNodes || [], ...record.removedNodes || []]
          .some((node) => [editor, footer, button, toggle, previewNode].some((part) => part && (node === part || node.contains?.(part)))))) {
      advance('attachment');
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['contenteditable', 'data-testid', 'aria-pressed', 'aria-disabled', 'aria-hidden', 'role',
      'hidden', 'class', 'style', 'dir', 'd', 'src', 'data-app-text-template', 'data-lexical-text'] });
  document.addEventListener('beforeinput', input, true); document.addEventListener('input', input, true);
  return { selector, active, read, matches, submission, submit, outputValid, clear: () => false,
    get revision() { return revision; },
    currentChat: () => { try { return raw().chatId || null; } catch { return null; } },
    rawText: () => { try { return normalize(plainText(raw().editor).text); } catch { return ''; } },
    dispose() {
      disposed = true; observer.disconnect(); emitter?.off?.('chat.active_chat', chatChanged);
      for (const [target, name] of subscriptions) target.off(name, modelChanged);
      subscriptions = []; watched = []; previous = null;
      document.removeEventListener('beforeinput', input, true); document.removeEventListener('input', input, true);
    } };
}
