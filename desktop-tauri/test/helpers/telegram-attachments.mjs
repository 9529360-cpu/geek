// Offline worker projections from tweb 654ffd809aa402f31357db2a13c462b4e5b69a23:
// appMessagesManager makeDocumentAndMetaForSendingFile/uploadMediaFile/finalizer,
// apiFileManager cancelDownload, and the TL messages.sendMedia Updates result.
// The production adapter/receipt/opaque transfer remain the actual source.
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { createRequire } from 'node:module';
import { telegramFixture } from './telegram-send.mjs';

const { compose } = createRequire(import.meta.url)('../../scripts/prepare-platform.cjs');
export const generation = '00000000-0000-4000-8000-000000000001';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1cAAAAASUVORK5CYII=', 'base64');
export function attachment(kind = 'document', overrides = {}) {
  const mime = kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'application/pdf';
  const name = kind === 'image' ? 'photo.png' : kind === 'video' ? 'clip.mp4' : 'report.pdf';
  const bytes = overrides.bytes || (kind === 'image' ? png : Buffer.from('offline attachment bytes'));
  const file = new File([bytes], overrides.name || name, { type: overrides.mime || mime });
  return { file, bytes, metadata: { id: '10000000-0000-4000-8000-000000000001',
    name: file.name, mime: file.type, size: file.size, kind, ...overrides.metadata } };
}
export function uploadedMedia(args) {
  const file = { _: 'inputFile', id: '900001', parts: 1, name: args.apiFileName, md5_checksum: '' };
  return args.attachType === 'photo' ? { _: 'inputMediaUploadedPhoto', file, pFlags: {} }
    : { _: 'inputMediaUploadedDocument', file, mime_type: args.fileType,
      attributes: args.attributes, pFlags: { force_file: args.actionName === 'sendMessageUploadDocumentAction' || undefined } };
}
export function finalMedia(pending, id = '910001') {
  if (pending.media._ === 'messageMediaPhoto') {
    return { _: 'messageMediaPhoto', pFlags: {}, photo: { _: 'photo', id, access_hash: '900002',
      file_reference: new Uint8Array([1]), sizes: [{ _: 'photoSize', type: 'x', w: 1, h: 1, size: 68 }] } };
  }
  return { _: 'messageMediaDocument', pFlags: {}, document: { _: 'document', id, access_hash: '900002',
    file_reference: new Uint8Array([1]), mime_type: pending.media.document.mime_type, size: pending.media.document.size,
    attributes: structuredClone(pending.media.document.attributes), thumbs: [] } };
}

export function attachmentFixture({ bridge = false } = {}) {
  const f = telegramFixture({ install: !bridge });
  const state = f.state;
  Object.assign(state, { uploads: [], mediaModels: [], mediaReleases: [], uploadCancels: [], rights: [],
    captionLimit: 1024, allowedRights: {}, mediaMode: 'updates', videoReleases: [], urls: [], revokedUrls: [] });
  const originalFactory = f.window.createProxiedManagersForAccount;
  const extended = new Set();
  f.window.createProxiedManagersForAccount = (account) => {
    const managers = originalFactory(account);
    if (extended.has(account)) return managers;
    extended.add(account);
    managers.apiManager.getLimit = async (key) => {
      assert.equal(key, 'caption');
      if (state.captionGate) await state.captionGate.promise;
      return state.captionLimit;
    };
    managers.appMessagesManager.canSendToPeer = async (peer, thread, action) => {
      state.rights.push({ account, peer, thread, action });
      return state.allowedRights[action] ?? state.allowed;
    };
    managers.appMessagesManager.makeDocumentAndMetaForSendingFile = async (args) => {
      state.mediaModels.push({ account, args });
      if (state.modelGate) await state.modelGate.promise;
      if (state.modelError) throw new Error('platform-private-message');
      const photo = args.isMedia && ['image/jpeg', 'image/png'].includes(args.file.type);
      const video = args.isMedia && args.file.type === 'video/mp4';
      const attributes = [{ _: 'documentAttributeFilename', file_name: args.file.name }];
      if (video) attributes.unshift({ _: 'documentAttributeVideo', duration: args.duration, w: args.width, h: args.height,
        pFlags: { supports_streaming: true } });
      return { attachType: photo ? 'photo' : video ? 'video' : 'document', fileType: args.file.type,
        apiFileName: photo ? `photo.${args.file.type.split('/')[1]}` : video ? 'video.mp4'
          : `document.${args.file.type.split('/')[1]}`, attributes,
        photo: photo ? { _: 'photo', id: String(args.mediaTempId),
          sizes: [{ _: 'photoSize', w: args.width, h: args.height, type: 'x', size: args.file.size }] } : undefined,
        document: photo ? undefined : { _: 'document', id: String(args.mediaTempId),
          mime_type: args.file.type, size: args.file.size, attributes, thumbs: [] }, ...state.modelOverride };
    };
    managers.appMessagesManager.releaseTemporaryMediaCache = async (media) => {
      state.mediaReleases.push({ account, media: structuredClone(media) });
    };
    managers.appMessagesManager.uploadMediaFile = (args) => {
      state.uploads.push({ account, args });
      if (state.uploadThrow) throw new Error('private upload error');
      if (state.uploadGate) return state.uploadGate.promise;
      if (state.uploadError) return Promise.reject(new Error('private upload error'));
      return Promise.resolve(state.uploadResult || uploadedMedia(args));
    };
    managers.apiFileManager = { cancelDownload: async (name) => {
      state.uploadCancels.push({ account, name });
      if (state.cancelSettles) state.uploadGate?.reject(new Error('UPLOAD_CANCELED'));
      return true;
    } };
    const invoke = managers.apiManager.invokeApiAfter;
    managers.apiManager.invokeApiAfter = (method, params, options) => {
      if (method !== 'messages.sendMedia') return invoke(method, params, options);
      state.sends.push({ account, method, params: structuredClone(params), options: structuredClone(options) });
      if (state.apiThrow) throw new Error('private send error');
      if (state.apiGate) return state.apiGate.promise;
      if (state.mediaMode === 'error') return Promise.reject(new Error('private send error'));
      if (state.mediaMode === 'never') return new Promise(() => {});
      if (state.mediaMode === 'void') return Promise.resolve(undefined);
      const pending = state.pending.get(params.random_id);
      const media = finalMedia(pending);
      if (state.mediaMode === 'short') return Promise.resolve({ _: 'updateShortSentMessage', id: state.final,
        date: 5, pFlags: { out: true }, pts: 1, pts_count: 1, media });
      return Promise.resolve({ _: 'updates', users: [], chats: [], date: 5, seq: 1, updates: [
        { _: 'updateMessageID', id: state.final, random_id: params.random_id },
        { _: pending.peer_id._ === 'peerChannel' ? 'updateNewChannelMessage' : 'updateNewMessage', pts: 1, pts_count: 1,
          message: { ...structuredClone(pending), id: state.final, media } },
      ] });
    };
    const localUpdate = managers.apiUpdatesManager.processLocalUpdate;
    managers.apiUpdatesManager.processLocalUpdate = async (update) => {
      if (!update.message?.media) return localUpdate(update);
      state.updates.push({ account, update: structuredClone(update) });
      const pending = state.pending.get(state.byServerId.get(update.message.id));
      if (pending && !state.noAck) f.emitFinal(pending, { id: update.message.id, media: update.message.media });
    };
    const processUpdates = managers.apiUpdatesManager.processUpdateMessage;
    managers.apiUpdatesManager.processUpdateMessage = async (updates) => {
      const final = updates.updates.find((item) => item.message?.media);
      if (!final) return processUpdates(updates);
      state.updates.push({ account, update: structuredClone(updates) });
      const mapping = updates.updates.find((item) => item._ === 'updateMessageID' && item.id === final.message.id);
      const pending = state.pending.get(mapping?.random_id);
      if (pending && !state.noAck) f.emitFinal(pending, { id: final.message.id, media: final.message.media });
    };
    return managers;
  };
  // Only the browser media decoder is a port double here. Node cases do not
  // claim real codec/HTMLVideoElement or real Telegram account acceptance.
  const createElement = f.document.createElement;
  f.document.createElement = (tag) => {
    if (tag !== 'video') return createElement(tag);
    const video = { src: '', videoWidth: 320, videoHeight: 240, duration: 4.8, ...state.videoMetadata,
      load() {
        if (!this.src) return;
        queueMicrotask(() => {
          if (!state.videoNever) (state.videoError ? this.onerror : this.onloadedmetadata)?.();
        });
      },
      pause() { state.videoReleases.push('pause'); },
      removeAttribute(name) { if (name === 'src') this.src = ''; },
    };
    return video;
  };
  f.context.URL = class extends URL {
    static createObjectURL(file) { const url = URL.createObjectURL(file); state.urls.push(url); return url; }
    static revokeObjectURL(url) { state.revokedUrls.push(url); URL.revokeObjectURL(url); }
  };
  if (bridge) {
    f.context.atob = atob; f.context.btoa = btoa;
    f.run(compose());
  }
  const api = f.window.__geekTauriPlatform;
  if (bridge) assert.equal(api.bind(generation), true);
  const start = (operation, payload, timeoutMs = 35000) => {
    const id = f.window.crypto.randomUUID();
    assert.equal(api.begin({ id, generation, platformId: 'telegram-k', operation, payload, timeoutMs }), true);
    return { id, read: () => api.read(generation, id), cancel: () => api.cancel(generation, id) };
  };
  async function result(call) {
    await f.until(() => call.read()?.pending === false);
    return JSON.parse(JSON.stringify(call.read()));
  }
  function transfer(request, operation, index = 0, fields = {}) {
    return api.attachment(generation, request.attemptId, { operation, index, ...fields });
  }
  async function upload(request, selected, index = 0) {
    assert.equal(transfer(request, 'start', index), true);
    const bytes = Buffer.from(await selected.file.arrayBuffer());
    for (let offset = 0; offset < bytes.length; offset += 512 * 1024) {
      assert.equal(transfer(request, 'chunk', index,
        { offset, data: bytes.subarray(offset, offset + 512 * 1024).toString('base64') }), true);
    }
    assert.equal(transfer(request, 'seal', index), true);
  }
  return { ...f, api, start, result, transfer, upload,
    draft: (selected, fields = {}) => f.request({ attemptId: f.window.crypto.randomUUID(),
      attachments: selected.map((item) => item.metadata), ...fields }),
    emitMedia: (pending, overrides = {}) => f.emitFinal(pending, { media: finalMedia(pending), ...overrides }),
  };
}
