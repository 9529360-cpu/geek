'use strict';

// Public Translation Runtime owner. The base module keeps the proven cache,
// auth, failover and gateway transaction machinery; this owner adds the
// explicit-intent admission layer before any request can reach that machinery.
const { AsyncLocalStorage } = require('node:async_hooks');
const base = require('./translation-runtime-base.cjs');
const {
  DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS,
  TRANSLATION_INTENTS,
  normalizeTranslationIntent,
  createTranslationSmartQueue,
} = require('./translation-smart-queue.cjs');

const TRANSLATION_INTENT_HEADER = 'X-Geek-Translation-Intent';

function createTranslationRuntime(options = {}) {
  const {
    ipcMain,
    accountState,
    assertTrustedSender,
    now = Date.now,
    fetchImpl = globalThis.fetch,
  } = options;

  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function') {
    throw new TypeError('ipcMain is required');
  }
  if (!accountState || typeof accountState.findById !== 'function') throw new TypeError('accountState is required');
  if (typeof assertTrustedSender !== 'function') throw new TypeError('assertTrustedSender is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');

  // The base runtime registers against this private registrar. Only this public
  // owner registers real Electron IPC handlers, preserving the single-owner
  // boundary while allowing scheduling to wrap the complete base transaction.
  const baseHandlers = new Map();
  const privateIpc = {
    handle(channel, handler) {
      if (baseHandlers.has(channel)) throw new Error(`duplicate private translation handler: ${channel}`);
      baseHandlers.set(channel, handler);
    },
    removeHandler(channel) {
      baseHandlers.delete(channel);
    },
  };

  // Intent is QoS metadata only. Keep it out of the translation body/cache key
  // and carry it over a bounded header at the final fetch boundary. Async-local
  // context prevents concurrent account requests from contaminating each other.
  const intentContext = new AsyncLocalStorage();
  const intentAwareFetch = (url, request = {}) => {
    const intent = normalizeTranslationIntent(intentContext.getStore());
    const headers = { ...(request.headers || {}), [TRANSLATION_INTENT_HEADER]: intent };
    return fetchImpl(url, { ...request, headers });
  };
  const baseRuntime = base.createTranslationRuntime({ ...options, ipcMain: privateIpc, fetchImpl: intentAwareFetch });
  const deletedPartitions = new Set();
  const scheduler = createTranslationSmartQueue({
    concurrency: base.TRANSLATION_REMOTE_LIMIT,
    outgoingReserve: DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS.outgoingReserve,
    outgoingBurst: DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS.outgoingBurst,
    totalQueueLimit: DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS.totalQueueLimit,
    partitionQueueLimit: DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS.partitionQueueLimit,
    backgroundPartitionLimit: DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS.backgroundPartitionLimit,
    now,
    isPartitionDeleted: partition => deletedPartitions.has(String(partition || '')),
    deadlineError: base.deadlineExceededError,
    deletedError: () => base.createTranslationError(
      'TRANSLATION_ACCOUNT_DELETED',
      '翻译账号已删除',
      { category: 'account', retryable: false },
    ),
  });
  let installed = false;

  function baseHandler(channel) {
    const handler = baseHandlers.get(channel);
    if (typeof handler !== 'function') throw new Error(`translation base handler missing: ${channel}`);
    return handler;
  }

  function normalizeScheduledPayload(payload) {
    const body = payload && typeof payload === 'object' ? payload : {};
    const intent = normalizeTranslationIntent(body.intent);
    const deadlineAt = base.normalizeTranslationDeadline(
      body.deadlineAt,
      Number(now()),
      base.TRANSLATION_REQUEST_TIMEOUT_MS,
    );
    // Outgoing work must never coalesce behind an already-running background
    // display request with the same text/config. Cache identity remains shared;
    // only the live transaction identity is separated.
    const coalesce = intent === TRANSLATION_INTENTS.OUTGOING_SEND ? false : body.coalesce;
    return { ...body, intent, deadlineAt, ...(coalesce === undefined ? {} : { coalesce }) };
  }

  async function translateIpc(event, payload) {
    // Keep sender security outside the application envelope and before queueing.
    assertTrustedSender(event);
    const body = normalizeScheduledPayload(payload);
    const accountId = String(body.accountId || '');
    const account = accountState.findById(accountId);
    const partition = String(account?.partition || '');

    // Let the base runtime project canonical typed input/account failures. The
    // scheduler only owns requests that have a real account partition.
    if (!partition) {
      return intentContext.run(body.intent, () => baseHandler('translation:translate')(event, body));
    }

    try {
      return await scheduler.enqueue({
        partition,
        intent: body.intent,
        deadlineAt: body.deadlineAt,
        task: () => intentContext.run(body.intent, () => baseHandler('translation:translate')(event, body)),
      });
    } catch (error) {
      return { ok: false, error: base.serializeTranslationIpcError(error) };
    }
  }

  async function health(event) {
    const result = await baseHandler('translation:health')(event);
    return Object.freeze({ ...result, scheduler: scheduler.snapshot() });
  }

  function install() {
    if (installed) throw new Error('translation runtime already installed');
    baseRuntime.install();
    ipcMain.handle('translation:translate', translateIpc);
    ipcMain.handle('translation:health', health);
    installed = true;
    return api;
  }

  function dispose() {
    if (!installed) return;
    for (const channel of base.TRANSLATION_CHANNELS) ipcMain.removeHandler(channel);
    baseRuntime.dispose();
    installed = false;
  }

  function deleteAccount(partition) {
    const owner = String(partition || '');
    if (owner) {
      deletedPartitions.add(owner);
      scheduler.cancelPartition(owner, base.createTranslationError(
        'TRANSLATION_ACCOUNT_DELETED',
        '翻译账号已删除',
        { category: 'account', retryable: false },
      ));
    }
    baseRuntime.deleteAccount(owner);
  }

  function schedulerSnapshot() {
    return scheduler.snapshot();
  }

  const api = Object.freeze({ install, dispose, deleteAccount, schedulerSnapshot });
  return api;
}

module.exports = {
  ...base,
  TRANSLATION_INTENT_HEADER,
  DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS,
  TRANSLATION_INTENTS,
  normalizeTranslationIntent,
  createTranslationSmartQueue,
  createTranslationRuntime,
};
