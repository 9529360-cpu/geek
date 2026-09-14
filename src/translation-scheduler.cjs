'use strict';

const PRIORITY_INTERACTIVE = 'interactive';
const PRIORITY_BACKGROUND = 'background';

function schedulerError(code, message, category = 'scheduler', retryable = true) {
  const error = new Error(String(message || code || 'translation scheduler error'));
  error.code = String(code || 'TRANSLATION_SCHEDULER_ERROR');
  error.category = String(category || 'scheduler');
  error.retryable = retryable === true;
  error.endpointFailure = false;
  return error;
}

function createTranslationScheduler(options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency) || 20);
  const interactiveReserve = Math.max(1, Math.min(concurrency, Number(options.interactiveReserve) || 4));
  const backgroundCapacity = Math.max(0, concurrency - interactiveReserve);
  const backgroundPerPartitionActive = Math.max(1, Number(options.backgroundPerPartitionActive) || 4);
  const interactivePerPartitionActive = Math.max(1, Number(options.interactivePerPartitionActive) || 4);
  const backgroundPerPartitionQueued = Math.max(1, Number(options.backgroundPerPartitionQueued) || 8);
  const interactivePerPartitionQueued = Math.max(1, Number(options.interactivePerPartitionQueued) || 8);
  const now = typeof options.now === 'function' ? options.now : Date.now;

  const queues = {
    [PRIORITY_INTERACTIVE]: new Map(),
    [PRIORITY_BACKGROUND]: new Map(),
  };
  const rings = {
    [PRIORITY_INTERACTIVE]: [],
    [PRIORITY_BACKGROUND]: [],
  };
  const activeByPriorityPartition = {
    [PRIORITY_INTERACTIVE]: new Map(),
    [PRIORITY_BACKGROUND]: new Map(),
  };
  let activeTotal = 0;
  let activeBackground = 0;

  function normalizePriority(priority) {
    return priority === PRIORITY_INTERACTIVE ? PRIORITY_INTERACTIVE : PRIORITY_BACKGROUND;
  }

  function activeCount(priority, partition) {
    return activeByPriorityPartition[priority].get(partition) || 0;
  }

  function incrementActive(priority, partition, delta) {
    const map = activeByPriorityPartition[priority];
    const next = Math.max(0, (map.get(partition) || 0) + delta);
    if (next) map.set(partition, next);
    else map.delete(partition);
  }

  function activeLimit(priority) {
    return priority === PRIORITY_INTERACTIVE ? interactivePerPartitionActive : backgroundPerPartitionActive;
  }

  function queueLimit(priority) {
    return priority === PRIORITY_INTERACTIVE ? interactivePerPartitionQueued : backgroundPerPartitionQueued;
  }

  function enqueueItem(item) {
    const map = queues[item.priority];
    let queue = map.get(item.partition);
    if (!queue) {
      queue = [];
      map.set(item.partition, queue);
      rings[item.priority].push(item.partition);
    }
    if (queue.length >= queueLimit(item.priority)) {
      throw schedulerError(
        'TRANSLATION_BUSY',
        item.priority === PRIORITY_INTERACTIVE ? '翻译发送队列繁忙，请稍后重试' : '后台翻译队列繁忙',
        'busy',
        true,
      );
    }
    queue.push(item);
  }

  function removeQueuedItem(item) {
    const map = queues[item.priority];
    const queue = map.get(item.partition);
    if (!queue) return false;
    const index = queue.indexOf(item);
    if (index < 0) return false;
    queue.splice(index, 1);
    if (!queue.length) {
      map.delete(item.partition);
      rings[item.priority] = rings[item.priority].filter(partition => partition !== item.partition);
    }
    return true;
  }

  function takeNext(priority) {
    const ring = rings[priority];
    const map = queues[priority];
    const candidates = ring.length;
    for (let index = 0; index < candidates; index += 1) {
      const partition = ring.shift();
      const queue = map.get(partition);
      if (!queue?.length) {
        map.delete(partition);
        continue;
      }
      if (activeCount(priority, partition) >= activeLimit(priority)) {
        ring.push(partition);
        continue;
      }
      const item = queue.shift();
      if (queue.length) ring.push(partition);
      else map.delete(partition);
      return item;
    }
    return null;
  }

  function canStartBackground() {
    return activeTotal < concurrency && activeBackground < backgroundCapacity;
  }

  function settleExpired(item) {
    if (item.settled) return;
    item.settled = true;
    clearTimeout(item.timer);
    item.reject(schedulerError('TRANSLATION_DEADLINE_EXCEEDED', '翻译请求超时，请重试', 'deadline', true));
  }

  function start(item) {
    if (item.settled) return;
    clearTimeout(item.timer);
    if (item.deadlineAt <= now()) {
      settleExpired(item);
      return;
    }
    item.settled = true;
    activeTotal += 1;
    if (item.priority === PRIORITY_BACKGROUND) activeBackground += 1;
    incrementActive(item.priority, item.partition, 1);
    Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => {
      activeTotal -= 1;
      if (item.priority === PRIORITY_BACKGROUND) activeBackground -= 1;
      incrementActive(item.priority, item.partition, -1);
      drain();
    });
  }

  function drain() {
    while (activeTotal < concurrency) {
      let item = takeNext(PRIORITY_INTERACTIVE);
      if (!item && canStartBackground()) item = takeNext(PRIORITY_BACKGROUND);
      if (!item) break;
      start(item);
    }
  }

  function enqueue({ partition, priority, deadlineAt, task }) {
    const owner = String(partition || '');
    if (!owner) return Promise.reject(new TypeError('translation scheduler requires partition'));
    if (typeof task !== 'function') return Promise.reject(new TypeError('translation scheduler requires task'));
    const normalizedPriority = normalizePriority(priority);
    const deadline = Number(deadlineAt);
    if (!Number.isFinite(deadline) || deadline <= now()) {
      return Promise.reject(schedulerError('TRANSLATION_DEADLINE_EXCEEDED', '翻译请求超时，请重试', 'deadline', true));
    }

    return new Promise((resolve, reject) => {
      const item = {
        partition: owner,
        priority: normalizedPriority,
        deadlineAt: deadline,
        task,
        resolve,
        reject,
        timer: null,
        settled: false,
      };
      try {
        enqueueItem(item);
      } catch (error) {
        reject(error);
        return;
      }
      item.timer = setTimeout(() => {
        if (item.settled) return;
        if (!removeQueuedItem(item)) return;
        settleExpired(item);
      }, Math.max(1, deadline - now()));
      drain();
    });
  }

  function cancelPartition(partition, error = schedulerError('TRANSLATION_CANCELLED', '翻译请求已取消', 'cancelled', false)) {
    const owner = String(partition || '');
    if (!owner) return 0;
    let cancelled = 0;
    for (const priority of [PRIORITY_INTERACTIVE, PRIORITY_BACKGROUND]) {
      const map = queues[priority];
      const queue = map.get(owner) || [];
      map.delete(owner);
      rings[priority] = rings[priority].filter(partitionId => partitionId !== owner);
      for (const item of queue) {
        if (item.settled) continue;
        item.settled = true;
        clearTimeout(item.timer);
        item.reject(error);
        cancelled += 1;
      }
    }
    return cancelled;
  }

  function stats() {
    const queued = priority => [...queues[priority].values()].reduce((sum, queue) => sum + queue.length, 0);
    return Object.freeze({
      activeTotal,
      activeBackground,
      queuedInteractive: queued(PRIORITY_INTERACTIVE),
      queuedBackground: queued(PRIORITY_BACKGROUND),
    });
  }

  return Object.freeze({ enqueue, cancelPartition, stats });
}

module.exports = {
  PRIORITY_INTERACTIVE,
  PRIORITY_BACKGROUND,
  schedulerError,
  createTranslationScheduler,
};
