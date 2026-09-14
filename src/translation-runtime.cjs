'use strict';

const path = require('node:path');
const crypto = require('node:crypto');

const TRANSLATION_CACHE_VERSION = 'prompt-20260822-2';
const TRANSLATION_REMOTE_LIMIT = 20;
const TRANSLATION_CHANNELS = Object.freeze([
  'translation:translate',
  'translation:health',
]);

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
      await fs.mkdir(path.dirname(file), { recursive: true });
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

  function enqueueRemote(partition, task) {
    return new Promise((resolve, reject) => {
      if (state.deletedPartitions.has(partition)) {
        reject(accountDeletedError());
        return;
      }
      remoteQueue.push({ partition, task, resolve, reject });
      drainRemoteQueue();
    });
  }

  function drainRemoteQueue() {
    while (remoteActive < TRANSLATION_REMOTE_LIMIT && remoteQueue.length) {
      const item = remoteQueue.shift();
      remoteActive += 1;
      Promise.resolve().then(() => {
        if (state.deletedPartitions.has(item.partition)) throw accountDeletedError();
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
      item.reject(error);
    }
    const controllers = remoteControllersByPartition.get(owner);
    if (!controllers) return;
    for (const controller of [...controllers]) controller.abort(error);
    remoteControllersByPartition.delete(owner);
  }

  async function translate(event, payload) {
    assertTrustedSender(event);
    const body = payload && typeof payload === 'object' ? payload : {};
    const pool = getGatewayPool();
    const text = String(body.text || '');
    const target = String(body.target || '').toLowerCase();
    if (!text.trim()) throw new Error('翻译内容不能为空');
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(target) || target === 'auto') throw new Error('目标语言不合法');
    const accountId = String(body.accountId || '');
    assertValidAccountId(accountId);
    const account = accountState.findById(accountId);
    if (!account?.partition) throw new Error('翻译账号沙箱不存在');
    const partition = account.partition;
    if (state.deletedPartitions.has(partition)) throw accountDeletedError();
    const cache = await loadCache(partition);
    if (state.deletedPartitions.has(partition)) throw accountDeletedError();
    const key = cacheKey(body, text, target);
    const inflightKey = `${partition}:${key}`;

    if (body.refresh !== true) {
      const cached = cache.get(key);
      if (cached) {
        try {
          const safeCachedText = assertSafeTranslationOutput({ source: text, output: cached.text, target });
          return { text: safeCachedText, source: body.source || 'auto', target, cached: true };
        } catch {
          cache.delete(key);
        }
      }
      if (body.isHistory === true && body.translateHistory !== true) {
        return { text: '', source: body.source || 'auto', target, cached: false, skipped: true, history: true };
      }
      if (state.inflight.has(inflightKey)) return state.inflight.get(inflightKey);
    }

    if (body.skipQuota !== true) {
      const quota = await getSubscriptionStore().getQuota({ network: false }).catch(() => ({ remaining_chars: null }));
      if (quota.remaining_chars != null && quota.remaining_chars <= 0) {
        const error = new Error('翻译额度已用完，请前往个人中心开通');
        error.code = 'QUOTA_EXHAUSTED';
        throw error;
      }
    }

    const sequence = ++requestSequence;
    const needsRemoteAuthorization = pool.endpoints.some((endpoint) => {
      const parsed = new URL(endpoint);
      return !(parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1');
    });
    const remoteAuthorization = needsRemoteAuthorization ? await getSubscriptionStore().getTranslationToken() : '';
    if (state.deletedPartitions.has(partition)) throw accountDeletedError();
    const requestId = randomUUID();
    state.latestRequest.set(inflightKey, sequence);

    const request = enqueueRemote(partition, async () => {
      if (state.deletedPartitions.has(partition)) throw accountDeletedError();
      let lastError = null;
      const attempts = Math.max(1, pool.endpoints.length);
      const deadline = Date.now() + 30000;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (state.deletedPartitions.has(partition)) {
          lastError = accountDeletedError();
          break;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          lastError = lastError || new Error('翻译网关请求超时');
          break;
        }
        const picked = pool.pick();
        const endpoint = picked.endpoint;
        const controller = new AbortController();
        trackRemoteController(partition, controller);
        const timer = setTimeout(() => controller.abort(), remaining);
        try {
          const parsedEndpoint = new URL(endpoint);
          const isLocalGateway = parsedEndpoint.protocol === 'http:' && parsedEndpoint.hostname === '127.0.0.1';
          const headers = {
            'Content-Type': 'application/json',
            'X-Geek-Client': '1',
            'X-Request-ID': requestId,
          };
          if (!isLocalGateway) headers.Authorization = `Bearer ${remoteAuthorization}`;
          const response = await fetchImpl(`${endpoint}/v1/translate`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              text,
              source: body.source || 'auto',
              target,
              provider: body.provider || 'auto',
              route: body.route || picked.route,
            }),
            signal: controller.signal,
          });
          const raw = await response.text();
          let result;
          try { result = JSON.parse(raw); } catch { result = {}; }
          if (!response.ok) {
            pool.reportFailure(endpoint);
            lastError = new Error(String(result.error || `翻译网关错误 ${response.status}`).slice(0, 300));
            continue;
          }
          if (!result.text || typeof result.text !== 'string') {
            pool.reportFailure(endpoint);
            lastError = new Error('翻译网关返回格式错误');
            continue;
          }
          let translated;
          try {
            translated = assertSafeTranslationOutput({ source: text, output: result.text, target });
          } catch (error) {
            pool.reportFailure(endpoint);
            lastError = error;
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
            };
          }
          const item = { text: translated, at: Date.now() };
          cache.set(key, item);
          await appendCache(partition, key, item);
          return {
            text: translated,
            source: result.source || body.source || 'auto',
            target: result.target || target,
            cached: false,
            route: picked.route,
          };
        } catch (error) {
          if (state.deletedPartitions.has(partition)) {
            lastError = accountDeletedError();
            break;
          }
          pool.reportFailure(endpoint);
          if (error?.name === 'AbortError') lastError = new Error('翻译网关请求超时');
          else if (error?.message === '翻译账号已删除') {
            lastError = error;
            break;
          } else lastError = error;
        } finally {
          clearTimeout(timer);
          untrackRemoteController(partition, controller);
        }
      }
      throw lastError || new Error('翻译网关不可用');
    });

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
  TRANSLATION_CHANNELS,
  clearPartitionRuntimeState,
  createTranslationRuntime,
};
