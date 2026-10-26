import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { guest } from './send-guest.mjs';

const source = readFileSync(new URL('../../guest/whatsapp-reply-context.js', import.meta.url), 'utf8');
const create = runInNewContext(`${source}\ncreateWhatsAppReplyContext`, { TextEncoder });
export const previewUrl = 'blob:https://web.whatsapp.com/00000000-0000-4000-8000-000000000031';

// Explicit doubles for the pinned MediaDataModel and OpaqueData read-only ports.
class Events {
  constructor() { this.handlers = new Map(); }
  on(name, callback) {
    const handlers = this.handlers.get(name) || new Set(); handlers.add(callback); this.handlers.set(name, handlers);
  }
  off(name, callback) { this.handlers.get(name)?.delete(callback); }
  field(name, initial) {
    let value = initial;
    Object.defineProperty(this, name, { enumerable: true, configurable: true, get: () => value,
      set: (next) => { if (value === next) return; value = next;
        for (const callback of [...this.handlers.get(`change:${name}`) || []]) callback(this, next);
      },
    });
  }
}
export class Preview {
  constructor({ url = previewUrl, size = 1024, type = 'image/jpeg' } = {}) {
    this.released = false; this.previewUrl = url; this.previewSize = size; this.previewType = type;
  }
  url() { return this.previewUrl; }
  size() { return this.previewSize; }
  type() { return this.previewType; }
  getBase64() { throw new Error('The read-only reply adapter must not copy media bytes'); }
  filepath() { throw new Error('The read-only reply adapter must not read paths'); }
}
export class Media extends Events {
  constructor({ preview = new Preview(), type = 'image', mimetype = 'image/jpeg' } = {}) {
    super(); this.field('preview', preview); this.field('type', type); this.field('mimetype', mimetype);
    this.field('isViewOnce', false); this.field('filehash', 'synthetic-known-media-hash');
  }
}

export function mediaReply({ type = 'image', caption = 'The ordered blue product.', byKey = false } = {}) {
  const ui = guest();
  Object.assign(ui.window.WPP.whatsapp, { MediaDataModel: Media, OpaqueData: Preview });
  const reply = ui.reply({ body: 'Synthetic thumbnail body, not the caption.', byKey });
  const model = reply.message;
  const mimetype = type === 'video' ? 'video/mp4' : 'image/jpeg';
  model.type = type; model.field('isMedia', true); model.field('isViewOnce', false);
  model.field('caption', caption); model.field('mimetype', mimetype);
  model.field('filehash', 'synthetic-known-media-hash');
  model.field('mediaData', new Media({ type, mimetype }));
  reply.body.textContent = caption;
  const image = ui.document.createElement('img'); image.setAttribute('src', previewUrl); image.setAttribute('alt', '');
  reply.banner.append(image);
  const value = () => ({ W: ui.window.WPP, chat: ui.model(ui.state.chatId), chatId: ui.state.chatId,
    footer: ui.footer, editor: ui.editor });
  const adapter = create({
    normalize: (text) => String(text || '').replace(/\r\n?/g, '\n').replace(/\u200b/g, '').trim(),
    visible: (node) => Boolean(node?.isConnected && node.getClientRects().length && !node.hidden),
    issue: () => Object.assign(new Error('SEND_INTENT_UNSUPPORTED'), { code: 'SEND_INTENT_UNSUPPORTED' }),
  });
  return { ui, reply, model, image, value, adapter, read: () => adapter.read(value(), model) };
}
