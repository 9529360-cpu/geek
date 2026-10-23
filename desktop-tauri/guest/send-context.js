// Named wire context plus a narrow, model-backed plain-text reply adapter.
function sameSendContext(left, right) {
  const valid = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const keys = Object.keys(value).sort().join(',');
    return value.kind === 'plain' ? keys === 'kind'
      : value.kind === 'reply' && keys === 'chatId,kind,messageId'
        && typeof value.messageId === 'string' && typeof value.chatId === 'string';
  };
  return valid(left) && valid(right) && left.kind === right.kind
    && (left.kind === 'plain' || left.messageId === right.messageId && left.chatId === right.chatId);
}

function createSendContext({ normalize, visible, issue }) {
  const fields = ['composeQuotedMsg', 'composeQuotedMsgRemoteJid', 'quotedMsgAdminGroupJid', 'attachMediaContents'];
  const empty = (value) => value == null || value === false || value === ''
    || (Array.isArray(value) && value.length === 0)
    || (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === 0);
  const idOf = (value) => typeof value === 'string' ? value : value?._serialized || '';
  const field = (chat, key) => {
    if (!(key in chat) && !Object.hasOwn(chat.attributes || {}, key)) throw issue();
    return key in chat ? chat[key] : chat.attributes[key];
  };
  const sameNodes = (left, right) => left.length === right.length && left.every((node, index) => node === right[index]);
  function loadedModel(W, chat, source) {
    const models = W?.whatsapp;
    if (typeof models?.MsgModel === 'function' && source instanceof models.MsgModel) return source;
    if (typeof models?.MsgKey === 'function' && source instanceof models.MsgKey) {
      return models.MsgStore?.get?.(source) || chat?.msgs?.get?.(source) || null;
    }
    return null;
  }
  function state(chat, W) {
    const get = (key) => chat && (key in chat ? chat[key] : chat.attributes?.[key]);
    const source = get('composeQuotedMsg');
    const model = loadedModel(W, chat, source);
    return { source, model, key: idOf(source?.id) || idOf(source), body: model?.body,
      remote: get('composeQuotedMsgRemoteJid'), remoteId: idOf(get('composeQuotedMsgRemoteJid')),
      admin: get('quotedMsgAdminGroupJid'), media: get('attachMediaContents') };
  }
  function sameState(left, right) {
    return Object.keys(left).every((key) => left[key] === right[key]);
  }
  function quoteModel(value, source) {
    const { W, chat, chatId } = value;
    const models = W.whatsapp;
    if (typeof models?.MsgModel !== 'function' || typeof models.MsgKey !== 'function'
        || typeof models.canReplyMsg !== 'function' || typeof chat.on !== 'function' || typeof chat.off !== 'function') throw issue();
    const key = source instanceof models.MsgModel ? source.id : source;
    if (!(key instanceof models.MsgKey) || typeof key.equals !== 'function'
        || idOf(key.remote) !== chatId || typeof key.fromMe !== 'boolean') throw issue();
    const messageId = key._serialized;
    if (typeof messageId !== 'string' || messageId.length > 500
        || !/^(true|false)_[0-9][0-9-]{0,39}@(c\.us|lid|g\.us)_[A-Za-z0-9]+(?:_[0-9]+@(c\.us|lid))?$/.test(messageId)
        || key.toString() !== messageId || !key.equals(models.MsgKey.fromString(messageId))) throw issue();
    const parts = messageId.split('_');
    if (parts[1] !== chatId || (parts.length === 4 && !chat.isGroup)) throw issue();
    const loaded = models.MsgStore?.get?.(key) || chat.msgs?.get?.(key);
    if (!(loaded instanceof models.MsgModel) || !(loaded.id instanceof models.MsgKey)
        || !key.equals(loaded.id) || (source instanceof models.MsgModel && loaded !== source)
        || loaded.type !== 'chat' || loaded.isStatusV3 || loaded.isMedia || models.canReplyMsg(loaded) !== true
        || typeof loaded.on !== 'function' || typeof loaded.off !== 'function'
        || typeof loaded.body !== 'string' || !normalize(loaded.body) || loaded.body.length > 10000
        || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(loaded.body)) throw issue();
    return { model: loaded, context: Object.freeze({ kind: 'reply', messageId, chatId }) };
  }
  function namesFor(model, W) {
    const values = [model.notifyName];
    const contact = model.senderObj;
    if (typeof W.whatsapp.ContactModel === 'function' && contact instanceof W.whatsapp.ContactModel) {
      values.push(contact.displayName, contact.formattedName, contact.name, contact.shortName, contact.pushname);
    }
    return new Set(values.filter((value) => typeof value === 'string' && value.length <= 200
      && !/[\x00-\x1f\x7f]/.test(value)).map(normalize).filter(Boolean));
  }
  function outsideLeaves(footer, editor) {
    const leaves = [];
    const visit = (node) => {
      if (node === editor) return;
      if (node.nodeType === 3) { if (normalize(node.textContent)) leaves.push(node); return; }
      if (node.nodeType !== 1 || !visible(node) || node.matches('button, [role="button"], svg')) return;
      for (const child of node.childNodes) visit(child);
    };
    for (const child of footer.childNodes) visit(child);
    return leaves;
  }
  function passiveElement(node) {
    const tags = new Set(['DIV', 'P', 'SPAN', 'BR']);
    const attributes = new Set(['class', 'dir', 'style', 'data-testid', 'data-lexical-text', 'data-lexical-linebreak']);
    return node.nodeType === 1 && tags.has(node.tagName)
      && [...node.attributes].every((attr) => attributes.has(attr.name));
  }
  function passive(node) {
    return node.nodeType === 3 || passiveElement(node) && [...node.childNodes].every(passive);
  }
  function replyRegion(value, model) {
    const { footer, editor, W } = value;
    const body = normalize(model.body);
    const candidates = [...footer.querySelectorAll('div, p, span')].filter((node) => visible(node)
      && !node.contains(editor) && !editor.contains(node) && !node.closest('button, [role="button"], svg') && passive(node));
    const innermost = (nodes) => nodes.filter((node) => !nodes.some((child) => child !== node && node.contains(child)));
    const bodies = innermost(candidates.filter((node) => normalize(node.innerText) === body));
    if (bodies.length !== 1) throw issue();
    const bodyNode = bodies[0];
    const leaves = outsideLeaves(footer, editor);
    const extra = leaves.filter((node) => !bodyNode.contains(node));
    let author = null;
    if (extra.length) {
      const names = namesFor(model, W);
      const authors = innermost(candidates.filter((node) => !bodyNode.contains(node) && !node.contains(bodyNode)
        && names.has(normalize(node.innerText)) && extra.every((leaf) => node.contains(leaf))));
      if (authors.length !== 1) throw issue();
      author = authors[0];
    }
    // Validate the full path to the footer, not only a matching inner span.
    // Otherwise an unknown link/editor/control can wrap an innocent text leaf.
    const structure = (node) => {
      if (node === editor || node.nodeType === 3) return true;
      if (node.nodeType !== 1) return false;
      if (!visible(node) || node.matches('button, [role="button"], svg')
          && !node.contains(bodyNode) && (!author || !node.contains(author))) return true;
      return passiveElement(node) && [...node.childNodes].every(structure);
    };
    if (![...footer.childNodes].every(structure)) throw issue();
    let region = bodyNode;
    if (author) while (region && !region.contains(author)) region = region.parentNode;
    if (!region || region === footer || region.contains(editor)) throw issue();
    // The range is derived from the exact loaded body and verified author, never
    // a guessed WhatsApp testid. Keep every node identity for the final CAS.
    const nodes = [];
    const collect = (node) => { nodes.push(node); for (const child of node.childNodes || []) collect(child); };
    collect(region);
    if (nodes.length > 512) throw issue();
    return { quoteRegion: region, quoteNodes: nodes, quoteBody: body, quoteAuthor: author ? normalize(author.innerText) : '' };
  }
  function read(value) {
    const source = field(value.chat, fields[0]);
    const remote = field(value.chat, fields[1]);
    if (!empty(field(value.chat, fields[2])) || !empty(field(value.chat, fields[3]))) throw issue();
    const plain = empty(source);
    if (plain && !empty(remote) || !plain && !empty(remote) && idOf(remote) !== value.chatId) throw issue();
    const suspicious = '[contenteditable="false"], img, video, audio, canvas, textarea, '
      + '[data-testid*="preview"], [data-testid*="forward"], [data-testid*="edit-message"], '
      + '[data-testid*="media-editor"], [data-mention-jid], [data-mention-id]'
      + (plain ? ', [data-testid*="quoted"]' : '');
    if ([...value.footer.querySelectorAll(suspicious)].some(visible)) throw issue();
    if (plain) {
      // Preserve the existing ordinary composer guard, including control labels.
      const outside = (node) => {
        if (node === value.editor || node.nodeType === 1 && (node.matches('button, [role="button"], svg') || !visible(node))) return false;
        if (node.nodeType === 3) return Boolean(node.textContent.trim());
        return [...node.childNodes].some(outside);
      };
      if ([...value.footer.childNodes].some(outside)) throw issue();
      return { context: Object.freeze({ kind: 'plain' }), quoteModel: null, quoteNodes: [], quoteRegion: null };
    }
    const quote = quoteModel(value, source);
    return { context: quote.context, quoteModel: quote.model, ...replyRegion(value, quote.model) };
  }
  function matches(record, value) {
    return sameSendContext(record.context, value.context) && record.quoteModel === value.quoteModel
      && record.quoteBody === value.quoteBody && record.quoteAuthor === value.quoteAuthor
      && record.quoteRegion === value.quoteRegion && sameNodes(record.quoteNodes, value.quoteNodes);
  }
  return { fields, state, sameState, read, matches };
}
