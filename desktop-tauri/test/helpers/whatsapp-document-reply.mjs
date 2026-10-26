import { guest } from './send-guest.mjs';
import { mentionsFixture } from './whatsapp-mentions.mjs';
import { Media, Preview, previewUrl } from './whatsapp-reply.mjs';

export const fullPreviewUrl = 'blob:https://web.whatsapp.com/00000000-0000-4000-8000-000000000032';
export const thumbnailStyle = (url) => `background-image: url("${url}");`;

export class DocumentMedia extends Media {
  constructor({ preview = new Preview(), fullPreviewData = new Preview({ url: fullPreviewUrl }) } = {}) {
    super({ type: 'document', mimetype: 'application/pdf', preview });
    this.field('fullPreviewData', fullPreviewData); this.field('filename', 'order-details.pdf');
    this.field('pageCount', 3); this.field('size', 32768); this.field('isVcardOverMmsDocument', false);
    this.field('subtype', undefined); this.field('isPasswordProtected', undefined);
  }
}

export function documentReply({ byKey = false, previews = 'both', withMentions = false } = {}) {
  const base = withMentions ? mentionsFixture() : { ui: guest() };
  const { ui } = base;
  Object.assign(ui.window.WPP.whatsapp, { MediaDataModel: Media, OpaqueData: Preview });
  const reply = ui.reply({ body: 'Private document thumbnail payload.', byKey });
  const model = reply.message;
  const preview = previews === 'full' ? null : previews === 'base64' ? 'c3ludGhldGlj' : new Preview();
  const fullPreviewData = previews === 'preview' ? null : new Preview({ url: fullPreviewUrl });
  model.type = 'document';
  const fields = { isMedia: true, isViewOnce: false, mimetype: 'application/pdf', filehash: 'synthetic-known-media-hash',
    caption: 'The final order details.', isCaptionByUser: true, isFromTemplate: false,
    isDynamicReplyButtonsMsg: false, isVcardOverMmsDocument: false, footer: undefined, subtype: undefined,
    filename: 'order-details.pdf', pageCount: 3, size: 32768, mediaData: new DocumentMedia({ preview, fullPreviewData }) };
  for (const [name, value] of Object.entries(fields)) model.field(name, value);
  reply.body.textContent = model.caption;
  const thumbnailRoot = ui.document.createElement('div'); thumbnailRoot.setAttribute('class', 'xi9e97b');
  const backgrounds = [];
  // Actual WAWebMediaMsgPreview non-image branch: one leaf DIV for each loaded
  // preview/fullPreviewData holder, in that order; no IMG and no copied bytes.
  for (const holder of [preview, fullPreviewData]) {
    if (!(holder instanceof Preview)) continue;
    const node = ui.document.createElement('div');
    node.setAttribute('class', 'x10l6tqk xh8yej3 x5yr21d x1xsqp64 x18d0r48');
    node.setAttribute('style', thumbnailStyle(holder.url())); thumbnailRoot.append(node); backgrounds.push(node);
  }
  reply.banner.append(thumbnailRoot);
  return { ...base, ui, reply, model, thumbnailRoot, backgrounds, previewUrl, fullPreviewUrl };
}
