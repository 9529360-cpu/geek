'use strict';

const DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS = Object.freeze({
  concurrency: 20,
  outgoingReserve: 4,
  outgoingBurst: 3,
  totalQueueLimit: 96,
  partitionQueueLimit: 24,
  backgroundPartitionLimit: 12,
});

const TRANSLATION_INTENTS = Object.freeze({
  OUTGOING_SEND: 'outgoing-send',
  MESSAGE_DISPLAY: 'message-display',
});

function normalizeTranslationIntent(value) {
  return value === TRANSLATION_INTENTS.OUTGOING_SEND
    ? TRANSLATION_INTENTS.OUTGOING_SEND
    : TRANSLATION_INTENTS.MESSAGE_DISPLAY;
}

function capacityError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.category = 'capacity';
  error.retryable = true;
  return error;
}

function createTranslationSmartQueue(options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency) || DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS.concurrency);
  const requestedReserve = Number.isFinite(Number(options.outgoingReserve))
    ? Number(options.outgoingReserve)
    : DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS.outgoingReserve;
  const outgoingReserve = Math.min(concurrency - 1, Math.max(0, requestedReserve));
  const outgoingBurst = Math.max(1, Number(options.outgoingBurst) || DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS.outgoingBurst);
  const totalQueueLimit = Math.max(concurrency, Number(options.totalQueueLimit) || DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS.totalQueueLimit);
  const partitionQueueLimit = Math.max(1, Number(options.partitionQueueLimit) || DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS.partitionQueueLimit);
  const backgroundPartitionLimit = Math.min(
    partitionQueueLimit,
    Math.max(1, Number(options.backgroundPartitionLimit) || DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS.backgroundPartitionLimit),
  );
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const isPartitionDeleted = typeof options.isPartitionDeleted === 'function' ? options.isPartitionDeleted : () => false;
  const deadlineError = typeof options.deadlineError === 'function'
    ? options.deadlineError
    : () => {
      const error = new Error('翻译请求超时，请重试');
      error.code = 'TRANSLATION_DEADLINE_EXCEEDED';
      error.category = 'deadline';
      error.retryable = true;
      return error;
    };
  const deletedError = typeof options.deletedError === 'function'
    ? options.deletedError
    : () => {
      const error = new Error('翻译账号已删除');
      error.code = 'TRANSLATION_ACCOUNT_DELETED';
      error.category = 'account';
      error.retryable = false;
      return error;
    };
  const subscribeAbort = typeof options.subscribeAbort === 'function'
    ? options.subscribeAbort
    : (signal, listener) => {
      if (!signal || typeof signal.addEventListener !== 'function') return () => {};
      signal.addEventListener('abort', listener, { once: true });
      return () => signal.removeEventListener?.('abort', listener);
    };

  const queues = {
    [TRANSLATION_INTENTS.OUTGOING_SEND]: new Map(),
    [TRANSLATION_INTENTS.MESSAGE_DISPLAY]: new Map(),
  };
  const activeByIntent = {
    [TRANSLATION_INTENTS.OUTGOING_SEND]: 0,
    [TRANSLATION_INTENTS.MESSAGE_DISPLAY]: 0,
  };
  let active = 0;
  let queued = 0;
  let outgoingStreak = 0;
  let droppedBackground = 0;
  let sequence = 0;

  function partitionQueue(intent, partition, create = false) {
    const map = queues[intent];
    let queue = map.get(partition);
    if (!queue && create) {
      queue = [];
      map.set(partition, queue);
    }
    return queue || null;
  }

  function partitionQueued(partition) {
    return (partitionQueue(TRANSLATION_INTENTS.OUTGOING_SEND, partition)?.length || 0)
      + (partitionQueue(TRANSLATION_INTENTS.MESSAGE_DISPLAY, partition)?.length || 0);
  }

  function hasQueued(intent) {
    return queues[intent].size > 0;
  }

  function removeItem(item) {
    const queue = partitionQueue(item.intent, item.partition);
    if (!queue) return false;
    const index = queue.indexOf(item);
    if (index < 0) return false;
    queue.splice(index, 1);
    queued = Math.max(0, queued - 1);
    if (!queue.length) queues[item.intent].delete(item.partition);
    return true;
  }

  function settleQueued(item, error) {
    if (item.settled) return false;
    if (!removeItem(item)) return false;
    clearTimeout(item.timer);
    item.unsubscribeAbort?.();
    item.unsubscribeAbort = null;
    item.settled = true;
    item.reject(error);
    drain();
    return true;
  }

  function dropBackgroundItem(item, reason = capacityError(
    'TRANSLATION_BACKGROUND_DROPPED',
    '后台翻译队列繁忙，已跳过较旧请求',
  )) {
    if (!item || !settleQueued(item, reason)) return false;
    droppedBackground += 1;
    return true;
  }

  function dropOldestBackground(partition) {
    const queue = partitionQueue(TRANSLATION_INTENTS.MESSAGE_DISPLAY, partition);
    return dropBackgroundItem(queue?.[0]);
  }

  function dropOldestBackgroundAnywhere() {
    let oldest = null;
    for (const queue of queues[TRANSLATION_INTENTS.MESSAGE_DISPLAY].values()) {
      const candidate = queue[0];
      if (candidate && (!oldest || candidate.id < oldest.id)) oldest = candidate;
    }
    return dropBackgroundItem(oldest);
  }

  function admitOrReject(intent, partition) {
    const partitionTotal = partitionQueued(partition);
    if (intent === TRANSLATION_INTENTS.MESSAGE_DISPLAY) {
      const backgroundCount = partitionQueue(intent, partition)?.length || 0;
      if (backgroundCount >= backgroundPartitionLimit || partitionTotal >= partitionQueueLimit) {
        if (backgroundCount > 0 && dropOldestBackground(partition)) return;
        throw capacityError('TRANSLATION_BUSY', '后台翻译队列繁忙，请稍后重试');
      }
      if (queued >= totalQueueLimit) {
        if (dropOldestBackgroundAnywhere()) return;
        throw capacityError('TRANSLATION_BUSY', '后台翻译队列繁忙，请稍后重试');
      }
      return;
    }

    if (partitionTotal >= partitionQueueLimit) {
      if (!dropOldestBackground(partition)) {
        throw capacityError('TRANSLATION_BUSY', '翻译发送队列繁忙，请稍后重试');
      }
    }
    if (queued >= totalQueueLimit && !dropOldestBackgroundAnywhere()) {
      throw capacityError('TRANSLATION_BUSY', '翻译发送队列繁忙，请稍后重试');
    }
  }

  function takeFromIntent(intent) {
    const map = queues[intent];
    const first = map.entries().next();
    if (first.done) return null;
    const [partition, queue] = first.value;
    const item = queue.shift();
    queued = Math.max(0, queued - 1);
    map.delete(partition);
    if (queue.length) map.set(partition, queue);
    return item;
  }

  function nextIntent() {
    const outgoing = hasQueued(TRANSLATION_INTENTS.OUTGOING_SEND);
    const background = hasQueued(TRANSLATION_INTENTS.MESSAGE_DISPLAY)
      && activeByIntent[TRANSLATION_INTENTS.MESSAGE_DISPLAY] < (concurrency - outgoingReserve);

    if (outgoing && background) {
      if (outgoingStreak < outgoingBurst) {
        outgoingStreak += 1;
        return TRANSLATION_INTENTS.OUTGOING_SEND;
      }
      outgoingStreak = 0;
      return TRANSLATION_INTENTS.MESSAGE_DISPLAY;
    }
    if (outgoing) {
      outgoingStreak = 0;
      return TRANSLATION_INTENTS.OUTGOING_SEND;
    }
    if (background) {
      outgoingStreak = 0;
      return TRANSLATION_INTENTS.MESSAGE_DISPLAY;
    }
    return '';
  }

  function start(item) {
    clearTimeout(item.timer);
    item.unsubscribeAbort?.();
    item.unsubscribeAbort = null;
    item.settled = true;

    if (item.signal?.aborted) {
      item.reject(item.signal.reason || capacityError('TRANSLATION_CANCELLED', '翻译请求已取消'));
      return false;
    }
    if (isPartitionDeleted(item.partition)) {
      item.reject(deletedError());
      return false;
    }
    if (item.deadlineAt <= now()) {
      item.reject(deadlineError());
      return false;
    }

    active += 1;
    activeByIntent[item.intent] += 1;
    Promise.resolve()
      .then(() => {
        if (isPartitionDeleted(item.partition)) throw deletedError();
        if (item.signal?.aborted) throw item.signal.reason || capacityError('TRANSLATION_CANCELLED', '翻译请求已取消');
        if (item.deadlineAt <= now()) throw deadlineError();
        return item.task();
      })
      .then(item.resolve, item.reject)
      .finally(() => {
        active = Math.max(0, active - 1);
        activeByIntent[item.intent] = Math.max(0, activeByIntent[item.intent] - 1);
        drain();
      });
    return true;
  }

  function drain() {
    let guard = 0;
    while (active < concurrency && queued > 0 && guard < totalQueueLimit + concurrency + 8) {
      guard += 1;
      const intent = nextIntent();
      if (!intent) return;
      const item = takeFromIntent(intent);
      if (!item) continue;
      start(item);
    }
  }

  function enqueue({ partition, intent, deadlineAt, task, signal = null }) {
    const owner = String(partition || '');
    const normalizedIntent = normalizeTranslationIntent(intent);
    if (!owner) return Promise.reject(capacityError('TRANSLATION_ACCOUNT_MISSING', '翻译账号沙箱不存在'));
    if (typeof task !== 'function') return Promise.reject(new TypeError('translation queue task is required'));
    if (isPartitionDeleted(owner)) return Promise.reject(deletedError());
    if (signal?.aborted) return Promise.reject(signal.reason || capacityError('TRANSLATION_CANCELLED', '翻译请求已取消'));
    const due = Number(deadlineAt);
    if (!Number.isFinite(due) || due <= now()) return Promise.reject(deadlineError());

    try { admitOrReject(normalizedIntent, owner); }
    catch (error) { return Promise.reject(error); }

    return new Promise((resolve, reject) => {
      const item = {
        id: ++sequence,
        partition: owner,
        intent: normalizedIntent,
        deadlineAt: due,
        task,
        signal,
        resolve,
        reject,
        settled: false,
        timer: null,
        unsubscribeAbort: null,
      };
      const queue = partitionQueue(normalizedIntent, owner, true);
      queue.push(item);
      queued += 1;

      item.unsubscribeAbort = signal
        ? subscribeAbort(signal, () => settleQueued(item, signal.reason || capacityError('TRANSLATION_CANCELLED', '翻译请求已取消')))
        : null;
      item.timer = setTimeout(() => settleQueued(item, deadlineError()), Math.max(1, due - now()));
      drain();
    });
  }

  function cancelPartition(partition, error = deletedError()) {
    const owner = String(partition || '');
    if (!owner) return 0;
    let cancelled = 0;
    for (const intent of Object.values(TRANSLATION_INTENTS)) {
      const queue = partitionQueue(intent, owner);
      if (!queue?.length) continue;
      for (const item of [...queue]) {
        if (settleQueued(item, error)) cancelled += 1;
      }
    }
    return cancelled;
  }

  function snapshot() {
    return Object.freeze({
      concurrency,
      outgoingReserve,
      outgoingBurst,
      active,
      activeOutgoing: activeByIntent[TRANSLATION_INTENTS.OUTGOING_SEND],
      activeBackground: activeByIntent[TRANSLATION_INTENTS.MESSAGE_DISPLAY],
      queued,
      queuedOutgoing: [...queues[TRANSLATION_INTENTS.OUTGOING_SEND].values()].reduce((sum, queue) => sum + queue.length, 0),
      queuedBackground: [...queues[TRANSLATION_INTENTS.MESSAGE_DISPLAY].values()].reduce((sum, queue) => sum + queue.length, 0),
      droppedBackground,
      totalQueueLimit,
      partitionQueueLimit,
      backgroundPartitionLimit,
    });
  }

  return Object.freeze({ enqueue, cancelPartition, snapshot, drain });
}

module.exports = {
  DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS,
  TRANSLATION_INTENTS,
  normalizeTranslationIntent,
  createTranslationSmartQueue,
};
