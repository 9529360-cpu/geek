'use strict';

const path = require('node:path');
const crypto = require('node:crypto');

const TRANSLATION_CACHE_VERSION = 'prompt-20260822-2';
const TRANSLATION_REMOTE_LIMIT = 20;
const TRANSLATION_REQUEST_TIMEOUT_MS = 30000;
const TRANSLATION_CHANNELS = Object.freeze([
  'translation:translate',
  'translation:health',
]);
const TRANSLATION_VALID_PROVIDERS = new Set(['auto', 'local']);
const TRANSLATION_VALID_ROUTES = new Set(['default', 'primary', 'backup']);

function createTranslationError(code, message, options = {}) {
  const error = new Error(String(message || '翻译请求失败'));
  error.code = String(code || 'TRANSLATION_FAILED');
  error.category = String(options.category || 'gateway');
  error.retryable = options.retryable === true;
  error.endpointFailure = options.endpointFailure === true;
  if (Number.isInteger(options.status)) error.status = options.status;
  if (options.upstreamCode) error.upstreamCode = String(options.upstreamCode);
  if (options.cause) error.cause = options.cause;
  return error;
}

function deadlineExceededError(cause) {
  return createTranslationError(
    'TRANSLATION_DEADLINE_EXCEEDED',
    '翻译请求超时，请重试',
    { category: 'deadline', retryable: true, cause }
  );
}

function normalizeTranslationDeadline(value, now = Date.now(), maxDurationMs = TRANSLATION_REQUEST_TIMEOUT_MS) {
  const current = Number(now);
  const cap = current + Math.max(1, Number(maxDurationMs) || TRANSLATION_REQUEST_TIMEOUT_MS);
  const requested = Number(value);
  if (!Number.isFinite(requested)) return cap;
  return Math.min(requested, cap);
}

function normalizeTranslationProviderRoute(provider, route) {
  const providerValue = String(provider || '').toLowerCase();
  const routeValue = String(route || '').toLowerCase();
  return Object.freeze({
    provider: TRANSLATION_VALID_PROVIDERS.has(providerValue) ? providerValue : 'auto',
    route: TRANSLATION_VALID_ROUTES.has(routeValue) ? routeValue : 'default',
  });
}

function classifyGatewayResponse(status, result = {}) {
  const httpStatus = Number(status) || 0;
  const upstreamCode = typeof result?.error === 'string' && result.error.trim() ? result.error.trim() : '';
  const upstreamMessage = typeof result?.message === 'string' && result.message.trim()
    ? result.message.trim()
    : upstreamCode;

  if (upstreamCode === 'deadline_exceeded') {
    return createTranslationError(
      'TRANSLATION_DEADLINE_EXCEEDED',
      upstreamMessage || '翻译请求超时，请重试',
      { category: 'deadline', retryable: true, endpointFailure: false, status: httpStatus, upstreamCode }
    );
  }
  if (httpStatus === 400 || httpStatus === 404 || httpStatus === 422) {
    return createTranslationError(
      upstreamCode || 'TRANSLATION_REQUEST_INVALID',
      upstreamMessage || `翻译请求无效 (${httpStatus})`,
      { category: 'input', retryable: false, endpointFailure: false, status: httpStatus, upstreamCode }
    );
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return createTranslationError(
      upstreamCode || 'TRANSLATION_AUTH_REQUIRED',
      upstreamMessage || '翻译授权已失效，请重新登录',
      { category: 'auth', retryable: false, endpointFailure: false, status: httpStatus, upstreamCode }
    );
  }
  if (httpStatus === 402) {
    return createTranslationError(
      upstreamCode || 'QUOTA_EXHAUSTED',
      upstreamMessage || '翻译额度已用完，请前往个人中心开通',
      { category: 'quota', retryable: false, endpointFailure: false, status: httpStatus, upstreamCode }
    );
  }
  if (httpStatus === 409) {
    return createTranslationError(
      upstreamCode || 'TRANSLATION_REQUEST_CONFLICT',
      upstreamMessage || '翻译请求状态冲突，请重试',
      { category: 'conflict', retryable: false, endpointFailure: false, status: httpStatus, upstreamCode }
    );
  }
  if (httpStatus === 429) {
    return createTranslationError(
      upstreamCode || 'TRANSLATION_RATE_LIMITED',
      upstreamMessage || '翻译请求过于频繁，请稍后重试',
      { category: 'rate-limit', retryable: true, endpointFailure: false, status: httpStatus, upstreamCode }
    );
  }
  if (httpStatus === 408 || httpStatus === 425 || httpStatus >= 500) {
    return createTranslationError(
      upstreamCode || 'TRANSLATION_GATEWAY_RETRYABLE',
      upstreamMessage || `翻译网关错误 ${httpStatus}`,
      { category: 'gateway', retryable: true, endpointFailure: true, status: httpStatus, upstreamCode }
    );
  }
  return createTranslationError(
    upstreamCode || 'TRANSLATION_GATEWAY_REJECTED',
    upstreamMessage || `翻译网关错误 ${httpStatus}`,
    { category: 'gateway', retryable: false, endpointFailure: false, status: httpStatus, upstreamCode }
  );
}

function clearPartitionRuntimeState(state, partition) {
  const owner = String(partition || '');
  if (!owner) return;
  state.deletedPartitions.add(owner);
  state.caches.delete(owner);
  state.cacheLoaded.delete(owner);
  state.cacheLoads.delete(owner);
  state.cacheWrites.delete(owner);
  const prefix = `${owner}:`;
  for (const key of state.latestRequest.keys()) if (key.startsWith(prefix)) state.latestRequest.delete(key);
  for (const key of state.inflight.keys()) if (key.startsWith(prefix)) state.inflight.delete(key);
}

function createTranslationRuntime(options = {}) {
  const {
    ipcMain,
    fs,
    safeStorage,
    getUserDataDir,
    accountState,
    createGatewayPool,
    assertSafeTranslationOutput,
    assertTrustedSender,
    assertValidAccountId,
    getSubscriptionStore,
    fetchImpl = globalThis.fetch,
    env = process.env,
    randomUUID = crypto.randomUUID,
    now = Date.now,
  } = options;

  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function') throw new TypeError('ipcMain is required');
  if (!fs || typeof fs.readFile !== 'function' || typeof fs.appendFile !== 'function') throw new TypeError('fs promises API is required');
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') throw new TypeError('safeStorage is required');
  if (typeof getUserDataDir !== 'function') throw new TypeError('getUserDataDir is required');
  if (!accountState || typeof accountState.findById !== 'function') throw new TypeError('accountState is required');
  if (typeof createGatewayPool !== 'function') throw new TypeError('createGatewayPool is required');
  if (typeof assertSafeTranslationOutput !== 'function') throw new TypeError('assertSafeTranslationOutput is required');
  if (typeof assertTrustedSender !== 'function') throw new TypeError('assertTrustedSender is required');
  if (typeof assertValidAccountId !== 'function') throw new TypeError('assertValidAccountId is required');
  if (typeof getSubscriptionStore !== 'function') throw new TypeError('getSubscriptionStore is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');

  const state = {
    caches: new Map(),
    cacheLoaded: new Set(),
    cacheLoads: new Map(),
    deletedPartitions: new Set(),
    inflight: new Map(),
    cacheWrites: new Map(),
    latestRequest: new Map(),
  };
  let requestSequence = 0;
  let gatewayPool = null;
  const remoteQueue = [];
  const remoteControllersByPartition = new Map();
  let remoteActive = 0;
  let installed = false;

  function accountDeletedError() {
    const error = new Error('翻译账号已删除');
    error.code = 'TRANSLATION_ACCOUNT_DELETED';
    error.category = 'account';
    error.retryable = false;
    return error;
  }

  function remainingMs(deadlineAt) {
    return Number(deadlineAt) - Number(now());
  }

  function assertBeforeDeadline(deadlineAt) {
    if (remainingMs(deadlineAt) <= 0) throw deadlineExceededError();
  }

  function awaitWithDeadline(promise, deadlineAt) {
    const remaining = remainingMs(deadlineAt);
    if (remaining <= 0) return Promise.reject(deadlineExceededError());
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(deadlineExceededError());
      }, remaining);
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

  function normalizeRuntimeError(error) {
    if (!error) return createTranslationError('TRANSLATION_FAILED', '翻译请求失败');
    if (error.code === 'QUOTA_EXHAUSTED') {
      return createTranslationError('QUOTA_EXHAUSTED', error.message, { category: 'quota', retryable: false, cause: error });
    }
    if (error.code === 'SUBSCRIPTION_LOGIN_REQUIRED' || error.status === 401 || error.status === 403) {
      return createTranslationError(error.code || 'TRANSLATION_AUTH_REQUIRED', error.message || '请先登录', { category: 'auth', retryable: false, cause: error, status: error.status });
    }
    if (error.code === 'SUBSCRIPTION_SESSION_CHANGED') {
      return createTranslationError(error.code, error.message, { category: 'auth', retryable: true, cause: error });
    }
    if (error.code === 'SUBSCRIPTION_REQUEST_TIMEOUT') return deadlineExceededError(error);
    return error;
  }

  function cacheFile(partition) {
    const dirName = String(partition || '').replace(/^persist:/, '');
    if (!/^[a-zA-Z0-9_-]+$/.test(dirName)) throw new Error('账号沙箱不合法');
    return path.join(getUserDataDir(), 'Partitions', dirName, 'geek-translation-cache.jsonl');
  }

  function cacheKey(body, text, target) {
    return crypto.createHash('sha256').update(JSON.stringify({
      version: TRANSLATION_CACHE_VERSION,
      text,
      source: body.source || 'auto',
      target,
      provider: body.provider || 'auto',
      route: body.route || 'default',
    })).digest('hex');
  }

  async function loadCache(partition) {
    if (state.deletedPartitions.has(partition)) throw accountDeletedError();
    if (!state.caches.has(partition)) state.caches.set(partition, new Map());
    const cache = state.caches.get(partition);
    if (state.cacheLoaded.has(partition)) return cache;
    const existingLoad = state.cacheLoads.get(partition);
    if (existingLoad) return existingLoad;

    const load = (async () => {
      if (state.deletedPartitions.has(partition)) throw accountDeletedError();
      if (safeStorage.isEncryptionAvailable()) {
        try {
          const lines = (await fs.readFile(cacheFile(partition), 'utf-8')).split(/\r?\n/);
          if (state.deletedPartitions.has(partition)) throw accountDeletedError();
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const item = JSON.parse(line);
              if (item.version !== TRANSLATION_CACHE_VERSION || !item.key || !item.value) continue;
              cache.set(item.key, {
                text: safeStorage.decryptString(Buffer.from(item.value, 'base64')),
                at: Number(item.at) || 0,
              });
            } catch {}
          }
        } catch (error) {
          if (state.deletedPartitions.has(partition)) throw accountDeletedError();
        }
      }
      if (state.deletedPartitions.has(partition) || state.caches.get(partition) !== cache) throw accountDeletedError();
      state.cacheLoaded.add(partition);
      return cache;
    })();

    state.cacheLoads.set(partition, load);
    try {
      return await load;
    } finally {
      if (state.cacheLoads.get(partition) === load) state.cacheLoads.delete(partition);
    }
  }

  async function appendCache(partition, key, item) {
    if (state.deletedPartitions.has(partition) || !safeStorage.isEncryptionAvailable()) return;
    const file = cacheFile(partition);
    const record = {
      version: TRANSLATION_CACHE_VERSION,
      key,
      at: item.at,
      value: safeStorage.encryptString(item.text).toString('base64'),
    };
    const previous = state.cacheWrites.get(partition) || Promise.resolve();
    const write = previous.catch(() => {}).then(async () => {
      if (state.deletedPartitions.has(partition)) return;
      await fs.appendFile(file, JSON.stringify(record) + '\n', 'utf-8');
    });
    state.cacheWrites.set(partition, write);
    try {
      await write;
    } catch {} finally {
      if (state.cacheWrites.get(partition) === write) state.cacheWrites.delete(partition);
    }
  }

  function gatewayEndpoints() {
    const configured = String(env.GEEK_TRANSLATION_GATEWAY_URL || '').trim();
    const list = configured
      ? configured.split(',').map((value) => value.trim().replace(/\/$/, '')).filter(Boolean)
      : [];
    const endpoints = list.length ? list : ['https://geek-translate.9529360.workers.dev'];
    if (!endpoints.length) throw new Error('远程翻译服务尚未配置');
    for (const endpoint of endpoints) {
      let parsed;
      try { parsed = new URL(endpoint); } catch { throw new Error('翻译服务配置不安全'); }
      const allowedLocal = parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1';
      const allowedHttps = parsed.protocol === 'https:';
      if (!allowedLocal && !allowedHttps) throw new Error('翻译服务配置不安全');
      if (parsed.port && (Number(parsed.port) < 1 || Number(parsed.port) > 65535)) throw new Error('翻译服务配置不安全');
    }
    return endpoints;
  }

  function getGatewayPool() {
    if (!gatewayPool) {
      gatewayPool = createGatewayPool({
        endpoints: gatewayEndpoints(),
        healthFetch: async (url) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          try {
            const response = await fetchImpl(url, { signal: controller.signal });
            if (!response.ok) return { ok: false };
            const data = await response.json().catch(() => ({}));
            return { ok: data.ok !== false };
          } finally {
            clearTimeout(timer);
          }
        },
      });
    }
    return gatewayPool;
  }

  async function health(event) {
    assertTrustedSender(event);
    const pool = getGatewayPool();
    const result = await pool.healthCheckAll();
    const okCount = Object.values(result).filter(Boolean).length;
    return { ok: okCount > 0, models: okCount, endpointCount: Object.keys(result).length };
  }

  function enqueueRemote(partition, deadlineAt, task) {
    return new Promise((resolve, reject) => {
      if (state.deletedPartitions.has(partition)) {
        reject(accountDeletedError());
        return;
      }
      const remaining = remainingMs(deadlineAt);
      if (remaining <= 0) {
        reject(deadlineExceededError());
        return;
      }
      const item = { partition, deadlineAt, task, resolve, reject, timer: null, settled: false };
      item.timer = setTimeout(() => {
        if (item.settled) return;
        const index = remoteQueue.indexOf(item);
        if (index >= 0) remoteQueue.splice(index, 1);
        item.settled = true;
        reject(deadlineExceededError());
      }, remaining);
      remoteQueue.push(item);
      drainRemoteQueue();
    });
  }

  function drainRemoteQueue() {
    while (remoteActive < TRANSLATION_REMOTE_LIMIT && remoteQueue.length) {
      const item = remoteQueue.shift();
      if (item.settled) continue;
      clearTimeout(item.timer);
      item.settled = true;
      if (remainingMs(item.deadlineAt) <= 0) {
        item.reject(deadlineExceededError());
        continue;
      }
      remoteActive += 1;
      Promise.resolve().then(() => {
        if (state.deletedPartitions.has(item.partition)) throw accountDeletedError();
        assertBeforeDeadline(item.deadlineAt);
        return item.task();
      }).then(item.resolve, item.reject).finally(() => {
        remoteActive -= 1;
        drainRemoteQueue();
      });
    }
  }

  function trackRemoteController(partition, controller) {
    if (!remoteControllersByPartition.has(partition)) remoteControllersByPartition.set(partition, new Set());
    remoteControllersByPartition.get(partition).add(controller);
  }

  function untrackRemoteController(partition, controller) {
    const controllers = remoteControllersByPartition.get(partition);
    if (!controllers) return;
    controllers.delete(controller);
    if (!controllers.size) remoteControllersByPartition.delete(partition);
  }

  function cancelRemoteForPartition(partition) {
    const owner = String(partition || '');
    if (!owner) return;
    const error = accountDeletedError();
    for (let index = remoteQueue.length - 1; index >= 0; index -= 1) {
      if (remoteQueue[index].partition !== owner) continue;
      const [item] = remoteQueue.splice(index, 1);
      clearTimeout(item.timer);
      item.settled = true;
      item.reject(error);
    }
    const controllers = remoteControllersByPartition.get(owner);
    if (!controllers) return;
    for (const controller of [...controllers]) controller.abort(error);
    remoteControllersByPartition.delete(owner);
  }

  async function translate(event, payload) {
    assertTrustedSender(event);
    const rawBody = payload && typeof payload === 'object' ? payload : {};
    const canonicalRoute = normalizeTranslationProviderRoute(rawBody.provider, rawBody.route);
    const body = { ...rawBody, ...canonicalRoute };
    const pool = getGatewayPool();
    const text = String(body.text || '');
    const target = String(body.target || '').toLowerCase();
    if (!text.trim()) throw createTranslationError('TRANSLATION_INPUT_EMPTY', '翻译内容不能为空', { category: 'input' });
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(target) || target === 'auto') {
      throw createTranslationError('TRANSLATION_TARGET_INVALID', '目标语言不合法', { category: 'input' });
    }
    const accountId = String(body.accountId || '');
    assertValidAccountId(accountId);
    const account = accountState.findById(accountId);
    if (!account?.partition) throw createTranslationError('TRANSLATION_ACCOUNT_MISSING', '翻译账号沙箱不存在', { category: 'account' });
    const partition = account.partition;
    if (state.deletedPartitions.has(partition)) throw accountDeletedError();

    const key = cacheKey(body, text, target);
    const inflightKey = `${partition}:${key}`;
    const shouldCoalesce = body.refresh !== true && body.coalesce !== false;
    if (shouldCoalesce && state.inflight.has(inflightKey)) return state.inflight.get(inflightKey);

    const sequence = ++requestSequence;
    const requestId = typeof body.requestId === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(body.requestId)
      ? body.requestId
      : randomUUID();
    const deadlineAt = normalizeTranslationDeadline(body.deadlineAt, now(), TRANSLATION_REQUEST_TIMEOUT_MS);
    state.latestRequest.set(inflightKey, sequence);

    const request = (async () => {
      try {
        assertBeforeDeadline(deadlineAt);
        const cache = await awaitWithDeadline(loadCache(partition), deadlineAt);
        if (state.deletedPartitions.has(partition)) throw accountDeletedError();
        assertBeforeDeadline(deadlineAt);

        if (body.refresh !== true) {
          const cached = cache.get(key);
          if (cached) {
            try {
              const safeCachedText = assertSafeTranslationOutput({ source: text, output: cached.text, target });
              return { text: safeCachedText, source: body.source || 'auto', target, cached: true, requestId };
            } catch {
              cache.delete(key);
            }
          }
          if (body.isHistory === true && body.translateHistory !== true) {
            return { text: '', source: body.source || 'auto', target, cached: false, skipped: true, history: true, requestId };
          }
        }

        if (body.skipQuota !== true) {
          const quota = await awaitWithDeadline(
            getSubscriptionStore().getQuota({ network: false }).catch(() => ({ remaining_chars: null })),
            deadlineAt
          );
          if (quota.remaining_chars != null && quota.remaining_chars <= 0) {
            throw createTranslationError('QUOTA_EXHAUSTED', '翻译额度已用完，请前往个人中心开通', { category: 'quota', retryable: false });
          }
        }

        const needsRemoteAuthorization = pool.endpoints.some((endpoint) => {
          const parsed = new URL(endpoint);
          return !(parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1');
        });
        const remoteAuthorization = needsRemoteAuthorization
          ? await awaitWithDeadline(getSubscriptionStore().getTranslationToken(), deadlineAt)
          : '';
        if (state.deletedPartitions.has(partition)) throw accountDeletedError();
        assertBeforeDeadline(deadlineAt);

        return await enqueueRemote(partition, deadlineAt, async () => {
          if (state.deletedPartitions.has(partition)) throw accountDeletedError();
          let lastError = null;
          const attempts = Math.max(1, pool.endpoints.length);
          for (let attempt = 0; attempt < attempts; attempt += 1) {
            if (state.deletedPartitions.has(partition)) throw accountDeletedError();
            const remaining = remainingMs(deadlineAt);
            if (remaining <= 0) throw deadlineExceededError(lastError);

            const picked = pool.pick();
            const endpoint = picked.endpoint;
            const controller = new AbortController();
            trackRemoteController(partition, controller);
            const timer = setTimeout(() => controller.abort(deadlineExceededError(lastError)), remaining);
            try {
              const parsedEndpoint = new URL(endpoint);
              const isLocalGateway = parsedEndpoint.protocol === 'http:' && parsedEndpoint.hostname === '127.0.0.1';
              const headers = {
                'Content-Type': 'application/json',
                'X-Geek-Client': '1',
                'X-Request-ID': requestId,
                'X-Geek-Deadline-Ms': String(Math.max(0, remaining)),
              };
              if (!isLocalGateway) headers.Authorization = `Bearer ${remoteAuthorization}`;
              const response = await fetchImpl(`${endpoint}/v1/translate`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                  text,
                  source: body.source || 'auto',
                  target,
                  provider: body.provider,
                  route: body.route || picked.route,
                }),
                signal: controller.signal,
              });
              const raw = await response.text();
              let result;
              try { result = JSON.parse(raw); } catch { result = {}; }
              if (!response.ok) {
                const rejection = classifyGatewayResponse(response.status, result);
                if (rejection.endpointFailure) pool.reportFailure(endpoint);
                lastError = rejection;
                if (!rejection.retryable || !rejection.endpointFailure) throw rejection;
                continue;
              }
              if (!result.text || typeof result.text !== 'string') {
                pool.reportFailure(endpoint);
                lastError = createTranslationError(
                  'TRANSLATION_GATEWAY_INVALID_RESPONSE',
                  '翻译网关返回格式错误',
                  { category: 'gateway', retryable: true, endpointFailure: true }
                );
                continue;
              }
              let translated;
              try {
                translated = assertSafeTranslationOutput({ source: text, output: result.text, target });
              } catch (error) {
                lastError = createTranslationError(
                  error?.code || 'TRANSLATION_QUALITY_REJECTED',
                  error?.message || '翻译结果未通过安全校验',
                  { category: 'quality', retryable: true, endpointFailure: false, cause: error }
                );
                continue;
              }
              pool.reportSuccess(endpoint);
              if (state.deletedPartitions.has(partition)) throw accountDeletedError();
              if (state.latestRequest.get(inflightKey) !== sequence) {
                return {
                  text: translated,
                  source: result.source || body.source || 'auto',
                  target: result.target || target,
                  cached: false,
                  superseded: true,
                  route: picked.route,
                  requestId,
                };
              }
              const item = { text: translated, at: now() };
              cache.set(key, item);
              await appendCache(partition, key, item);
              if (state.deletedPartitions.has(partition)) throw accountDeletedError();
              return {
                text: translated,
                source: result.source || body.source || 'auto',
                target: result.target || target,
                cached: false,
                route: picked.route,
                requestId,
              };
            } catch (error) {
              if (state.deletedPartitions.has(partition)) throw accountDeletedError();
              if (controller.signal.aborted) {
                const reason = controller.signal.reason;
                if (reason?.code === 'TRANSLATION_ACCOUNT_DELETED') throw reason;
                throw reason?.code === 'TRANSLATION_DEADLINE_EXCEEDED' ? reason : deadlineExceededError(error);
              }
              const normalizedBase = normalizeRuntimeError(error);
              const normalized = normalizedBase?.code || normalizedBase?.category
                ? normalizedBase
                : createTranslationError(
                  'TRANSLATION_GATEWAY_NETWORK',
                  normalizedBase?.message || '翻译网关连接失败',
                  { category: 'gateway', retryable: true, endpointFailure: true, cause: normalizedBase }
                );
              if (normalized.endpointFailure) pool.reportFailure(endpoint);
              if (!normalized.retryable || !normalized.endpointFailure) throw normalized;
              lastError = normalized;
            } finally {
              clearTimeout(timer);
              untrackRemoteController(partition, controller);
            }
          }
          throw lastError || createTranslationError('TRANSLATION_GATEWAY_UNAVAILABLE', '翻译网关不可用', { category: 'gateway', retryable: true, endpointFailure: true });
        });
      } catch (error) {
        throw normalizeRuntimeError(error);
      }
    })();

    state.inflight.set(inflightKey, request);
    try {
      return await request;
    } finally {
      if (state.inflight.get(inflightKey) === request) state.inflight.delete(inflightKey);
    }
  }

  function deleteAccount(partition) {
    const owner = String(partition || '');
    clearPartitionRuntimeState(state, owner);
    cancelRemoteForPartition(owner);
  }

  function install() {
    if (installed) throw new Error('translation runtime already installed');
    ipcMain.handle('translation:translate', translate);
    ipcMain.handle('translation:health', health);
    installed = true;
    return api;
  }

  function dispose() {
    if (!installed) return;
    for (const channel of TRANSLATION_CHANNELS) ipcMain.removeHandler(channel);
    installed = false;
  }

  const api = Object.freeze({ install, dispose, deleteAccount });
  return api;
}

module.exports = {
  TRANSLATION_CACHE_VERSION,
  TRANSLATION_REMOTE_LIMIT,
  TRANSLATION_REQUEST_TIMEOUT_MS,
  TRANSLATION_CHANNELS,
  createTranslationError,
  deadlineExceededError,
  normalizeTranslationDeadline,
  normalizeTranslationProviderRoute,
  classifyGatewayResponse,
  clearPartitionRuntimeState,
  createTranslationRuntime,
};