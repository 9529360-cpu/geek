// WA-JS 4.7.1 prepareRawMessage passes a real MsgModel to msgContextInfo;
// media replies therefore keep the same canonical quoted message as text replies.
// This adapter proves captioned image/video and ordinary user-captioned PDF
// replies from already loaded thumbnails, including the PDF's CSS previews.
// It never downloads media, rebuilds a quote payload, sends or clears a draft.
function createWhatsAppReplyContext({ normalize, visible, issue }) {
  const modelFields = ['id', 'body', 'type', 'caption', 'mimetype', 'filehash',
    'isMedia', 'isViewOnce', 'mediaData', 'notifyName', 'senderObj', 'isCaptionByUser',
    'isFromTemplate', 'isDynamicReplyButtonsMsg', 'isVcardOverMmsDocument', 'footer', 'subtype', 'filename', 'size', 'pageCount'];
  const mediaFields = ['type', 'preview', 'mimetype', 'filehash', 'isViewOnce', 'fullPreviewData',
    'filename', 'size', 'pageCount', 'isVcardOverMmsDocument', 'subtype', 'isPasswordProtected'];
  const previewTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const imageAttributes = new Set(['src', 'alt', 'class', 'style', 'dir', 'width', 'height',
    'draggable', 'decoding', 'loading', 'data-testid', 'role', 'aria-hidden']);
  const blobUrl = /^blob:https:\/\/web\.whatsapp\.com\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
  const idOf = (value) => typeof value === 'string' ? value : value?._serialized || '';
  const sourceOf = (image) => image.currentSrc || image.getAttribute('src') || '';
  const scalar = (value) => value == null || typeof value === 'string'
    && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value);

  // Flat values let the existing composer detect a changed media proof without
  // giving a snapshot object its own identity or authority.
  function state(model) {
    const media = model?.mediaData;
    return {
      mediaReplyType: model?.type, mediaReplyCaption: model?.caption,
      mediaReplyMime: model?.mimetype, mediaReplyHash: model?.filehash,
      mediaReplyFlag: model?.isMedia, mediaReplyViewOnce: model?.isViewOnce,
      mediaReplyData: media, mediaReplyDataType: media?.type,
      mediaReplyDataMime: media?.mimetype, mediaReplyDataHash: media?.filehash,
      mediaReplyDataViewOnce: media?.isViewOnce,
      mediaReplyPreview: media?.preview, mediaReplyReleased: media?.preview?.released,
      documentReplyCaptionByUser: model?.isCaptionByUser, documentReplyTemplate: model?.isFromTemplate,
      documentReplyButtons: model?.isDynamicReplyButtonsMsg, documentReplyVcard: model?.isVcardOverMmsDocument,
      documentReplyFooter: model?.footer, documentReplySubtype: model?.subtype,
      documentReplyFilename: model?.filename, documentReplySize: model?.size, documentReplyPages: model?.pageCount,
      documentReplyDataFilename: media?.filename, documentReplyDataSize: media?.size, documentReplyDataPages: media?.pageCount,
      documentReplyDataVcard: media?.isVcardOverMmsDocument, documentReplyDataSubtype: media?.subtype,
      documentReplyPassword: media?.isPasswordProtected,
      documentReplyFullPreview: media?.fullPreviewData, documentReplyFullReleased: media?.fullPreviewData?.released,
    };
  }

  function imageMatches(image, proof) {
    if (image?.tagName !== 'IMG' || !visible(image) || sourceOf(image) !== proof.url
        || [...image.attributes].some((attr) => !imageAttributes.has(attr.name))) return false;
    const role = image.getAttribute('role');
    const ariaHidden = image.getAttribute('aria-hidden');
    const alt = normalize(image.getAttribute('alt') || '');
    return (role == null || role === 'img' || role === 'presentation')
      && (ariaHidden == null || ariaHidden === 'true' || ariaHidden === 'false')
      && (!alt || alt === proof.caption);
  }

  function opaquePreview(types, preview) {
    if (typeof types.OpaqueData !== 'function' || !(preview instanceof types.OpaqueData)
        || preview.released !== false || typeof preview.url !== 'function'
        || typeof preview.size !== 'function' || typeof preview.type !== 'function') throw issue();
    const url = preview.url(), size = preview.size(), type = preview.type();
    if (typeof url !== 'string' || url.length > 256 || !blobUrl.test(url)
        || !Number.isSafeInteger(size) || size < 1 || size > 512 * 1024 || !previewTypes.has(type)) throw issue();
    return { preview, url, size, type };
  }

  function backgroundMatches(node, proof) {
    if (node?.tagName !== 'DIV' || !visible(node) || node.childNodes.length
        || node.closest('button, [role="button"], a')
        || [...node.attributes].some((attr) => !['class', 'style'].includes(attr.name))) return false;
    // React's exact single-property style. Do not infer identity from a URL
    // somewhere inside arbitrary CSS, multiple images or a background shorthand.
    const match = (node.getAttribute('style') || '').match(/^background-image:\s*url\((["']?)([^"'()\s]+)\1\)\s*;?\s*$/);
    return Boolean(match && match[2] === proof.url);
  }

  function documentProof(value, model, media) {
    if (model.isCaptionByUser !== true || model.isFromTemplate !== false || model.isDynamicReplyButtonsMsg !== false
        || model.isVcardOverMmsDocument !== false || model.subtype != null || model.footer != null && model.footer !== ''
        || media.type !== 'document' || media.mimetype !== 'application/pdf' || media.isVcardOverMmsDocument !== false
        || media.subtype != null || media.isPasswordProtected != null && media.isPasswordProtected !== false
        || typeof model.filename !== 'string' || model.filename.length > 255 || model.filename.trim() !== model.filename
        || !/^[^/\\\x00-\x1f\x7f]+\.pdf$/i.test(model.filename) || media.filename !== model.filename
        || !Number.isSafeInteger(model.size) || model.size < 1 || media.size !== model.size
        || !Number.isSafeInteger(model.pageCount) || model.pageCount < 1 || media.pageCount !== model.pageCount) throw issue();
    const types = value.W.whatsapp;
    if (typeof types.OpaqueData !== 'function') throw issue();
    const previews = [];
    // WAWebMediaMsgPreview ignores a raw base64 preview, but uses its separately
    // loaded fullPreviewData. Never convert that string, fetch or create a URL.
    if (media.preview instanceof types.OpaqueData) previews.push(opaquePreview(types, media.preview));
    else if (media.preview != null && (typeof media.preview !== 'string' || !media.preview.length
        || media.preview.length > 700000 || media.preview.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(media.preview))) throw issue();
    if (media.fullPreviewData != null) previews.push(opaquePreview(types, media.fullPreviewData));
    if (!previews.length || new Set(previews.map((proof) => proof.url)).size !== previews.length) throw issue();
    const backgrounds = [...value.footer.querySelectorAll('[style]')].filter((node) => visible(node)
      && !value.editor.contains(node) && /background(?:-image)?\s*:/i.test(node.getAttribute('style') || ''));
    if (backgrounds.length !== previews.length) throw issue();
    for (let index = 0; index < previews.length; index += 1) {
      if (!backgroundMatches(backgrounds[index], previews[index])) throw issue();
      previews[index].node = backgrounds[index]; Object.freeze(previews[index]);
    }
    const proof = Object.freeze({ model, media, caption: normalize(model.caption), messageId: idOf(model.id),
      values: Object.freeze(state(model)), documentPreviews: Object.freeze(previews) });
    return { quoteBody: proof.caption, quoteMedia: proof };
  }

  function verified(value, model) {
    const { W, chatId, footer, editor } = value;
    const types = W?.whatsapp;
    if (typeof types?.MsgModel !== 'function' || !(model instanceof types.MsgModel)
        || typeof types.MsgKey !== 'function' || !(model.id instanceof types.MsgKey)
        || idOf(model.id.remote) !== chatId || model.isStatusV3
        || !['image', 'video', 'document'].includes(model.type) || model.isMedia !== true || model.isViewOnce !== false
        || typeof types.canReplyMsg !== 'function' || types.canReplyMsg(model) !== true
        || typeof model.on !== 'function' || typeof model.off !== 'function'
        || typeof model.caption !== 'string' || !normalize(model.caption)
        || model.caption.length > 10000 || new TextEncoder().encode(model.caption).length > 32768
        || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(model.caption)
        || typeof model.mimetype !== 'string' || model.mimetype.length > 100
        || model.mimetype.trim() !== model.mimetype
        || (model.type === 'document' ? model.mimetype !== 'application/pdf'
          : !new RegExp(`^${model.type}/[a-z0-9.+-]+$`).test(model.mimetype))
        || !scalar(model.filehash) || !visible(footer) || !footer.contains(editor)) throw issue();
    const media = model.mediaData;
    if (typeof types.MediaDataModel !== 'function' || !(media instanceof types.MediaDataModel)
        || media.isViewOnce !== false || !scalar(media.filehash) || !scalar(media.mimetype)
        || typeof media.on !== 'function' || typeof media.off !== 'function'
        || media.type != null && media.type !== model.type
        || media.mimetype != null && media.mimetype !== model.mimetype
        || media.filehash != null && model.filehash != null && media.filehash !== model.filehash) throw issue();
    if (model.type === 'document') return documentProof(value, model, media);
    const { preview, url, size, type } = opaquePreview(types, media.preview);
    const proof = { model, media, preview, url, size, type, caption: normalize(model.caption),
      messageId: idOf(model.id), values: Object.freeze(state(model)) };
    const images = [...footer.querySelectorAll('img')].filter((node) => visible(node) && !editor.contains(node));
    if (images.length !== 1 || images[0].closest('button, [role="button"], a')
        || !imageMatches(images[0], proof)) throw issue();
    proof.image = images[0];
    return { quoteBody: proof.caption, quoteMedia: Object.freeze(proof) };
  }

  function read(value, model) {
    try { return verified(value, model); } catch { throw issue(); }
  }

  function allowsImage(node, proof) {
    return Boolean(proof && node === proof.image && imageMatches(node, proof));
  }

  function allowsNode(node, proof) {
    return allowsImage(node, proof) || Boolean(proof?.documentPreviews?.some((item) => node === item.node && backgroundMatches(node, item)));
  }
  const nodes = (proof) => proof?.documentPreviews?.map((item) => item.node) || (proof?.image ? [proof.image] : []);

  function matches(record, value) {
    const left = record?.quoteMedia;
    const right = value?.quoteMedia;
    if (!left || !right) return !left && !right;
    if (left.model !== right.model || left.media !== right.media || left.caption !== right.caption || left.messageId !== right.messageId
        || !Object.keys(left.values).every((key) => left.values[key] === right.values[key])) return false;
    if (left.documentPreviews || right.documentPreviews) {
      return Boolean(left.documentPreviews && right.documentPreviews && left.documentPreviews.length === right.documentPreviews.length
        && left.documentPreviews.every((item, index) => {
          const other = right.documentPreviews[index];
          return item.preview === other.preview && item.node === other.node && item.url === other.url && item.size === other.size && item.type === other.type;
        }));
    }
    return left.preview === right.preview && left.image === right.image && left.url === right.url
      && left.size === right.size && left.type === right.type;
  }

  // Compose ownership remains in createSendComposer. Its disposer owns these
  // subscriptions, including rebinding a changed mediaData before the next poll.
  function watch(model, changed) {
    let disposed = false;
    let media = null;
    const listenable = (target) => target && typeof target.on === 'function' && typeof target.off === 'function';
    const mediaChanged = () => { if (!disposed) changed(); };
    const attachMedia = () => {
      const next = listenable(model?.mediaData) ? model.mediaData : null;
      if (media === next) return;
      for (const field of mediaFields) media?.off(`change:${field}`, mediaChanged);
      media = next;
      for (const field of mediaFields) media?.on(`change:${field}`, mediaChanged);
    };
    const modelChanged = () => { if (!disposed) { attachMedia(); changed(); } };
    if (listenable(model)) for (const field of modelFields) model.on(`change:${field}`, modelChanged);
    attachMedia();
    return () => {
      if (disposed) return;
      disposed = true;
      if (listenable(model)) for (const field of modelFields) model.off(`change:${field}`, modelChanged);
      for (const field of mediaFields) media?.off(`change:${field}`, mediaChanged);
      media = null;
    };
  }
  return { read, state, matches, allowsImage, allowsNode, nodes, watch };
}
