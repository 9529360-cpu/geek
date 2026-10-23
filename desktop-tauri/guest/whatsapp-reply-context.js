// WA-JS 4.7.1 prepareRawMessage passes a real MsgModel to msgContextInfo;
// media replies therefore keep the same canonical quoted message as text replies.
// This adapter proves only a captioned image/video's already loaded thumbnail.
// It never downloads media, rebuilds a quote payload, sends or clears a draft.
function createWhatsAppReplyContext({ normalize, visible, issue }) {
  const modelFields = ['id', 'body', 'type', 'caption', 'mimetype', 'filehash',
    'isMedia', 'isViewOnce', 'mediaData', 'notifyName', 'senderObj'];
  const mediaFields = ['type', 'preview', 'mimetype', 'filehash', 'isViewOnce'];
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

  function verified(value, model) {
    const { W, chatId, footer, editor } = value;
    const types = W?.whatsapp;
    if (typeof types?.MsgModel !== 'function' || !(model instanceof types.MsgModel)
        || typeof types.MsgKey !== 'function' || !(model.id instanceof types.MsgKey)
        || idOf(model.id.remote) !== chatId || model.isStatusV3
        || !['image', 'video'].includes(model.type) || model.isMedia !== true || model.isViewOnce !== false
        || typeof types.canReplyMsg !== 'function' || types.canReplyMsg(model) !== true
        || typeof model.on !== 'function' || typeof model.off !== 'function'
        || typeof model.caption !== 'string' || !normalize(model.caption)
        || model.caption.length > 10000 || new TextEncoder().encode(model.caption).length > 32768
        || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(model.caption)
        || typeof model.mimetype !== 'string' || model.mimetype.length > 100
        || model.mimetype.trim() !== model.mimetype
        || !new RegExp(`^${model.type}/[a-z0-9.+-]+$`).test(model.mimetype)
        || !scalar(model.filehash) || !visible(footer) || !footer.contains(editor)) throw issue();
    const media = model.mediaData;
    if (typeof types.MediaDataModel !== 'function' || !(media instanceof types.MediaDataModel)
        || media.isViewOnce !== false || !scalar(media.filehash) || !scalar(media.mimetype)
        || typeof media.on !== 'function' || typeof media.off !== 'function'
        || media.type != null && media.type !== model.type
        || media.mimetype != null && media.mimetype !== model.mimetype
        || media.filehash != null && model.filehash != null && media.filehash !== model.filehash) throw issue();
    const preview = media.preview;
    if (typeof types.OpaqueData !== 'function' || !(preview instanceof types.OpaqueData)
        || preview.released !== false || typeof preview.url !== 'function'
        || typeof preview.size !== 'function' || typeof preview.type !== 'function') throw issue();
    const url = preview.url();
    const size = preview.size();
    const type = preview.type();
    if (typeof url !== 'string' || url.length > 256 || !blobUrl.test(url)
        || !Number.isSafeInteger(size) || size < 1 || size > 512 * 1024 || !previewTypes.has(type)) throw issue();
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

  function matches(record, value) {
    const left = record?.quoteMedia;
    const right = value?.quoteMedia;
    if (!left || !right) return !left && !right;
    return left.model === right.model && left.media === right.media && left.preview === right.preview
      && left.image === right.image && left.url === right.url && left.size === right.size
      && left.type === right.type && left.caption === right.caption && left.messageId === right.messageId
      && Object.keys(left.values).every((key) => left.values[key] === right.values[key]);
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
  return { read, state, matches, allowsImage, watch };
}
