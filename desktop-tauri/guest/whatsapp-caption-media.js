// Prepared-media validation and the one-file transport boundary. No source model
// is mutated, frozen or reused as the payload across the platform sender's awaits.
function createWhatsAppCaptionMedia() {
  const issue = (code = 'SEND_INTENT_UNSUPPORTED') => Object.assign(new Error(code), { code });
  const same = (left, right) => left.length === right.length && left.every((item, index) => item === right[index]);
  const metadataKeys = new Set(('type directPath mediaKey mediaKeyTimestamp encFilehash mediaStage size loadedSize '
    + 'filehash mimetype mediaBlob renderableUrl fullHeight fullWidth aspectRatio rgbaBuffer rgbaHeight rgbaWidth '
    + 'animationDuration animatedAsNewMsg isAnimated isFirstParty isFromStickerMaker isAvatar isAiSticker isLottie '
    + 'stickerPremiumStatus stickerPackId stickerPackName stickerPackPublisher stickerMakerSourceType singleLoopDuration '
    + 'firstFrameLength firstFrameSidecar emojis accessibilityLabel progressiveStage isViewOnce staticUrl preview sidecar '
    + 'duration isGif gifAttribution suspiciousContent filename pageCount documentPreview isPasswordProtected '
    + 'isVcardOverMmsDocument parsedVcards extractedLottieSticker fullPreviewSize fullPreviewData subtype waveform').split(' '));

  function blobOf(value, types) {
    const BlobType = window.Blob;
    if (typeof BlobType === 'function' && value instanceof BlobType) return value;
    if (typeof types.OpaqueData !== 'function' || !(value instanceof types.OpaqueData)
        || value.released !== false || typeof value.getBlob !== 'function') throw issue();
    const blob = value.getBlob();
    if (typeof BlobType !== 'function' || !(blob instanceof BlobType)) throw issue();
    return blob;
  }
  function pdfOf(types, media, data) {
    if (media.type !== 'document') return null;
    const shape = (value, keys) => {
      if (!value || Object.prototype.toString.call(value) !== '[object Object]') return false;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      return Object.keys(descriptors).length === keys.length
        && keys.every((key) => descriptors[key] && Object.hasOwn(descriptors[key], 'value'));
    };
    const size = (value) => shape(value, ['width', 'height'])
      && ['width', 'height'].every((key) => Number.isSafeInteger(value[key]) && value[key] > 0 && value[key] <= 32768);
    const jpeg = (value) => typeof value === 'string' && /^data:image\/jpeg;base64,[A-Za-z\d+/]+={0,2}$/.test(value);
    const preview = data.documentPreview;
    if (media.mimetype !== 'application/pdf' || media.isPasswordProtected
        || typeof media.filename !== 'string' || !media.filename || media.filename !== data.filename
        || !shape(preview, ['url', 'thumbUrl', 'width', 'height', 'fullPreviewData', 'fullPreviewSize', 'pdfPages', 'microThumbnail'])
        || typeof preview.url !== 'string' || !/^blob:https:\/\/web\.whatsapp\.com\/[\da-f-]+$/i.test(preview.url)
        || preview.url !== media.fullPreview || !jpeg(preview.thumbUrl) || preview.thumbUrl !== media.preview
        || !Number.isSafeInteger(preview.pdfPages) || preview.pdfPages < 1
        || preview.pdfPages !== media.documentPageCount || preview.pdfPages !== data.pageCount
        || !size(preview.fullPreviewSize) || !size(data.fullPreviewSize) || !size(media.fullPreviewSize)
        || ['width', 'height'].some((key) => preview[key] !== preview.fullPreviewSize[key]
          || preview[key] !== data.fullPreviewSize[key] || preview[key] !== media.fullPreviewSize[key])
        || !shape(preview.microThumbnail, ['opaqueData', 'width', 'height', 'dataUrl'])
        || !size({ width: preview.microThumbnail.width, height: preview.microThumbnail.height })
        || !jpeg(preview.microThumbnail.dataUrl)
        || data.preview !== preview.microThumbnail.dataUrl.slice('data:image/jpeg;base64,'.length)
        || data.fullPreviewData !== preview.fullPreviewData
        || typeof types.OpaqueData !== 'function' || typeof types.OpaqueData.createFromData !== 'function'
        || typeof types.OpaqueData.prototype?.autorelease !== 'function') throw issue();
    const holders = [preview.fullPreviewData, preview.microThumbnail.opaqueData];
    if (holders[0] === holders[1]) throw issue();
    const blobs = holders.map((holder) => {
      if (!(holder instanceof types.OpaqueData)) throw issue();
      const blob = blobOf(holder, types);
      if (blob.type !== 'image/jpeg' || !Number.isSafeInteger(blob.size) || blob.size < 1 || blob.size > 512 * 1024) throw issue();
      return blob;
    });
    return { preview, holders, blobs };
  }
  function snapshot(data, blob, pdf, types) {
    // BaseModel.toJSON copies its declared props. Clone only that known schema;
    // no mutable platform model, URL or OpaqueData crosses the sender's awaits.
    if (typeof data.toJSON !== 'function') throw issue();
    const values = data.toJSON();
    if (!values || Object.prototype.toString.call(values) !== '[object Object]') throw issue();
    let bytes = 0, count = 0;
    const counted = new Set(), previews = new Map(pdf ? [
      ['fullPreviewData', 0], ['documentPreview.fullPreviewData', 0], ['documentPreview.microThumbnail.opaqueData', 1],
    ] : []);
    const clone = (value, depth = 0, path = '') => {
      if (++count > 4096 || depth > 8) throw issue();
      if (previews.has(path)) {
        const index = previews.get(path), immutable = pdf.blobs[index];
        if (value !== pdf.holders[index]) throw issue();
        if (!counted.has(immutable)) { bytes += immutable.size; counted.add(immutable); }
        if (bytes > 1024 * 1024) throw issue();
        return immutable;
      }
      // Base64-only OpaqueData can contain only enumerable scalar fields; it
      // must not silently become a plain object outside the proven PDF paths.
      if (typeof types.OpaqueData === 'function' && value instanceof types.OpaqueData) throw issue();
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
      if (Array.isArray(value)) return value.map((item, index) => clone(item, depth + 1, `${path}.${index}`));
      if (Object.prototype.toString.call(value) !== '[object Object]') throw issue();
      const result = {};
      for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!Object.hasOwn(descriptor, 'value') || ['__proto__', 'constructor', 'prototype'].includes(name)) throw issue();
        result[name] = clone(descriptor.value, depth + 1, `${path}.${name}`);
      }
      return result;
    };
    const result = {};
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(values))) {
      if (!metadataKeys.has(key) || !Object.hasOwn(descriptor, 'value') || descriptor.value !== data[key]) throw issue();
      if (key === 'mediaBlob') result.mediaBlob = blob;
      else if (key !== 'renderableUrl' && key !== 'staticUrl') result[key] = clone(descriptor.value, 0, key);
    }
    if (result.mediaBlob !== blob || result.filehash !== data.filehash || result.type !== data.type
        || result.size !== blob.size || result.mimetype !== blob.type) throw issue();
    return result;
  }
  function sameMetadata(left, right) {
    if (left === right) return true;
    if (left == null || right == null || typeof left !== 'object' || typeof right !== 'object') return false;
    // Blobs have no enumerable content fields. Only the original immutable
    // identity can establish equality; an empty keys list proves nothing.
    if (left instanceof window.Blob || right instanceof window.Blob) return false;
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
  function read(W, media) {
    const types = W.whatsapp, prep = media?.mediaPrep, data = prep?.mediaData, edit = media?.mediaEditorData;
    if (typeof types.AttachMediaModel !== 'function' || !(media instanceof types.AttachMediaModel)
        || typeof types.MediaPrep !== 'function' || !(prep instanceof types.MediaPrep) || typeof prep.sendToChat !== 'function'
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
    const pdf = pdfOf(types, media, data), payload = snapshot(data, blob, pdf, types);
    const fingerprint = [prep, data, data.mediaBlob, blob, data.filehash, media.type, media.mimetype,
      media.filename, media.quality, media.file, media.editedFile, ...(pdf ? [pdf.preview, ...pdf.holders, ...pdf.blobs] : [])];
    return { media, data, prep, blob, holder: data.mediaBlob, edit, payload, pdf, fingerprint,
      caption: media.caption, preview: media.preview, fullPreview: media.fullPreview };
  }
  function equivalent(left, right) {
    return ['media', 'data', 'prep', 'blob', 'holder', 'edit', 'caption', 'preview', 'fullPreview']
      .every((key) => left[key] === right[key]) && same(left.fingerprint, right.fingerprint)
      && sameMetadata(left.payload, right.payload);
  }
  function receipt(W, item, chatId, output, expectedKey, result) {
    const types = W.whatsapp, msg = result?.msg, key = msg?.id;
    if (result?.messageSendResult !== 'OK' || typeof types.MsgModel !== 'function' || !(msg instanceof types.MsgModel)
        || typeof types.MsgKey !== 'function' || !(key instanceof types.MsgKey) || !expectedKey
        || key.toString() !== expectedKey || key._serialized !== expectedKey || key.fromMe !== true
        || !(key.remote instanceof types.Wid) || key.remote.toString() !== chatId || key.remote._serialized !== chatId
        || msg.type !== item.fingerprint[5] || (output === '' ? msg.caption != null && msg.caption !== '' : msg.caption !== output)
        || msg.filehash !== item.fingerprint[4] || msg.size !== item.blob.size
        || !Number.isFinite(msg.ack) || msg.ack < 1) throw issue('SEND_INTENT_RECEIPT_MISSING');
    return { id: expectedKey, ack: msg.ack };
  }
  async function preparePdf(types, item, check) {
    const owned = [];
    try {
      for (const blob of item.pdf.blobs) {
        const holder = await types.OpaqueData.createFromData(blob, blob.type);
        // Never release a factory result that aliases a source or prior holder.
        if (!(holder instanceof types.OpaqueData) || item.pdf.holders.includes(holder) || owned.includes(holder)
            || holder === item.holder || typeof holder.autorelease !== 'function') throw issue();
        owned.push(holder);
        if (blobOf(holder, types) !== blob) throw issue();
        check();
      }
      const [full, micro] = owned, payload = item.payload;
      return { full, micro, payload: { ...payload, fullPreviewData: full,
        documentPreview: { ...payload.documentPreview, fullPreviewData: full,
          microThumbnail: { ...payload.documentPreview.microThumbnail, opaqueData: micro } } } };
    } catch (error) { for (const holder of owned) holder.autorelease(); throw error; }
  }
  function send(W, item, chat, chatId, text, check) {
    let key = null, invalidKey = false;
    const types = W.whatsapp;
    const options = { caption: text, type: item.fingerprint[5], isViewOnce: false, addEvenWhilePreparing: false,
      onMsgKeyCreated(value) {
        const serialized = value?._serialized;
        if (key || typeof types.MsgKey !== 'function' || !(value instanceof types.MsgKey)
            || typeof serialized !== 'string' || serialized.length > 500 || /[\x00-\x20\x7f]/.test(serialized)
            || value.toString() !== serialized || value.fromMe !== true
            || !(value.remote instanceof types.Wid) || value.remote.toString() !== chatId) invalidKey = true;
        else key = serialized;
      } };
    const invoke = (payload, handoff = () => {}) => {
      const prepared = new types.MediaPrep(item.fingerprint[5], Promise.resolve(payload));
      if (!(prepared instanceof types.MediaPrep) || prepared === item.prep || prepared.baseType !== item.fingerprint[5]
          || !(prepared.mediaData instanceof types.MediaDataModel) || prepared.mediaData === item.data
          || typeof prepared.waitForPrep !== 'function' || typeof prepared.sendToChat !== 'function') throw issue();
      check(); handoff();
      return Promise.resolve(prepared.sendToChat({ chat, options }))
        .then((result) => receipt(W, item, chatId, text, invalidKey ? null : key, result));
    };
    if (!item.pdf) return invoke(item.payload);
    return preparePdf(types, item, check).then(async ({ payload, full, micro }) => {
      let invoked = false;
      try { return await invoke(payload, () => { invoked = true; }); }
      finally {
        // MediaObject adopts fullPreviewData without retain. Once invoked it
        // belongs to the platform, including uncertain/failed sends. The nested
        // UI micro-thumbnail is absent from MediaTypes.DOCUMENT upload fields.
        micro.autorelease();
        if (!invoked) full.autorelease();
      }
    });
  }
  return { read, equivalent, send };
}
