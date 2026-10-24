// K uses fractional local mids; the final server message ID is an integer.
// appMessagesManager beforeMessageSending -> updateMessageID ->
// finalizePendingMessageCallbacks(message_sent), blob f99649c8ce797ae070d1490a2b70c88b0834dc2a.
function telegramReplyHeaderMatches(header, mid = null) {
  if (mid === null) return header == null;
  return Number.isSafeInteger(mid) && mid > 0 && header?._ === 'messageReplyHeader'
    && header.reply_to_msg_id === mid && header.pFlags && typeof header.pFlags === 'object'
    && !Array.isArray(header.pFlags) && Object.keys(header.pFlags).length === 0
    && Object.keys(header).every((key) => ['_', 'pFlags', 'reply_to_msg_id'].includes(key)
      || ['poll_option', 'reply_media', 'reply_to_peer_id', 'reply_from', 'quote_text', 'quote_entities',
        'quote_offset', 'reply_to_top_id', 'reply_to_msg_deleted', 'todo_item_id'].includes(key)
        && header[key] === undefined);
}

function validTelegramPending(message, peerId, self, replyMid = null) {
  const target = message?.peer_id;
  const targetId = target?._ === 'peerUser' ? target.user_id
    : target?._ === 'peerChat' ? -target.chat_id : target?._ === 'peerChannel' ? -target.channel_id : null;
  return message?._ === 'message' && Number.isFinite(message.id) && message.id > 0
    && message.id < Number.MAX_SAFE_INTEGER && !Number.isInteger(message.id)
    && typeof message.random_id === 'string' && /^\d{1,20}$/.test(message.random_id)
    && message.random_id !== '0' && targetId === peerId && message.from_id?._ === 'peerUser'
    && message.from_id.user_id === self && Number.isSafeInteger(message.date) && message.date > 0
    && message.pending === true && message.pFlags?.out === true && !message.media
    && telegramReplyHeaderMatches(message.reply_to, replyMid)
    && !message.rich_message && !message.paid_message_stars && !message.suggested_post;
}

function createTelegramSendReceipt(snapshot, message, peerId, text, check, media = null, replyMid = null) {
  const storageKey = `${peerId}_history`;
  const started = performance.now();
  let staged = false;
  let result = null;
  let failure = false;
  let disposed = false;
  const pendingMatches = (candidate) => candidate?._ === 'message'
    && candidate.id === message.id && candidate.mid === message.id && candidate.peerId === peerId
    && candidate.random_id === message.random_id && candidate.message === text
    && candidate.pending === true && candidate.pFlags?.out === true
    && !candidate.error && !candidate.rich_message && telegramReplyHeaderMatches(candidate.reply_to, replyMid)
    && (media ? media.pending(candidate.media) : !candidate.media);
  const appended = (event) => {
    if (!disposed && event?.storageKey === storageKey && pendingMatches(event.message)) staged = true;
  };
  const sent = (event) => {
    if (disposed || !staged || event?.storageKey !== storageKey || event.tempId !== message.id
        || !pendingMatches(event.tempMessage)) return;
    const final = event.message;
    if (final?._ !== 'message' || final.peerId !== peerId || final.message !== text
        || !Number.isSafeInteger(final.id) || final.id <= 0 || !Number.isSafeInteger(event.mid)
        || event.mid <= 0 || final.mid !== event.mid || final.pFlags?.out !== true
        || final.pFlags.is_outgoing || final.pending || final.error || final.rich_message
        || !telegramReplyHeaderMatches(final.reply_to, replyMid) || final.random_id
        || (media ? !media.final(final.media) || final.ttl_period : final.media)) return;
    // The mirror is written before message_sent in the official finalizer.
    const mirrored = snapshot.proxy.getMessageFromStorage(storageKey, event.mid);
    if (mirrored?.id !== final.id || mirrored?.mid !== event.mid || mirrored?.peerId !== peerId
        || mirrored?.message !== text || mirrored?.pFlags?.out !== true
        || mirrored?.pFlags?.is_outgoing || mirrored?.pending || mirrored?.error || mirrored?.rich_message
        || !telegramReplyHeaderMatches(mirrored?.reply_to, replyMid)
        || (media ? !media.final(mirrored.media) || !media.same(final.media, mirrored.media) : mirrored.media)) return;
    result = { id: `tg:${peerId}:${final.id}`, ack: 1 };
  };
  const errored = (event) => {
    if (!disposed && event?.storageKey === storageKey && event.peerId === peerId && event.tempId === message.id) failure = true;
  };
  snapshot.root.addEventListener('history_append', appended);
  snapshot.root.addEventListener('message_sent', sent);
  snapshot.root.addEventListener('message_error', errored);
  async function waitFor(done) {
    while (!done()) {
      check();
      if (disposed || failure) throw Object.assign(new Error('RUNTIME_FAILED'), { code: 'RUNTIME_FAILED' });
      if (performance.now() - started >= 30000) throw Object.assign(new Error('TIMED_OUT'), { code: 'TIMED_OUT' });
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    check();
    return result;
  }
  return { pending: () => waitFor(() => staged), confirmed: () => waitFor(() => result !== null),
    failed() { if (!disposed && !result) failure = true; },
    dispose() {
      disposed = true;
      snapshot.root.removeEventListener('history_append', appended);
      snapshot.root.removeEventListener('message_sent', sent);
      snapshot.root.removeEventListener('message_error', errored);
    } };
}

async function applyTelegramSendUpdates(managers, pending, updates, media = null) {
  if (updates?._ === 'updateShortSentMessage') {
    if (!Number.isSafeInteger(updates.id) || updates.id <= 0 || !Number.isSafeInteger(updates.date)
        || updates.date <= 0 || updates.pFlags?.out !== true || !Number.isSafeInteger(updates.pts)
        || !Number.isSafeInteger(updates.pts_count)
        || (media ? !media.final(updates.media) || updates.ttl_period : updates.media)) throw new Error('RECEIPT_MISSING');
    // Same local-update expansion as K sendText (3328..3363); both RPC calls
    // remain bound to the submitting Telegram account, including late responses.
    await managers.apiUpdatesManager.processLocalUpdate({ _: 'updateMessageID', random_id: pending.random_id, id: updates.id });
    await managers.apiUpdatesManager.processLocalUpdate({
      _: pending.peer_id._ === 'peerChannel' ? 'updateNewChannelMessage' : 'updateNewMessage',
      message: { ...pending, id: updates.id, date: updates.date, entities: updates.entities,
        ttl_period: updates.ttl_period, ...(media ? { media: updates.media } : {}) },
      pts: updates.pts, pts_count: updates.pts_count,
    });
    return;
  }
  if (!['updates', 'updatesCombined'].includes(updates?._) || !Array.isArray(updates.updates)
      || updates.updates.length > 1000) throw new Error('RECEIPT_MISSING');
  await managers.apiUpdatesManager.processUpdateMessage(updates);
}
