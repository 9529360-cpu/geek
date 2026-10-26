// Finite Telegram K media projection. See TELEGRAM-K-SEND-CONTRACT.md for the
// pinned production methods, draft invariant and exact pending/final receipt.
function createTelegramAttachmentRuntime(runtime) {
  const tickets = new WeakMap();
  const fail = () => runtime.issue('CAPABILITY_UNAVAILABLE');
  const longId = (value) => (typeof value === 'string' || Number.isSafeInteger(value))
    && /^-?[1-9]\d{0,19}$/.test(String(value));
  const uuid = (value) => typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  function validate(files, caption) {
    if (!Array.isArray(files) || !files.length || files.length > 10 || !runtime.captionValid(caption)) throw fail();
    const ids = new Set();
    let total = 0;
    for (const file of files) {
      if (!file || !uuid(file.id) || ids.has(file.id) || typeof file.name !== 'string'
          || !file.name.trim() || ['.', '..'].includes(file.name) || file.name.length > 255
          || /[\\/:\u0000-\u001f\u007f]/.test(file.name)
          || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 512 * 1024 * 1024
          || typeof file.mime !== 'string' || file.mime.length > 100 || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(file.mime)
          || !['image', 'video', 'document'].includes(file.kind)
          || (file.kind === 'image' && !['image/jpeg', 'image/png'].includes(file.mime))
          || (file.kind === 'video' && file.mime !== 'video/mp4')) throw fail();
      if ((total += file.size) > 1024 * 1024 * 1024) throw fail();
      ids.add(file.id);
    }
  }
  async function prepare(request) {
    validate(request.attachments, request.message);
    const files = request.attachments.map(({ id, name, size, mime, kind }) => Object.freeze({ id, name, size, mime, kind }));
    const binding = await runtime.prepareAttachments(request.targetId.slice(3), request.message,
      [...new Set(files.map((file) => file.kind))]);
    const ticket = {};
    tickets.set(ticket, { ...binding, files, next: 0, busy: false, failed: false, finished: false, effects: false, lastReceipt: '' });
    return ticket;
  }
  function release(snapshot, media) {
    if (!media) return;
    try { Promise.resolve(snapshot.managers.appMessagesManager.releaseTemporaryMediaCache(media)).catch(() => {}); } catch {}
  }
  // Read dimensions from the actual immutable file, never its name or caller
  // supplied JSON. This avoids allocating decoded photo pixels just to inspect
  // the header; Telegram owns the eventual upload validation/transcoding.
  async function imageDimensions(file, state, valid, deadline) {
    const buffer = await runtime.wait(() => file.slice(0, 1024 * 1024).arrayBuffer(), state.snapshot, valid, deadline);
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let width = 0, height = 0;
    if (file.type === 'image/png') {
      if (bytes.length < 33 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a
          || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) throw fail();
      width = view.getUint32(16); height = view.getUint32(20);
    } else {
      if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw fail();
      let offset = 2;
      while (offset + 4 <= bytes.length) {
        if (bytes[offset++] !== 0xff) throw fail();
        while (bytes[offset] === 0xff) offset += 1;
        const marker = bytes[offset++];
        if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
        const length = view.getUint16(offset);
        if (length < 2 || offset + length > bytes.length) break;
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          if (length < 8) throw fail();
          height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break;
        }
        offset += length;
      }
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
        || width > 32768 || height > 32768) throw fail();
    return { width, height };
  }
  async function videoDimensions(file, state, valid, deadline) {
    const video = document.createElement('video');
    let url;
    try {
      url = URL.createObjectURL(file);
      const loaded = new Promise((resolve, reject) => {
        video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
        video.onerror = () => reject(fail());
        video.preload = 'metadata'; video.muted = true; video.src = url;
        video.load();
      });
      const value = await runtime.wait(() => loaded, state.snapshot, valid, deadline);
      if (!Number.isInteger(value.width) || value.width < 1 || value.width > 32768
          || !Number.isInteger(value.height) || value.height < 1 || value.height > 32768
          || !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > 31536000) throw fail();
      return { width: value.width, height: value.height, duration: Math.floor(value.duration) };
    } finally {
      video.onloadedmetadata = null; video.onerror = null;
      try { video.pause(); video.removeAttribute('src'); video.load(); } catch {}
      if (url) URL.revokeObjectURL(url);
    }
  }
  function mediaProjection(meta, file, dimensions, tempId) {
    const expected = file.kind === 'image' ? 'photo' : file.kind;
    if (!meta || meta.attachType !== expected || meta.fileType !== file.mime
        || typeof meta.apiFileName !== 'string' || !meta.apiFileName || meta.apiFileName.length > 255
        || /[\\/:\u0000-\u001f\u007f]/.test(meta.apiFileName)
        || !Array.isArray(meta.attributes) || meta.attributes.length > 8) throw fail();
    if (expected === 'photo') {
      if (meta.photo?._ !== 'photo' || String(meta.photo.id) !== String(tempId)
          || !Array.isArray(meta.photo.sizes) || meta.photo.sizes.length > 4) throw fail();
      return { media: { _: 'messageMediaPhoto', pFlags: {}, photo: meta.photo }, attributes: meta.attributes,
        actionName: 'sendMessageUploadPhotoAction' };
    }
    const filename = meta.attributes.find((attribute) => attribute?._ === 'documentAttributeFilename');
    if (filename?.file_name !== file.name || meta.document?._ !== 'document'
        || String(meta.document.id) !== String(tempId) || meta.document.size !== file.size
        || meta.document.mime_type !== file.mime) throw fail();
    // A file stays a file, including WebP/GIF/audio classified as document by
    // native selection. Do not carry media/audio/sticker attributes into it.
    const attributes = [{ _: 'documentAttributeFilename', file_name: file.name }];
    if (expected === 'video') {
      const video = meta.attributes.find((attribute) => attribute?._ === 'documentAttributeVideo');
      if (!video || video.w !== dimensions.width || video.h !== dimensions.height
          || video.duration !== dimensions.duration || video.pFlags?.round_message) throw fail();
      attributes.unshift({ _: 'documentAttributeVideo', w: video.w, h: video.h, duration: video.duration,
        pFlags: { supports_streaming: true } });
    }
    const document = { _: 'document', id: String(tempId), mime_type: file.mime, size: file.size, attributes, thumbs: [] };
    return { media: { _: 'messageMediaDocument', pFlags: {}, document }, attributes,
      actionName: expected === 'video' ? 'sendMessageUploadVideoAction' : 'sendMessageUploadDocumentAction' };
  }
  function mediaReceipt(file, pending) {
    const type = file.kind === 'image' ? 'messageMediaPhoto' : 'messageMediaDocument';
    const model = (media) => type === 'messageMediaPhoto' ? media?.photo : media?.document;
    const shape = (media) => media?._ === type && !media.ttl_seconds && !media.pFlags?.spoiler
      && !media.extended_media && !(type === 'messageMediaPhoto' ? media.document || media.video : media.photo);
    const final = (media) => {
      if (!shape(media)) return false;
      const item = model(media);
      if (item?._ !== (file.kind === 'image' ? 'photo' : 'document') || !longId(item.id)) return false;
      if (file.kind === 'image') return true;
      if (item.mime_type !== file.mime || item.size !== file.size || !Array.isArray(item.attributes)
          || item.attributes.length > 16) return false;
      const names = item.attributes.filter((attribute) => attribute?._ === 'documentAttributeFilename');
      if (names.length !== 1 || names[0].file_name !== file.name) return false;
      if (item.attributes.some((attribute) => ['documentAttributeSticker', 'documentAttributeCustomEmoji',
        'documentAttributeAnimated'].includes(attribute?._))) return false;
      const videos = item.attributes.filter((attribute) => attribute?._ === 'documentAttributeVideo');
      const audio = item.attributes.some((attribute) => attribute?._ === 'documentAttributeAudio');
      return !audio && (file.kind === 'video'
        ? videos.length === 1 && !videos[0].pFlags?.round_message : videos.length === 0);
    };
    return {
      pending: (media) => shape(media) && String(model(media)?.id) === String(model(pending)?.id),
      final,
      same: (left, right) => String(model(left)?.id) === String(model(right)?.id),
    };
  }
  function uploadedProjection(value, meta, projection, file) {
    const type = file.kind === 'image' ? 'inputMediaUploadedPhoto' : 'inputMediaUploadedDocument';
    const uploaded = value?.file;
    if (value?._ !== type || !['inputFile', 'inputFileBig'].includes(uploaded?._)
        || !longId(uploaded.id) || !Number.isSafeInteger(uploaded.parts) || uploaded.parts < 1 || uploaded.parts > 20000
        || uploaded.name !== meta.apiFileName || value.ttl_seconds || value.stickers || value.thumb || value.video_cover) throw fail();
    const inputFile = { _: uploaded._, id: uploaded.id, parts: uploaded.parts, name: uploaded.name };
    if (uploaded._ === 'inputFile') inputFile.md5_checksum = '';
    if (file.kind === 'image') return { _: type, file: inputFile, pFlags: {} };
    if (value.mime_type !== file.mime) throw fail();
    return { _: type, file: inputFile, mime_type: file.mime, attributes: projection.attributes,
      pFlags: { force_file: file.kind === 'document' || undefined } };
  }
  async function send(ticket, file, index, valid) {
    const state = tickets.get(ticket);
    if (!state || state.failed || state.finished || state.busy || index !== state.next) {
      throw runtime.issue('NOT_SUBMITTED', state?.effects === true);
    }
    state.busy = true;
    const metadata = state.files[index];
    const { snapshot, id } = state;
    const caption = index === state.files.length - 1 ? state.text : '';
    const deadline = performance.now() + 300000;
    const phaseDeadline = () => Math.min(deadline, performance.now() + 12000);
    let uploaded = false, invoked = false, staged = false, closed = false;
    let message = null, receipt = null, media = null, upload = null, uploadName = null;
    try {
      if (!metadata || !(file instanceof File) || file.name !== metadata.name || file.type !== metadata.mime
          || file.size !== metadata.size) throw fail();
      await runtime.verifyAttachment(state, metadata.kind, state.text, valid, phaseDeadline());
      const dimensions = metadata.kind === 'image' ? await imageDimensions(file, state, valid, phaseDeadline())
        : metadata.kind === 'video' ? await videoDimensions(file, state, valid, phaseDeadline()) : {};
      message = await runtime.wait(() => snapshot.managers.appMessagesManager.generateOutgoingMessage(id, {}),
        snapshot, valid, phaseDeadline());
      if (!validTelegramPending(message, id, snapshot.self)) throw fail();
      const tempId = message.id;
      const making = Promise.resolve(snapshot.managers.appMessagesManager.makeDocumentAndMetaForSendingFile({
        file, isDocument: false, mediaTempId: tempId, isMedia: metadata.kind !== 'document',
        forceFile: metadata.kind === 'document', ...dimensions,
      })).then((value) => {
        if (closed) release(snapshot, value?.photo ? { _: 'messageMediaPhoto', photo: value.photo }
          : { _: 'messageMediaDocument', document: value?.document });
        return value;
      });
      const meta = await runtime.wait(() => making, snapshot, valid, phaseDeadline());
      // Keep the original media identity for cleanup even if its projection is rejected.
      media = meta?.photo ? { _: 'messageMediaPhoto', photo: meta.photo }
        : { _: 'messageMediaDocument', document: meta?.document };
      const projection = mediaProjection(meta, metadata, dimensions, tempId);
      media = projection.media;
      runtime.check(snapshot, valid);
      uploadName = `geek-${crypto.randomUUID()}`;
      uploaded = true; // Upload itself is an external effect; never auto-replay it.
      state.effects = true;
      upload = Promise.resolve(snapshot.managers.appMessagesManager.uploadMediaFile({
        peerId: id, file, uploadingFileName: uploadName, fileType: metadata.mime,
        apiFileName: meta.apiFileName, attachType: meta.attachType,
        attributes: projection.attributes, actionName: projection.actionName,
      })).then((value) => ({ value }), () => ({ failed: true }));
      const uploadResult = await runtime.wait(() => upload, snapshot, valid, deadline);
      if (uploadResult.failed) throw runtime.issue('RUNTIME_FAILED', true);
      const inputMedia = uploadedProjection(uploadResult.value, meta, projection, metadata);
      const inputPeer = await runtime.verifyAttachment(state, metadata.kind, state.text, valid, phaseDeadline());
      message = { _: 'message', id: tempId, random_id: message.random_id, date: message.date,
        from_id: { _: 'peerUser', user_id: snapshot.self }, peer_id: { ...message.peer_id },
        pFlags: { out: true }, pending: true, message: caption, entities: [], media };
      const expectedMedia = mediaReceipt(metadata, media);
      receipt = createTelegramSendReceipt(snapshot, message, id, caption, () => {
        runtime.check(snapshot, valid);
        if (performance.now() >= deadline) throw runtime.issue('TIMED_OUT', true);
      }, expectedMedia);
      runtime.check(snapshot, valid);
      staged = true;
      snapshot.proxy.invokeVoid('manager', { name: 'appMessagesManager', method: 'beforeMessageSending',
        args: [message, { sequential: true, clearDraft: false }], accountNumber: snapshot.account });
      await receipt.pending();
      runtime.check(snapshot, valid); runtime.readPeer(snapshot, id);
      invoked = true;
      const work = snapshot.managers.apiManager.invokeApiAfter('messages.sendMedia', {
        peer: inputPeer, media: inputMedia, message: caption, random_id: message.random_id, entities: [], clear_draft: false,
      }, { noErrorBox: true, rawError: true, ignoreErrors: true });
      Promise.resolve(work).then((updates) => applyTelegramSendUpdates(snapshot.managers, message, updates, expectedMedia))
        .catch(() => receipt.failed());
      const result = await receipt.confirmed();
      state.next += 1; state.lastReceipt = result.id;
      return result;
    } catch (error) {
      state.failed = true;
      if (uploadName) {
        try { Promise.resolve(snapshot.managers.apiFileManager.cancelDownload(uploadName)).catch(() => {}); } catch {}
      }
      if (staged && !invoked && message) {
        try { Promise.resolve(snapshot.managers.appMessagesManager.cancelPendingMessage(message.random_id)).catch(() => {}); } catch {}
      }
      // The shared transfer slot stays busy until the platform's actual upload
      // settles. A lost cancellation reply cannot open a second File/upload.
      if (upload) await upload;
      const code = ['ACCOUNT_UNAVAILABLE', 'CANCELLED', 'TIMED_OUT', 'TARGET_CHANGED',
        'CAPABILITY_UNAVAILABLE', 'RECEIPT_MISSING'].includes(error?.code) ? error.code : 'RUNTIME_FAILED';
      throw runtime.issue(code, uploaded || invoked);
    } finally {
      closed = true; state.busy = false; receipt?.dispose(); release(snapshot, media);
    }
  }
  function complete(ticket, receipt) {
    const state = tickets.get(ticket);
    if (!state || state.finished || state.failed || state.busy || state.next !== state.files.length
        || !receipt || receipt !== state.lastReceipt) throw runtime.issue('NOT_SUBMITTED', state?.effects === true);
    state.finished = true;
    return receipt;
  }
  return { validate, prepare, send, complete };
}
