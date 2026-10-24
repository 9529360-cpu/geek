// Read-only K ChatInput reply binding. The history mirror, draft's local mid and
// actual replyElements preview must agree; a preview selector alone is no proof.
function createTelegramReplyContext(runtime, changed) {
  const issue = () => runtime.issue('SEND_INTENT_UNSUPPORTED');
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const visible = (node) => Boolean(node?.isConnected && !node.hidden
    && node.getAttribute?.('aria-hidden') !== 'true' && node.getClientRects().length);
  const display = (text) => String(text || '').replace(/\u200b/g, '').replace(/\s+/gu, ' ').trim();
  const hasClass = (node, name) => node?.nodeType === 1 && node.classList.contains(name);
  const emptyEntities = (value) => value === undefined || Array.isArray(value) && !value.length;
  let root = null;
  let latest = null;
  function edited(event) {
    if (latest && event?.peerId === latest.peerId && event.mid === latest.mid) changed('quote');
  }
  function deleted(event) {
    if (latest && event?.peerId === latest.peerId && event.msgs?.has?.(latest.mid)) changed('quote');
  }
  function flushed(event) { if (latest && event?.peerId === latest.peerId) changed('quote'); }
  const listeners = [['message_edit', edited], ['history_delete', deleted], ['dialog_flush', flushed]];
  function watch(next) {
    if (root === next) return;
    for (const [event, listener] of listeners) root?.removeEventListener(event, listener);
    root = next; latest = null;
    for (const [event, listener] of listeners) root?.addEventListener(event, listener);
  }
  function nodesOf(region) {
    const nodes = [];
    const visit = (node) => {
      if (nodes.length >= 512) throw issue();
      nodes.push(node);
      for (const child of node.childNodes || []) visit(child);
    };
    visit(region); return nodes;
  }
  function passiveBody(node) {
    return node.nodeType === 3 || node.nodeType === 1 && ['DIV', 'SPAN', 'BR'].includes(node.tagName)
      && visible(node) && [...node.attributes].every((attr) => ['class', 'dir'].includes(attr.name))
      && [...node.childNodes].every(passiveBody);
  }
  function source(snapshot, peerId, mid) {
    const model = snapshot.proxy.getMessageFromStorage(`${peerId}_history`, mid);
    const flags = model?.pFlags;
    if (model?._ !== 'message' || model.peerId !== peerId || model.mid !== mid
        || !Number.isInteger(model.id) || model.id <= 0 || model.id > 2147483647
        || !object(flags) || Object.keys(flags).some((key) =>
          !['out', 'unread', 'mentioned', 'media_unread', 'silent', 'edit_hide', 'pinned', 'noforwards'].includes(key)
          || typeof flags[key] !== 'boolean')
        || !Number.isSafeInteger(model.fromId) || model.fromId <= 0
        || !Number.isSafeInteger(model.date) || model.date <= 0
        || model.edit_date !== undefined && (!Number.isSafeInteger(model.edit_date) || model.edit_date <= 0)
        || ['pending', 'error', 'deleted', 'random_id', 'media', 'rich_message', 'action', 'grouped_id',
          'ttl_period', 'restriction_reason', 'paid_message_stars', 'suggested_post', 'saved_peer_id',
          'via_bot_id', 'reply_markup'].some((key) => model[key] !== undefined)
        || !emptyEntities(model.entities) || !runtime.textValid(model.message)
        || model.totalEntities !== undefined && (!Array.isArray(model.totalEntities)
          || model.totalEntities.some((entity) => !['messageEntityEmoji', 'messageEntityLinebreak'].includes(entity?._)))) throw issue();
    return model;
  }
  function read(value) {
    const { snapshot, chat, input, draft, chatId, editor } = value;
    watch(snapshot.root);
    const mid = input.replyToMsgId;
    if (!mid && !draft.reply_to) {
      latest = null;
      if (input.helperVisible || chat.container.classList.contains('is-helper-active')) throw issue();
      return { context: { kind: 'plain' }, quoteModel: null, quoteRegion: null, quoteNodes: [],
        quoteBody: '', quoteAuthor: '', telegramReply: null };
    }
    if (!Number.isSafeInteger(mid) || mid <= 0 || !object(draft.reply_to)
        || draft.reply_to._ !== 'inputReplyToMessage' || draft.reply_to.reply_to_msg_id !== mid
        || Object.keys(draft.reply_to).some((key) => !['_', 'reply_to_msg_id', 'top_msg_id',
          'reply_to_peer_id', 'monoforum_peer_id', 'poll_option'].includes(key)
          || !['_', 'reply_to_msg_id'].includes(key) && draft.reply_to[key] !== undefined)
        || input.replyIsEphemeral || input.helperType !== 'reply' || input.helperVisible !== true
        || !chat.container.classList.contains('is-helper-active')) throw issue();
    const model = source(snapshot, chat.peerId, mid);
    const wrapper = input.replyElements?.container;
    const content = input.replyElements?.content;
    if (!visible(wrapper) || !visible(content) || !hasClass(wrapper, 'reply-wrapper')
        || !hasClass(content, 'reply-wrapper-content') || !wrapper.contains(content)
        || !input.chatInput?.contains(wrapper) || wrapper.contains(editor)) throw issue();
    const regions = [...content.childNodes].filter((node) => hasClass(node, 'reply'));
    if (regions.length !== 1 || !visible(regions[0])) throw issue();
    const region = regions[0]; const nodes = nodesOf(region);
    const bodies = nodes.filter((node) => hasClass(node, 'reply-subtitle'));
    const titles = nodes.filter((node) => hasClass(node, 'reply-title'));
    const authors = nodes.filter((node) => hasClass(node, 'peer-title'));
    // wrapMessageForReply uses limitSymbols(text, 100), whose default cutoff is
    // 110 UTF-16 units. CSS may collapse line breaks; the complete source stays
    // frozen separately, so an edit beyond the visible prefix still invalidates.
    const body = model.message.trim();
    const preview = body.length > 110 ? body.slice(0, 100) + '...' : body;
    if (bodies.length !== 1 || titles.length !== 1 || authors.length !== 1
        || !passiveBody(bodies[0]) || !visible(titles[0]) || !visible(authors[0])
        || !titles[0].contains(authors[0]) || authors[0].getAttribute('data-peer-id') !== String(model.fromId)
        || authors[0].getAttribute('data-thread-id') && authors[0].getAttribute('data-thread-id') !== '0'
        || !display(authors[0].innerText) || display(bodies[0].innerText) !== display(preview)) throw issue();
    const signature = JSON.stringify({ id: model.id, mid, peerId: model.peerId, fromId: model.fromId,
      date: model.date, edit_date: model.edit_date, message: model.message, pFlags: model.pFlags,
      entities: model.entities, totalEntities: model.totalEntities });
    const telegramReply = Object.freeze({ snapshot, peerId: chat.peerId, mid, id: model.id, model, signature });
    latest = telegramReply;
    return { context: Object.freeze({ kind: 'reply', chatId, messageId: `${chatId}:${model.id}` }),
      quoteModel: model, quoteRegion: region, quoteNodes: nodes, quoteBody: model.message,
      quoteAuthor: titles[0].innerText, telegramReply };
  }
  function matches(record, value) {
    const frozen = record.composerState || record;
    if (record.context?.kind !== value.context?.kind) return false;
    if (record.context.kind === 'plain') return !frozen.telegramReply && !value.telegramReply;
    return record.context.kind === 'reply' && record.context.chatId === value.context.chatId
      && record.context.messageId === value.context.messageId && record.quoteModel === value.quoteModel
      && frozen.telegramReply?.signature === value.telegramReply?.signature
      && record.quoteRegion === value.quoteRegion && record.quoteBody === value.quoteBody
      && record.quoteAuthor === value.quoteAuthor && record.quoteNodes.length === value.quoteNodes.length
      && record.quoteNodes.every((node, index) => node === value.quoteNodes[index]);
  }
  return { read, matches, dispose() { watch(null); latest = null; } };
}
