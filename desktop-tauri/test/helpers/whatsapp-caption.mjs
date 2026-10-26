import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { guest, tick } from './send-guest.mjs';

// Actual production MediaEditor/SendButton/WDSButton shapes. Production strips
// icon/button testids; only RichTextInput writes its testid onto the DOM.
export const sendPath = 'M4.4 19.43a.99.99 0 0 1-.95-.1.93.93 0 0 1-.45-.83V14l8-2-8-2V5.5c0-.37.15-.65.45-.84'
  + 'a1 1 0 0 1 .95-.09l15.4 6.5c.42.19.63.5.63.93 0 .43-.21.74-.63.93l-15.4 6.5Z';
export const viewOncePaths = [
  'M12 2a10 10 0 1 0 .16 20 1.11 1.11 0 1 0-.03-2.22A7.8 7.8 0 0 1 4.23 12a7.78 7.78 0 0 1 7.9-7.78'
    + 'A1.11 1.11 0 1 0 12.16 2H12Zm4.86 1.26a1.11 1.11 0 1 0-1.08 1.94l.22.13a1.11 1.11 0 1 0 1.14-1.9'
    + 'l-.28-.17Zm2.19 3.22a1.11 1.11 0 0 1 1.53.38l.16.28a1.11 1.11 0 0 1-1.94 1.08 7.86 7.86 0 0 0-.13-.22'
    + 'c-.31-.52-.14-1.2.38-1.52ZM22 11.84a1.11 1.11 0 1 0-2.22.03 7.8 7.8 0 0 1 0 .26 1.11 1.11 0 0 0 2.22.03'
    + ' 9.93 9.93 0 0 0 0-.32Zm-1.69 3.51c.54.3.73.97.43 1.5l-.16.3a1.11 1.11 0 1 1-1.9-1.15l.12-.22'
    + 'c.3-.54.98-.73 1.51-.43Zm-3.17 5.23a1.11 1.11 0 1 0-1.14-1.9l-.22.12a1.11 1.11 0 0 0 1.08 1.94l.28-.16Z',
  'M12 10.5v3.75a.73.73 0 0 0 .75.75.73.73 0 0 0 .75-.75v-4.5a.73.73 0 0 0-.75-.75h-1.5a.73.73 0 0 0-.75.75'
    + '.73.73 0 0 0 .75.75H12Z',
];

export function iconButton(document, title, paths, tag = 'div') {
  const button = document.createElement(tag); button.setAttribute('role', 'button'); button.setAttribute('tabindex', '0');
  button.setAttribute('aria-disabled', 'false');
  const svgElement = (name) => document.createElementNS
    ? document.createElementNS('http://www.w3.org/2000/svg', name) : document.createElement(name);
  const span = document.createElement('span'); const svg = svgElement('svg'); svg.setAttribute('viewBox', '0 0 24 24');
  const name = svgElement('title'); name.textContent = title; svg.append(name);
  for (const value of paths) {
    const path = svgElement('path'); path.setAttribute('d', value); svg.append(path);
  }
  span.append(svg); button.append(span); return button;
}

// processRawDocument preserves all PDF enrichment fields, including three
// OpaqueData references (the full thumbnail is shared at two schema paths).
function pdfMetadata(W, previewUrl) {
  const thumbUrl = 'data:image/jpeg;base64,cGRmLXRodW1ibmFpbA==';
  const fullPreviewData = new W.whatsapp.OpaqueData(new Blob(['pdf-thumbnail'], { type: 'image/jpeg' }));
  const microThumbnail = { opaqueData: new W.whatsapp.OpaqueData(new Blob(['pdf-micro'], { type: 'image/jpeg' })),
    width: 64, height: 48, dataUrl: 'data:image/jpeg;base64,cGRmLW1pY3Jv' };
  return { documentPreview: { url: previewUrl, thumbUrl, width: 640, height: 480, fullPreviewData,
    fullPreviewSize: { width: 640, height: 480 }, pdfPages: 1, microThumbnail },
    fullPreviewData, fullPreviewSize: { width: 640, height: 480 }, pageCount: 1,
    preview: microThumbnail.dataUrl.slice('data:image/jpeg;base64,'.length), isPasswordProtected: false };
}

export async function captionFixture({ type = 'image', caption = 'Please send 100 units tomorrow.', policy = {}, session } = {}) {
  const ui = guest({ policy, ...(session === undefined ? {} : { session }) });
  const { document } = ui;
  ui.window.Blob = Blob;
  ui.window.structuredClone = structuredClone;
  ui.window.HTMLImageElement = document.createElement('img').constructor;
  const events = new Map();
  const W = { ...ui.window.WPP,
    on(name, callback) {
      const list = events.get(name) || new Set(); list.add(callback); events.set(name, list);
      ui.state.handlers.set(name, (...args) => { for (const handler of [...list]) handler(...args); });
    },
    off(name, callback) { events.get(name)?.delete(callback); },
  };
  ui.window.WPP = W;
  const { ModelEvents, MsgKey, MsgModel } = W.whatsapp;
  const state = { calls: [], prepared: [], transport: null, receipt: null, mutateAfterAwait: null, digests: [], digest: null,
    opaqueCreated: [], createOpaque: null, releasePool: new Set() };
  ui.window.crypto = { subtle: { digest(algorithm, bytes) {
    const pending = state.digest ? state.digest(algorithm, bytes) : webcrypto.subtle.digest(algorithm, bytes);
    state.digests.push(pending); return pending;
  } } };
  class OpaqueData {
    constructor(blob) { this.blob = blob; this.released = false; this.references = 1; this.releaseCalls = 0; }
    getBlob() { return this.blob; }
    size() { return this.blob.size; }
    retain() { this.references += 1; }
    autorelease() { this.releaseCalls += 1; this.references -= 1; if (!this.references) state.releasePool.add(this); }
    static async createFromData(blob, type) {
      const holder = new OpaqueData(blob instanceof Blob && blob.type === type ? blob : new Blob([blob], { type }));
      state.opaqueCreated.push(holder); await state.createOpaque?.(holder); return holder;
    }
    static releaseAutoreleasePool() {
      for (const holder of state.releasePool) if (!holder.references) { holder.released = true; holder.blob = undefined; }
      state.releasePool.clear();
    }
  }
  class MediaDataModel extends ModelEvents {
    constructor(value = {}) { super(); for (const [key, item] of Object.entries(value)) this.field(key, item); }
    set(value) {
      for (const [key, item] of Object.entries(value)) {
        if (Object.hasOwn(this, key)) this[key] = item;
        else this.field(key, item);
      }
    }
    toJSON() { return Object.fromEntries(Object.keys(this).filter((key) => key !== 'handlers').map((key) => [key, this[key]])); }
  }
  class MediaPrep {
    constructor(baseType, pending) {
      this.baseType = baseType; this.mediaData = new MediaDataModel(); state.prepared.push(this);
      this.ready = Promise.resolve(pending).then((value) => { this.mediaData.set(value); });
    }
    async waitForPrep() { await this.ready; return this.mediaData; }
    sendToChat({ chat, options }) {
      const call = { prep: this, chat, options }; state.calls.push(call);
      if (state.transport) return state.transport(call);
      return (async () => {
        // The actual sender awaits before reading live mediaData; a detached
        // snapshot must survive original preview mutation at this boundary.
        await Promise.resolve();
        state.mutateAfterAwait?.(call);
        const data = await this.waitForPrep();
        const key = new MsgKey(`true_${chat.id}_CAPTION${state.calls.length}`);
        options.onMsgKeyCreated?.(key);
        const msg = new MsgModel(key, '', '');
        Object.assign(msg, { caption: options.caption, type: data.type, filehash: data.filehash, size: data.size, ack: 1 });
        const result = { messageSendResult: 'OK', msg };
        state.receipt?.(result, call); return result;
      })();
    }
  }
  class AttachMediaModel extends ModelEvents {
    canUndoMediaEditorData() { return false; }
    canRedoMediaEditorData() { return false; }
  }
  class Collection extends ModelEvents {
    constructor(media) {
      super(); this.models = [media]; this.active = media; this.isStickerMaker = false;
      this.selection = new ModelEvents(); this.selection.getVal = () => this.active;
      Object.defineProperty(this.selection, 'list', { get: () => this.models, configurable: true });
    }
    get length() { return this.models.length; }
    getModelsArray() { return [...this.models]; }
    getPreviewableMedias() { return [...this.models]; }
    get(id) { return this.models.find((item) => item.id === id); }
    getActive() { return this.active; }
    select(media) { this.active = media; this.emit('active-change', media); }
  }
  Object.assign(W.whatsapp, { OpaqueData, MediaDataModel, MediaPrep, AttachMediaModel });
  const mime = { image: 'image/png', video: 'video/mp4', document: 'application/pdf' }[type];
  const bytes = 'Synthetic immutable attachment payload';
  const blob = new Blob([bytes], { type: mime }); const holder = new OpaqueData(blob);
  const previewUrl = `blob:https://web.whatsapp.com/${randomUUID()}`;
  const data = { type, mediaBlob: holder, size: blob.size, mimetype: mime,
    filehash: createHash('sha256').update(bytes).digest('base64'), filename: `fixture.${type}`,
    mediaStage: 'resolved', isViewOnce: false, isGif: false,
    ...(type === 'document' ? pdfMetadata(W, previewUrl) : {}) };
  const prep = new MediaPrep(type, Promise.resolve(data)); await prep.waitForPrep();
  const background = document.createElement('img'); background.src = previewUrl;
  const media = new AttachMediaModel();
  for (const [key, value] of Object.entries({ id: 'attachment-1', state: 'ready', type, mediaPrep: prep, caption,
    file: holder, editedFile: holder, filename: data.filename, mimetype: mime, quality: 'Standard',
    originalAttachment: Promise.resolve({ file: blob }), fullPreview: previewUrl,
    preview: type === 'image' ? previewUrl : type === 'document' ? data.documentPreview.thumbUrl : 'c3ludGhldGlj',
    documentPageCount: type === 'document' ? 1 : null,
    fullPreviewSize: { width: 640, height: 480 },
    mediaEditorData: { hasEdits: () => false, getSending: () => false, getBackground: () => ({ getImage: () => background }) },
    isGif: false, stickerMaker: false, isVcardOverMmsDocument: false })) media.field(key, value);
  if (type === 'video') prep.mediaData.field('preview', media.preview);
  const collection = new Collection(media); const chat = ui.model(ui.state.chatId); chat.attachMediaContents = collection;
  const drawer = document.createElement('div'); drawer.className = 'copyable-area'; document.body.append(drawer);
  const panel = document.createElement('div'); drawer.append(panel);
  const previewRegion = document.createElement('div');
  if (type === 'image') previewRegion.setAttribute('data-testid', 'media-editor-canvas');
  else previewRegion.setAttribute(type === 'video' ? 'data-animate-attach-media' : 'data-js-attach-preview', 'true');
  const preview = document.createElement(type === 'video' ? 'video' : 'img');
  preview.setAttribute('src', previewUrl); preview.src = previewUrl; preview.complete = true;
  preview.currentSrc = previewUrl; preview.srcObject = null;
  previewRegion.append(preview); panel.append(previewRegion);
  const editor = document.createElement('div'); editor.setAttribute('contenteditable', 'true');
  editor.setAttribute('role', 'textbox'); editor.setAttribute('data-testid', 'media-caption-input-container');
  const paragraph = document.createElement('p'); const content = document.createElement('span');
  content.setAttribute('data-lexical-text', 'true'); content.textContent = caption;
  paragraph.append(content); editor.append(paragraph); panel.append(editor);
  const file = document.createElement('input'); file.setAttribute('type', 'file'); file.hidden = true; drawer.append(file);
  const toggle = type === 'document' ? null : iconButton(document, 'wds-ic-view-once', viewOncePaths, 'button');
  if (toggle) { toggle.setAttribute('aria-pressed', 'false'); drawer.append(toggle); }
  const button = iconButton(document, 'ic-send-filled', [sendPath]); drawer.append(button);
  const click = (values = {}) => document.fire('click', { target: button, ...values });
  const enter = (values = {}) => document.fire('keydown', { key: 'Enter', target: editor, ...values });
  const input = async (text, { trusted = true } = {}) => {
    document.fire('beforeinput', { target: editor, isTrusted: trusted });
    content.textContent = text; media.caption = text;
    document.fire('input', { target: editor, isTrusted: trusted }); await tick();
  };
  await tick(); ui.configure();
  return { ui, W, state, chat, media, collection, prep, data: prep.mediaData, blob, holder,
    drawer, panel, preview, previewRegion, previewUrl, background, editor, content, paragraph, button, file, toggle, click, enter, input };
}

export async function captionBatchFixture({ types = ['image', 'image'], selected = 0, ...options } = {}) {
  const c = await captionFixture({ ...options, type: types[selected] });
  const { W, ui } = c, { document } = ui;
  const members = [];
  for (let index = 0; index < types.length; index += 1) {
    if (index === selected) { members.push(c); continue; }
    const type = types[index], mime = { image: 'image/png', video: 'video/mp4', document: 'application/pdf' }[type];
    const bytes = `Distinct synthetic attachment ${index}`;
    const blob = new Blob([bytes], { type: mime }), holder = new W.whatsapp.OpaqueData(blob);
    const previewUrl = `blob:https://web.whatsapp.com/${randomUUID()}`;
    const prep = new W.whatsapp.MediaPrep(type, Promise.resolve({ type, mediaBlob: holder, size: blob.size, mimetype: mime,
      filehash: createHash('sha256').update(bytes).digest('base64'), filename: `batch-${index}.${type}`,
      mediaStage: 'resolved', isViewOnce: false, isGif: false, ...(type === 'video' ? { preview: 'c3ludGhldGlj' } : {}),
      ...(type === 'document' ? pdfMetadata(W, previewUrl) : {}) }));
    await prep.waitForPrep();
    const background = document.createElement('img'); background.src = previewUrl;
    const media = new W.whatsapp.AttachMediaModel();
    for (const [key, value] of Object.entries({ id: `batch-${index}`, state: 'ready', type, mediaPrep: prep, caption: '',
      file: holder, editedFile: holder, filename: prep.mediaData.filename, mimetype: mime, quality: 'Standard',
      originalAttachment: Promise.resolve({ file: blob }), fullPreview: previewUrl,
      preview: type === 'image' ? previewUrl : type === 'document' ? prep.mediaData.documentPreview.thumbUrl : 'c3ludGhldGlj',
      documentPageCount: type === 'document' ? 1 : null, fullPreviewSize: { width: 640, height: 480 },
      mediaEditorData: { hasEdits: () => false, getSending: () => false, getBackground: () => ({ getImage: () => background }) },
      isGif: false, stickerMaker: false, isVcardOverMmsDocument: false })) media.field(key, value);
    members.push({ media, prep, data: prep.mediaData, blob, holder, previewUrl, background });
  }
  c.collection.models = members.map((member) => member.media);
  const tablist = document.createElement('div'); tablist.setAttribute('role', 'tablist');
  const tabs = [], thumbs = [];
  members.forEach((member, index) => {
    const tab = document.createElement('div'); tab.setAttribute('role', 'tab'); tab.setAttribute('tabindex', '0');
    tab.setAttribute('aria-posinset', index + 1); tab.setAttribute('aria-setsize', members.length);
    tab.setAttribute('aria-selected', index === selected);
    const image = document.createElement('img');
    const src = member.media.type === 'image' ? member.media.preview
      : member.media.type === 'document' ? member.media.fullPreview : `data:image/jpeg;base64,${member.media.preview}`;
    image.src = src; image.setAttribute('src', src); image.complete = true;
    tab.append(image); tablist.append(tab); tabs.push(tab); thumbs.push(image);
  });
  c.drawer.append(tablist); c.drawer.append(c.button);
  if (c.toggle) { c.toggle.setAttribute('aria-disabled', 'true'); c.toggle.style.visibility = 'hidden'; }
  await tick();
  return { ...c, members, tablist, tabs, thumbs, selected };
}

export async function settle() {
  for (let index = 0; index < 8; index += 1) await tick();
}
