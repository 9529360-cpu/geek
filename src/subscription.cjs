'use strict';
// 极客付费订阅客户端模块
// - token/订阅状态存储：<userData>/subscription.json（敏感 token 使用 safeStorage 加密）
// - 远程 API：环境变量 GEEK_SUBSCRIPTION_API_URL 覆盖，默认 Cloudflare Worker
// - 能力：状态读取/刷新、登录、注册、下单、登出

const path = require('node:path');
const fs = require('node:fs/promises');

const DEFAULT_API_URL = 'https://geek-subscription.9529360.workers.dev';
const ACCOUNT_NO_PATTERN = /^GK-[0-9a-f]{32}$/;

// 敏感字段加密（safeStorage DPAPI）：token 等不落明文
// 注入方式：main.cjs 里调用 initSecureCrypto()，把 {encrypt, decrypt} 传进来
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
  if (typeof value === 'string' && value.startsWith('enc:') && secureCrypto) {
    try { return secureCrypto.decrypt(value.slice(4)); } catch (e) { return ''; }
  }
  return value;
}

function apiBase() {
  return (process.env.GEEK_SUBSCRIPTION_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
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

function createSubscriptionStore({ userDataDir }) {
  const stateFile = () => path.join(userDataDir, 'subscription.json');

  async function writeStateDisk(disk) {
    const target = stateFile();
    const temporary = `${target}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temporary, JSON.stringify(disk, null, 2), { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(temporary, target);
  }

  let cache = null; // { token, email, user_id, account_no, account_ref, checked_at, quota_cache }
  let translationTokenCache = null;

  async function load() {
    if (cache) return cache;
    try {
      const raw = await fs.readFile(stateFile(), 'utf-8');
      cache = JSON.parse(raw || '{}');
      // 兼容：解密加密的 token（enc: 前缀）
      if (cache.token && typeof cache.token === 'string' && cache.token.startsWith('enc:')) {
        cache.token = decryptField(cache.token);
      }
      // 公开账号号只接受服务端 account_no。旧 account_ref（包括 GK-000xxx）不再由本地身份推导或迁移。
      const identity = normalizeUserIdentity(cache);
      cache.account_no = identity.account_no;
      cache.account_ref = identity.account_ref;
      // 安全迁移：发现明文 token 立即加密重写磁盘（防止旧数据长期明文滞留）
      if (cache.token && !String(cache.token).startsWith('enc:') && secureCrypto) {
        try {
          const disk = { ...cache, token: encryptField(cache.token) };
          await writeStateDisk(disk);
        } catch (e) { /* 迁移失败不阻塞 */ }
      }
    } catch {
      cache = {};
    }
    return cache;
  }

  async function save(patch) {
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
  }

  async function request(pathname, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const state = await load();
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    const res = await fetch(`${apiBase()}${pathname}`, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.code = data.error;
      throw err;
    }
    return data;
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

  // 刷新远程状态：token 有效→更新本地；401/失效→清除本地。
  // 老版本状态缺少服务端 account_no 时，从 /api/me 回填；绝不从 user_id 本地合成。
  async function refresh() {
    const state = await load();
    if (!state.token) return getState();
    try {
      const data = await request('/api/status');
      const patch = { remaining_chars: data.remaining_chars, checked_at: new Date().toISOString() };
      if (!state.user_id || !ACCOUNT_NO_PATTERN.test(state.account_no || '')) {
        const profile = await request('/api/me').catch(() => null);
        if (profile?.user?.id) Object.assign(patch, normalizeUserIdentity(profile.user));
        if (profile?.user?.email) patch.email = profile.user.email;
      }
      await save(patch);
      return getState();
    } catch (e) {
      if (e.status === 401 || e.code === 'account_disabled') {
        await clear();
        return { loggedIn: false, error: e.code === 'account_disabled' ? 'account_disabled' : 'unauthorized' };
      }
      // 网络失败：返回本地缓存状态（离线容忍），带网络错误标记
      const local = await getState();
      return { ...local, networkError: true };
    }
  }

  async function login(email, password) {
    // 先请求登录（避免登录失败时误清旧账号状态）
    const data = await request('/api/login', { method: 'POST', body: { email, password } });
    // 登录成功：清空旧账号本地状态（token/quota_cache 等），防止换账号数据串号
    await clear();
    let identity = normalizeUserIdentity(data.user || {});
    await save({
      token: data.token,
      email: data.user.email,
      ...identity,
      checked_at: new Date().toISOString(),
    });
    // 兼容切换期：若登录响应尚未携带 account_no，只允许从受认证的 /api/me 补齐。
    if (!identity.account_no) {
      const profile = await request('/api/me').catch(() => null);
      if (profile?.user?.id) {
        identity = normalizeUserIdentity(profile.user);
        await save({ ...identity, email: profile.user.email || data.user.email || '' });
      }
    }
    // 拉取字符余额
    const status = await request('/api/status').catch(() => ({}));
    if (status.remaining_chars != null) await save({ remaining_chars: status.remaining_chars });
    return { ok: true, user: { ...data.user, account_no: identity.account_no, account_ref: identity.account_ref } };
  }

  async function register(email, password) {
    await request('/api/register', { method: 'POST', body: { email, password } });
    return login(email, password);
  }

  async function createOrder(plan) {
    return request('/api/orders', { method: 'POST', body: { plan } });
  }

  async function myOrders() {
    return request('/api/orders');
  }

  async function me() {
    const data = await request('/api/me');
    if (data?.user?.id) {
      const identity = normalizeUserIdentity(data.user);
      await save({ ...identity, email: data.user.email || (await load()).email || '' });
      return { ...data, user: { ...data.user, account_no: identity.account_no, account_ref: identity.account_ref } };
    }
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
    const identity = normalizeUserIdentity(state);
    const accountIdentity = { account_no: identity.account_no, account_ref: identity.account_ref };
    const now = Date.now();
    const fresh = state.quota_checked_at && (now - new Date(state.quota_checked_at).getTime()) < 30 * 1000;
    if (!force && fresh && state.quota_cache) return { ...state.quota_cache, ...accountIdentity };
    if (opts.network === false) {
      // 只读本地：有缓存返回缓存（哪怕是旧的），无缓存视为未知（放行，服务端兜底）
      return state.quota_cache
        ? { ...state.quota_cache, ...accountIdentity }
        : { remaining_chars: null, email: state.email || '', ...accountIdentity };
    }
    try {
      const data = await request('/api/quota');
      const quota = {
        remaining_chars: data.remaining_chars,
        email: data.email || state.email || '',
        ...accountIdentity,
      };
      await save({ quota_cache: quota, quota_checked_at: new Date().toISOString() });
      return quota;
    } catch (e) {
      // 网络失败：回退本地缓存（离线容忍）；无缓存则视为有额度（不阻断已有用户）
      if (state.quota_cache) return { ...state.quota_cache, ...accountIdentity };
      return { remaining_chars: Number.MAX_SAFE_INTEGER, email: state.email || '', ...accountIdentity };
    }
  }

  async function getTranslationToken(force = false) {
    const now = Math.floor(Date.now() / 1000);
    if (!force && translationTokenCache?.token && translationTokenCache.expires_at > now + 30) {
      return translationTokenCache.token;
    }
    const data = await request('/api/translation-token', { method: 'POST' });
    if (!data.token || !Number.isFinite(Number(data.expires_at))) throw new Error('翻译授权返回格式错误');
    translationTokenCache = { token: String(data.token), expires_at: Number(data.expires_at) };
    return translationTokenCache.token;
  }

  // 字符扣减：翻译成功后上报原文+译文，服务端按 1汉字=2字符 规则换算扣减
  async function reportUsage(sourceText, targetText) {
    const state = await load();
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
        await save({ quota_cache: quota, quota_checked_at: new Date().toISOString() });
      }
      return data;
    } catch (e) {
      return { ok: false, remaining_chars: null };
    }
  }

  async function clear() {
    // Logout/account-switch state is authoritative only after the tokenless state is durable.
    // Persist an empty tombstone atomically instead of relying on best-effort file deletion.
    await writeStateDisk({});
    cache = {};
    translationTokenCache = null;
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
    reportUsage,
    logout,
    clear,
    _injectCrypto: setSecureCrypto,
    _file: stateFile,
  };
}

module.exports = { createSubscriptionStore, DEFAULT_API_URL };
