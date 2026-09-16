'use strict';
// 极客付费订阅客户端模块
// - token/订阅状态存储：<userData>/subscription.json（敏感 token 使用 safeStorage 加密）
// - 远程 API：环境变量 GEEK_SUBSCRIPTION_API_URL 覆盖，默认 Cloudflare Worker
// - 能力：状态读取/刷新、登录、注册、下单、登出

const path = require('node:path');
const fs = require('node:fs/promises');
const { normalizeSubscriptionApiBase } = require('./subscription-api-url.cjs');

const DEFAULT_API_URL = 'https://geek-subscription.9529360.workers.dev';
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const ACCOUNT_NO_PATTERN = /^GK-[0-9a-f]{32}$/;
const TOKEN_DECRYPT_ERROR = 'SUBSCRIPTION_TOKEN_DECRYPT_FAILED';
const STATE_RECOVERY_ERROR = 'SUBSCRIPTION_STATE_RECOVERY_REQUIRED';

// 敏感字段加密（safeStorage DPAPI）：token 等不落明文
// 注入方式：main.cjs 里通过 initSubscriptionStore() 把 {encrypt, decrypt} 传进来
let secureCrypto = null;
function setSecureCrypto(cryptoImpl) {
  secureCrypto = cryptoImpl;
}
function encryptField(text) {
  if (!text) return '';
  if (!secureCrypto || typeof secureCrypto.encrypt !== 'function') {
    const error = new Error('系统安全存储不可用，拒绝明文保存订阅 token');
    error.code = 'SECURE_STORAGE_UNAVAILABLE';
    throw error;
  }
  try {
    return 'enc:' + secureCrypto.encrypt(String(text));
  } catch (cause) {
    const error = new Error('订阅 token 加密失败，未写入磁盘');
    error.code = 'SECURE_STORAGE_ENCRYPT_FAILED';
    error.cause = cause;
    throw error;
  }
}
function decryptField(value) {
  if (typeof value !== 'string' || !value.startsWith('enc:')) return value;
  if (!secureCrypto || typeof secureCrypto.decrypt !== 'function') {
    const error = new Error('系统安全存储不可用，无法读取订阅 token');
    error.code = 'SECURE_STORAGE_UNAVAILABLE';
    throw error;
  }
  try {
    const decrypted = secureCrypto.decrypt(value.slice(4));
    if (typeof decrypted !== 'string' || !decrypted) throw new Error('decrypted token is empty');
    return decrypted;
  } catch (cause) {
    const error = new Error('订阅 token 解密失败，请重试');
    error.code = TOKEN_DECRYPT_ERROR;
    error.cause = cause;
    throw error;
  }
}

function apiBase() {
  return normalizeSubscriptionApiBase(process.env.GEEK_SUBSCRIPTION_API_URL || DEFAULT_API_URL);
}

function normalizeUserIdentity(value = {}) {
  const numeric = Number(value.user_id ?? value.id);
  const userId = Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
  const accountNo = typeof value.account_no === 'string' && ACCOUNT_NO_PATTERN.test(value.account_no)
    ? value.account_no
    : '';
  return {
    user_id: userId,
    account_no: accountNo,
    account_ref: accountNo,
  };
}

function createSubscriptionStore({ userDataDir, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS }) {
  const stateFile = () => path.join(userDataDir, 'subscription.json');
  const parsedRequestTimeoutMs = Number(requestTimeoutMs);
  const boundedRequestTimeoutMs = Number.isFinite(parsedRequestTimeoutMs) && parsedRequestTimeoutMs > 0
    ? Math.floor(parsedRequestTimeoutMs)
    : DEFAULT_REQUEST_TIMEOUT_MS;
  let diskWriteQueue = Promise.resolve();

  function stateRecoveryError(cause) {
    const error = new Error('订阅登录状态不可读取，请重试或重新登录');
    error.code = STATE_RECOVERY_ERROR;
    error.cause = cause;
    return error;
  }

  async function readStateDisk() {
    let raw;
    try {
      raw = await fs.readFile(stateFile(), 'utf-8');
    } catch (cause) {
      if (cause?.code === 'ENOENT') return null;
      throw stateRecoveryError(cause);
    }

    let loaded;
    try {
      loaded = JSON.parse(raw);
    } catch (cause) {
      throw stateRecoveryError(cause);
    }
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
      throw stateRecoveryError(new TypeError('subscription state must be a JSON object'));
    }
    return loaded;
  }

  async function safeRemove(file) {
    try { await fs.rm(file, { force: true }); } catch {}
  }

  async function writeSynced(file, content) {
    let handle;
    try {
      handle = await fs.open(file, 'w', 0o600);
      await handle.writeFile(content, 'utf8');
      if (typeof handle.sync === 'function') await handle.sync();
    } finally {
      if (handle) await handle.close();
    }
  }

  async function syncDirectory(directory) {
    let handle;
    try {
      handle = await fs.open(directory, 'r');
      if (typeof handle.sync === 'function') await handle.sync();
    } catch {
      // Directory fsync is unsupported on some Windows/filesystem combinations.
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }

  function writeStateDisk(disk, options = {}) {
    const expectedSessionGeneration = options.expectedSessionGeneration;
    const queued = diskWriteQueue.then(async () => {
      // Cold-load compatibility rewrites may be queued behind a logout write. Re-check
      // lifecycle ownership at physical execution time so an old rewrite cannot follow the tombstone.
      assertSessionGeneration(expectedSessionGeneration);
      const target = stateFile();
      const temporary = `${target}.tmp`;
      const directory = path.dirname(target);
      const snapshot = JSON.stringify(disk, null, 2);
      await fs.mkdir(directory, { recursive: true });
      let published = false;
      try {
        // Atomic rename protects readers from partial JSON; file + directory fsync
        // additionally make a reported login/logout commit survive hard termination.
        await writeSynced(temporary, snapshot);
        await fs.rename(temporary, target);
        published = true;
        await syncDirectory(directory);
      } catch (error) {
        if (!published) await safeRemove(temporary);
        throw error;
      }
    });
    // Physical temp-file writes also have to recover after an individual rename/write failure.
    diskWriteQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  let cache = null; // { token, email, user_id, account_no, account_ref, checked_at, quota_cache }
  let loadPromise = null;
  let translationTokenCache = null;
  let translationTokenInflight = null;
  let stateMutationQueue = Promise.resolve();
  let sessionGeneration = 0;
  let translationAuthorizationController = new AbortController();

  function sessionChangedError() {
    const error = new Error('登录状态已变化，请重试');
    error.code = 'SUBSCRIPTION_SESSION_CHANGED';
    return error;
  }

  function loginRequiredError() {
    const error = new Error('请先登录');
    error.code = 'SUBSCRIPTION_LOGIN_REQUIRED';
    return error;
  }

  function requestTimeoutError(cause) {
    const error = new Error('订阅服务请求超时，请重试');
    error.code = 'SUBSCRIPTION_REQUEST_TIMEOUT';
    error.cause = cause;
    return error;
  }

  function assertSessionGeneration(expected) {
    if (expected != null && expected !== sessionGeneration) throw sessionChangedError();
  }

  function assertTranslationAuthorizationCurrent(lease) {
    if (
      !lease
      || !Number.isSafeInteger(lease.generation)
      || lease.generation !== sessionGeneration
      || lease.signal !== translationAuthorizationController.signal
      || lease.signal.aborted
    ) {
      throw sessionChangedError();
    }
  }

  function enqueueStateMutation(operation) {
    const queued = stateMutationQueue.then(operation, operation);
    // A failed mutation must not poison the queue or retain state/token objects in the chain.
    stateMutationQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  async function load() {
    if (loadPromise) return loadPromise;
    if (cache) return cache;
    const generation = sessionGeneration;
    loadPromise = (async () => {
      const loaded = await readStateDisk();
      if (loaded === null) {
        if (generation === sessionGeneration) cache = {};
        return cache || {};
      }
      // 兼容：解密加密的 token（enc: 前缀）。解密失败必须保留密文并允许后续重试，不能伪装成登出。
      if (loaded.token && typeof loaded.token === 'string' && loaded.token.startsWith('enc:')) {
        loaded.token = decryptField(loaded.token);
      }
      // 公开账号号只接受服务端 account_no。旧 account_ref（包括 GK-000xxx）不再由本地身份推导或迁移。
      const identity = normalizeUserIdentity(loaded);
      loaded.account_no = identity.account_no;
      loaded.account_ref = identity.account_ref;
      if (generation !== sessionGeneration) return cache || {};
      // 安全迁移：发现明文 token 立即加密重写磁盘（防止旧数据长期明文滞留）
      if (loaded.token && !String(loaded.token).startsWith('enc:') && secureCrypto) {
        try {
          const disk = { ...loaded, token: encryptField(loaded.token) };
          await writeStateDisk(disk, { expectedSessionGeneration: generation });
        } catch (e) {
          if (e.code === 'SUBSCRIPTION_SESSION_CHANGED') return cache || {};
          // 兼容迁移失败不阻塞当前已存在的登录态。
        }
      }
      if (generation !== sessionGeneration) return cache || {};
      cache = loaded;
      return cache || {};
    })();
    try {
      return await loadPromise;
    } finally {
      loadPromise = null;
    }
  }

  function save(patch, options = {}) {
    const expectedSessionGeneration = options.expectedSessionGeneration;
    return enqueueStateMutation(async () => {
      assertSessionGeneration(expectedSessionGeneration);
      const current = await load();
      // 先构造候选状态；只有磁盘原子提交成功后，候选才成为内存 authority。
      const next = { ...current, ...patch };
      const identity = normalizeUserIdentity(next);
      next.user_id = identity.user_id;
      next.account_no = identity.account_no;
      next.account_ref = identity.account_ref;
      const disk = { ...next };
      if (disk.token) disk.token = encryptField(disk.token);
      try {
        await writeStateDisk(disk);
      } catch (e) {
        console.error('[subscription] 状态写入失败:', e.message);
        throw e;
      }
      cache = next;
      return cache;
    });
  }

  async function request(pathname, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (options.auth !== false) {
      const state = await load();
      if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), boundedRequestTimeoutMs);
    try {
      const res = await fetch(`${apiBase()}${pathname}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      let data = {};
      try {
        data = await res.json();
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error;
      }
      if (!res.ok) {
        const err = new Error(data.error || `HTTP ${res.status}`);
        err.status = res.status;
        err.code = data.error;
        throw err;
      }
      return data;
    } catch (cause) {
      if (controller.signal.aborted || cause?.name === 'AbortError' || cause?.name === 'TimeoutError') {
        throw requestTimeoutError(cause);
      }
      throw cause;
    } finally {
      clearTimeout(timer);
    }
  }

  // 本地状态（不请求网络）：{ loggedIn, email, user_id, account_no, account_ref, remaining_chars, valid }
  async function getState() {
    const state = await load();
    if (!state.token) return { loggedIn: false };
    const remaining = state.remaining_chars != null ? state.remaining_chars : state.quota_cache?.remaining_chars;
    const identity = normalizeUserIdentity(state);
    return {
      loggedIn: true,
      email: state.email || '',
      user_id: identity.user_id,
      account_no: identity.account_no,
      account_ref: identity.account_ref,
      remaining_chars: remaining != null ? remaining : 0,
      valid: remaining == null || remaining > 0,
    };
  }

  function localQuota(state, missingRemaining) {
    const identity = normalizeUserIdentity(state);
    const accountIdentity = { account_no: identity.account_no, account_ref: identity.account_ref };
    return state.quota_cache
      ? { ...state.quota_cache, ...accountIdentity }
      : { remaining_chars: missingRemaining, email: state.email || '', ...accountIdentity };
  }

  // 刷新远程状态：token 有效→更新本地；401/失效→清除本地。
  // 老版本状态缺少服务端 account_no 时，从 /api/me 回填；绝不从 user_id 本地合成。
  async function refresh() {
    const state = await load();
    const generation = sessionGeneration;
    if (!state.token) return getState();
    try {
      const data = await request('/api/status');
      const patch = { remaining_chars: data.remaining_chars, checked_at: new Date().toISOString() };
      if (!state.user_id || !ACCOUNT_NO_PATTERN.test(state.account_no || '')) {
        const profile = await request('/api/me').catch(() => null);
        if (profile?.user?.id) Object.assign(patch, normalizeUserIdentity(profile.user));
        if (profile?.user?.email) patch.email = profile.user.email;
      }
      await save(patch, { expectedSessionGeneration: generation });
      return getState();
    } catch (e) {
      if (e.code === 'SUBSCRIPTION_SESSION_CHANGED') return getState();
      if (e.status === 401 || e.code === 'account_disabled') {
        try {
          await clear({ expectedSessionGeneration: generation });
        } catch (clearError) {
          if (clearError.code === 'SUBSCRIPTION_SESSION_CHANGED') return getState();
          throw clearError;
        }
        return { loggedIn: false, error: e.code === 'account_disabled' ? 'account_disabled' : 'unauthorized' };
      }
      // 网络失败：返回本地缓存状态（离线容忍），带网络错误标记
      const local = await getState();
      return { ...local, networkError: true };
    }
  }

  async function login(email, password, options = {}) {
    const generation = options.expectedSessionGeneration ?? sessionGeneration;
    // 登录/换号必须能从损坏或暂不可读的旧密文恢复，因此登录请求不依赖旧 bearer token。
    const data = await request('/api/login', { method: 'POST', body: { email, password }, auth: false });
    // 登录成功：清空旧账号本地状态（token/quota_cache 等），防止换账号数据串号。
    // 条件 clear 保证晚到的登录响应不能越过一个更晚完成的 logout/account switch。
    await clear({ expectedSessionGeneration: generation });
    const loginGeneration = sessionGeneration;
    let identity = normalizeUserIdentity(data.user || {});
    await save({
      token: data.token,
      email: data.user.email,
      ...identity,
      checked_at: new Date().toISOString(),
    }, { expectedSessionGeneration: loginGeneration });
    // 兼容切换期：若登录响应尚未携带 account_no，只允许从受认证的 /api/me 补齐。
    if (!identity.account_no) {
      const profile = await request('/api/me').catch(() => null);
      if (profile?.user?.id) {
        identity = normalizeUserIdentity(profile.user);
        await save(
          { ...identity, email: profile.user.email || data.user.email || '' },
          { expectedSessionGeneration: loginGeneration }
        );
      }
    }
    // 拉取字符余额
    const status = await request('/api/status').catch(() => ({}));
    if (status.remaining_chars != null) {
      await save({ remaining_chars: status.remaining_chars }, { expectedSessionGeneration: loginGeneration });
    }
    return { ok: true, user: { ...data.user, account_no: identity.account_no, account_ref: identity.account_ref } };
  }

  async function register(email, password) {
    const generation = sessionGeneration;
    await request('/api/register', { method: 'POST', body: { email, password }, auth: false });
    assertSessionGeneration(generation);
    return login(email, password, { expectedSessionGeneration: generation });
  }

  async function createOrder(plan) {
    return request('/api/orders', { method: 'POST', body: { plan } });
  }

  async function myOrders() {
    return request('/api/orders');
  }

  async function me() {
    const state = await load();
    const generation = sessionGeneration;
    if (!state.token) throw loginRequiredError();
    const data = await request('/api/me');
    if (data?.user?.id) {
      const identity = normalizeUserIdentity(data.user);
      await save(
        { ...identity, email: data.user.email || state.email || '' },
        { expectedSessionGeneration: generation }
      );
      return { ...data, user: { ...data.user, account_no: identity.account_no, account_ref: identity.account_ref } };
    }
    assertSessionGeneration(generation);
    return data;
  }

  // 字符余额查询：{ remaining_chars }（纯字符包，无订阅概念）
  // 默认有本地缓存直接返回；否则请求远程。
  // 传 { network: false } 时只读本地缓存，绝不发网络请求（翻译热路径用，额度固定由服务端扣减）。
  async function getQuota(force = false, opts = {}) {
    if (force && typeof force === 'object' && !Array.isArray(force)) {
      opts = force;
      force = false;
    }
    const state = await load();
    const generation = sessionGeneration;
    const now = Date.now();
    const fresh = state.quota_checked_at && (now - new Date(state.quota_checked_at).getTime()) < 30 * 1000;
    if (!force && fresh && state.quota_cache) return localQuota(state, null);
    if (opts.network === false) {
      // 只读本地：有缓存返回缓存（哪怕是旧的），无缓存视为未知（放行，服务端兜底）
      return localQuota(state, null);
    }
    try {
      const data = await request('/api/quota');
      const identity = normalizeUserIdentity(state);
      const quota = {
        remaining_chars: data.remaining_chars,
        email: data.email || state.email || '',
        account_no: identity.account_no,
        account_ref: identity.account_ref,
      };
      await save(
        { quota_cache: quota, quota_checked_at: new Date().toISOString() },
        { expectedSessionGeneration: generation }
      );
      return quota;
    } catch (e) {
      if (generation !== sessionGeneration || e.code === 'SUBSCRIPTION_SESSION_CHANGED') {
        return localQuota(await load(), null);
      }
      // 网络失败：回退本地缓存（离线容忍）；无缓存则视为有额度（不阻断已有用户）
      return localQuota(state, Number.MAX_SAFE_INTEGER);
    }
  }

  async function getTranslationToken(force = false) {
    const state = await load();
    const generation = sessionGeneration;
    if (!state.token) throw loginRequiredError();
    const now = Math.floor(Date.now() / 1000);
    if (
      !force
      && translationTokenCache?.generation === generation
      && translationTokenCache?.token
      && translationTokenCache.expires_at > now + 30
    ) {
      return translationTokenCache.token;
    }
    if (translationTokenInflight?.generation === generation) {
      return translationTokenInflight.promise;
    }

    const promise = (async () => {
      const data = await request('/api/translation-token', { method: 'POST' });
      if (!data.token || !Number.isFinite(Number(data.expires_at))) throw new Error('翻译授权返回格式错误');
      assertSessionGeneration(generation);
      const current = await load();
      assertSessionGeneration(generation);
      if (!current.token) throw loginRequiredError();
      translationTokenCache = {
        token: String(data.token),
        expires_at: Number(data.expires_at),
        generation,
      };
      return translationTokenCache.token;
    })();

    translationTokenInflight = { generation, promise };
    try {
      return await promise;
    } finally {
      if (translationTokenInflight?.promise === promise) translationTokenInflight = null;
    }
  }

  async function getTranslationAuthorization(force = false) {
    const generation = sessionGeneration;
    const token = await getTranslationToken(force);
    assertSessionGeneration(generation);
    const lease = Object.freeze({
      token: String(token),
      generation,
      signal: translationAuthorizationController.signal,
    });
    assertTranslationAuthorizationCurrent(lease);
    return lease;
  }

  // 字符扣减：翻译成功后上报原文+译文，服务端按 1汉字=2字符 规则换算扣减
  async function reportUsage(sourceText, targetText) {
    const state = await load();
    const generation = sessionGeneration;
    if (!state.token) return { ok: true, remaining_chars: null };
    try {
      const data = await request('/api/usage', { method: 'POST', body: { source: String(sourceText || ''), target: String(targetText || '') } });
      if (data.remaining_chars != null) {
        const identity = normalizeUserIdentity(state);
        const quota = {
          remaining_chars: data.remaining_chars,
          email: state.email || '',
          account_no: identity.account_no,
          account_ref: identity.account_ref,
        };
        await save(
          { quota_cache: quota, quota_checked_at: new Date().toISOString() },
          { expectedSessionGeneration: generation }
        );
      }
      return data;
    } catch (e) {
      return { ok: false, remaining_chars: null };
    }
  }

  function clear(options = {}) {
    const expectedSessionGeneration = options.expectedSessionGeneration;
    return enqueueStateMutation(async () => {
      assertSessionGeneration(expectedSessionGeneration);
      // Logout/account-switch state is authoritative only after the tokenless state is durable.
      // Persist an empty tombstone atomically instead of relying on best-effort file deletion.
      await writeStateDisk({});
      const previousAuthorizationController = translationAuthorizationController;
      cache = {};
      translationTokenCache = null;
      translationTokenInflight = null;
      sessionGeneration += 1;
      translationAuthorizationController = new AbortController();
      previousAuthorizationController.abort(sessionChangedError());
    });
  }

  async function logout() {
    await clear();
    return { ok: true };
  }

  return {
    getState,
    refresh,
    login,
    register,
    createOrder,
    myOrders,
    me,
    getQuota,
    getTranslationToken,
    getTranslationAuthorization,
    assertTranslationAuthorizationCurrent,
    reportUsage,
    logout,
    clear,
    _injectCrypto: setSecureCrypto,
    _file: stateFile,
  };
}

module.exports = { createSubscriptionStore, DEFAULT_API_URL, DEFAULT_REQUEST_TIMEOUT_MS };