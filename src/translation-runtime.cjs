'use strict';

// Public Translation Runtime owner. The base module keeps the proven cache,
// auth, failover and gateway transaction machinery; this owner adds the
// explicit-intent admission layer before any request can reach that machinery.
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const base = require('./translation-runtime-base.cjs');
const { assertMainFrameIpcSender } = require('./main-frame-ipc-boundary.cjs');
const {
  normalizeTranslationSourceLanguage,
  normalizeTranslationTargetLanguage,
} = require('./translation-language-contract.cjs');
const {
  DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS,
  TRANSLATION_INTENTS,
  normalizeTranslationIntent,
  createTranslationSmartQueue,
} = require('./translation-smart-queue.cjs');

const TRANSLATION_INTENT_HEADER = 'X-Geek-Translation-Intent';
const DEFAULT_TRANSLATION_GATEWAY_URL = 'https://geek-translate.9529360.workers.dev';
const VALID_CALLER_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const SINGLEFLIGHT_IGNORED_FIELDS = new Set(['accountId', 'deadlineAt', 'intent', 'coalesce', 'requestId']);

function createTranslationRuntime(options = {}) {
  const {
    ipcMain,
    accountState,
    assertTrustedSender,
    assertSafeTranslationOutput,
    getSubscriptionStore,
    now = Date.now,
    fetchImpl = globalThis.fetch,
    env = process.env,
  } = options;

  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function') {
    throw new TypeError('ipcMain is required');
  }
  if (!accountState || typeof accountState.findById !== 'function') throw new TypeError('accountState is required');
  if (typeof assertTrustedSender !== 'function') throw new TypeError('assertTrustedSender is required');
  if (typeof assertSafeTranslationOutput !== 'function') throw new TypeError('assertSafeTranslationOutput is required');
  if (typeof getSubscriptionStore !== 'function') throw new TypeError('getSubscriptionStore is required');
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
  const authorizationLeaseContext = new AsyncLocalStorage();
  const sourceLanguageContext = new AsyncLocalStorage();
  const intentAwareFetch = (url, request = {}) => {
    const intent = normalizeTranslationIntent(intentContext.getStore());
    const headers = { ...(request.headers || {}), [TRANSLATION_INTENT_HEADER]: intent };
    return fetchImpl(url, { ...request, headers });
  };
  const sourceAwareOutputSafety = input => assertSafeTranslationOutput({
    ...(input && typeof input === 'object' ? input : {}),
    sourceLanguage: sourceLanguageContext.getStore() || 'auto',
  });

  // A queued request must stay bound to the subscription generation that admitted
  // it. The base runtime asks for authorization later, after cache/quota work; this
  // request-scoped proxy returns the already-captured lease so a logout/account
  // switch cannot make old queued work silently adopt the new session.
  function baseSubscriptionStore() {
    const store = getSubscriptionStore();
    const capturedLease = authorizationLeaseContext.getStore();
    if (!capturedLease || !store || typeof store !== 'object') return store;
    return new Proxy(store, {
      get(target, property) {
        if (property === 'getTranslationAuthorization') return async () => capturedLease;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  const baseRuntime = base.createTranslationRuntime({
    ...options,
    ipcMain: privateIpc,
    fetchImpl: intentAwareFetch,
    assertSafeTranslationOutput: sourceAwareOutputSafety,
    getSubscriptionStore: baseSubscriptionStore,
  });
  const deletedPartitions = new Set();

  // The smart queue may hold many requests from one authorization generation.
  // Fan them out behind one native AbortSignal listener instead of adding one
  // listener per queued request. The base transaction layer separately fan-outs
  // active gateway attempts, keeping the total listener count O(1), not O(requests).
  const schedulerAbortFanouts = new WeakMap();
  function subscribeSchedulerAbort(signal, subscriber) {
    if (!signal || typeof signal.addEventListener !== 'function' || typeof subscriber !== 'function') return () => {};
    if (signal.aborted) {
      subscriber(signal.reason || base.createTranslationError(
        'SUBSCRIPTION_SESSION_CHANGED',
        '登录状态已变化，请重试',
        { category: 'auth', retryable: true },
      ));
      return () => {};
    }
    let entry = schedulerAbortFanouts.get(signal);
    if (!entry) {
      const subscribers = new Set();
      const onAbort = () => {
        schedulerAbortFanouts.delete(signal);
        const reason = signal.reason || base.createTranslationError(
          'SUBSCRIPTION_SESSION_CHANGED',
          '登录状态已变化，请重试',
          { category: 'auth', retryable: true },
        );
        const callbacks = [...subscribers];
        subscribers.clear();
        for (const callback of callbacks) {
          try { callback(reason); } catch {}
        }
      };
      entry = { subscribers, onAbort };
      schedulerAbortFanouts.set(signal, entry);
      signal.addEventListener('abort', onAbort, { once: true });
    }
    entry.subscribers.add(subscriber);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const current = schedulerAbortFanouts.get(signal);
      if (!current) return;
      current.subscribers.delete(subscriber);
    };
  }

  const scheduler = createTranslationSmartQueue({
    concurrency: base.TRANSLATION_REMOTE_LIMIT,
    outgoingReserve: DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS.outgoingReserve,
    outgoingBurst: DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS.outgoingBurst,
    totalQueueLimit: DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS.totalQueueLimit,
    partitionQueueLimit: DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS.partitionQueueLimit,
    backgroundPartitionLimit: DEFAULT_TRANSLATION_SMART_QUEUE_OPTIONS.backgroundPartitionLimit,
    now,
    subscribeAbort: subscribeSchedulerAbort,
    isPartitionDeleted: partition => deletedPartitions.has(String(partition || '')),
    deadlineError: base.deadlineExceededError,
    deletedError: () => base.createTranslationError(
      'TRANSLATION_ACCOUNT_DELETED',
      '翻译账号已删除',
      { category: 'account', retryable: false },
    ),
  });
  const scheduledInflight = new Map();
  let installed = false;

  function baseHandler(channel) {
    const handler = baseHandlers.get(channel);
    if (typeof handler !== 'function') throw new Error(`translation base handler missing: ${channel}`);
    return handler;
  }

  function normalizeScheduledPayload(payload) {
    const body = payload && typeof payload === 'object' ? payload : {};
    const source = normalizeTranslationSourceLanguage(body.source);
    if (!source) {
      throw base.createTranslationError(
        'TRANSLATION_SOURCE_INVALID',
        '源语言不合法',
        { category: 'input', retryable: false },
      );
    }
    const target = normalizeTranslationTargetLanguage(body.target);
    if (!target) {
      throw base.createTranslationError(
        'TRANSLATION_TARGET_INVALID',
        '目标语言不合法',
        { category: 'input', retryable: false },
      );
    }
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
    return { ...body, source, target, intent, deadlineAt, ...(coalesce === undefined ? {} : { coalesce }) };
  }

  // Preserve the runtime's historical singleflight semantics *before* bounded
  // admission. Otherwise a cold duplicate burst can occupy every background slot
  // and later followers miss the leader merely because they waited in the queue.
  // The fingerprint is intentionally conservative: extra payload fields reduce
  // coalescing rather than risk merging requests the base runtime would distinguish.
  function scheduledSingleflightKey(body, partition) {
    if (body.intent !== TRANSLATION_INTENTS.MESSAGE_DISPLAY || body.refresh === true || body.coalesce === false) return '';
    const callerRequestId = typeof body.requestId === 'string' && VALID_CALLER_REQUEST_ID.test(body.requestId)
      ? body.requestId
      : '';
    const fingerprint = {};
    for (const key of Object.keys(body).sort()) {
      if (SINGLEFLIGHT_IGNORED_FIELDS.has(key)) continue;
      const value = body[key];
      if (value !== undefined) fingerprint[key] = value;
    }
    let serialized;
    try { serialized = JSON.stringify(fingerprint); }
    catch { return ''; }
    const digest = crypto.createHash('sha256').update(serialized).digest('hex');
    return `${partition}:${digest}${callerRequestId ? `:request:${callerRequestId}` : ''}`;
  }

  function awaitScheduledLeader(promise, deadlineAt) {
    const remaining = Number(deadlineAt) - Number(now());
    if (!Number.isFinite(remaining) || remaining <= 0) return Promise.reject(base.deadlineExceededError());
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(base.deadlineExceededError());
      }, Math.max(1, remaining));
      Promise.resolve(promise).then(
        value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        error => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  function gatewayNeedsRemoteAuthorization() {
    const configured = String(env?.GEEK_TRANSLATION_GATEWAY_URL || '').trim();
    const endpoints = configured
      ? configured.split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean)
      : [DEFAULT_TRANSLATION_GATEWAY_URL];
    return endpoints.some(endpoint => {
      try {
        const parsed = new URL(endpoint);
        return !(parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1');
      } catch {
        // The base runtime will project the configuration error. Treat malformed
        // endpoints as remote here so admission never weakens authorization first.
        return true;
      }
    });
  }

  function normalizeAdmissionAuthorizationError(error) {
    if (error?.code === 'SUBSCRIPTION_SESSION_CHANGED') {
      return base.createTranslationError(
        'SUBSCRIPTION_SESSION_CHANGED',
        error.message || '登录状态已变化，请重试',
        { category: 'auth', retryable: true, cause: error },
      );
    }
    if (error?.code === 'SUBSCRIPTION_LOGIN_REQUIRED') {
      return base.createTranslationError(
        'SUBSCRIPTION_LOGIN_REQUIRED',
        error.message || '请先登录',
        { category: 'auth', retryable: false, cause: error },
      );
    }
    if (error?.code === 'SUBSCRIPTION_REQUEST_TIMEOUT') return base.deadlineExceededError(error);
    return error;
  }

  async function captureAdmissionAuthorization(deadlineAt) {
    if (!gatewayNeedsRemoteAuthorization()) return null;
    const store = getSubscriptionStore();
    if (!store || typeof store.getTranslationAuthorization !== 'function') return null;
    if (typeof store.assertTranslationAuthorizationCurrent !== 'function') {
      throw new TypeError('subscription authorization lease validator is required');
    }
    const lease = await awaitScheduledLeader(store.getTranslationAuthorization(), deadlineAt);
    store.assertTranslationAuthorizationCurrent(lease);
    return lease;
  }

  function runBaseTranslation(event, body, authorizationLease = null) {
    return sourceLanguageContext.run(
      body.source,
      () => authorizationLeaseContext.run(
        authorizationLease,
        () => intentContext.run(body.intent, () => baseHandler('translation:translate')(event, body)),
      ),
    );
  }

  function scheduledTask(event, body, authorizationLease) {
    return () => runBaseTranslation(event, body, authorizationLease || null);
  }

  async function translateIpc(event, payload) {
    // Keep sender security outside the application envelope and before queueing.
    assertMainFrameIpcSender(event);
    assertTrustedSender(event);
    let body;
    try {
      body = normalizeScheduledPayload(payload);
    } catch (error) {
      return { ok: false, error: base.serializeTranslationIpcError(error) };
    }
    const accountId = String(body.accountId || '');
    const account = accountState.findById(accountId);
    const partition = String(account?.partition || '');

    // Let the base runtime project canonical typed input/account failures. The
    // scheduler only owns requests that have a real account partition.
    if (!partition) {
      return runBaseTranslation(event, body, null);
    }

    const singleflightKey = scheduledSingleflightKey(body, partition);
    if (singleflightKey) {
      const existing = scheduledInflight.get(singleflightKey);
      if (existing) {
        try {
          return await awaitScheduledLeader(existing, body.deadlineAt);
        } catch (error) {
          return { ok: false, error: base.serializeTranslationIpcError(error) };
        }
      }
    }

    // Capture authorization before bounded admission so queued work is fenced to
    // the session generation that created it. The promise is registered in
    // scheduledInflight immediately, so duplicate display requests still share
    // both the authorization preflight and the eventual translation transaction.
    const leader = (async () => {
      let authorizationLease = null;
      try {
        authorizationLease = await captureAdmissionAuthorization(body.deadlineAt);
      } catch (error) {
        throw normalizeAdmissionAuthorizationError(error);
      }
      return scheduler.enqueue({
        partition,
        intent: body.intent,
        deadlineAt: body.deadlineAt,
        signal: authorizationLease?.signal || null,
        task: scheduledTask(event, body, authorizationLease),
      });
    })();
    if (singleflightKey) {
      scheduledInflight.set(singleflightKey, leader);
      const cleanup = () => {
        if (scheduledInflight.get(singleflightKey) === leader) scheduledInflight.delete(singleflightKey);
      };
      leader.then(cleanup, cleanup);
    }

    try {
      return await leader;
    } catch (error) {
      return { ok: false, error: base.serializeTranslationIpcError(error) };
    }
  }

  async function health(event) {
    // Health exposes runtime and scheduler state, so reject child frames before
    // delegating to the base trusted-sender gate.
    assertMainFrameIpcSender(event);
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
    scheduledInflight.clear();
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
      for (const key of scheduledInflight.keys()) {
        if (key.startsWith(`${owner}:`)) scheduledInflight.delete(key);
      }
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
