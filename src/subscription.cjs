'use strict';
// 极客付费订阅客户端模块
// - token/订阅状态存储：<userData>/subscription.json（与 accounts.json 同层，明文 JSON，权限 600）
// - 远程 API：环境变量 GEEK_SUBSCRIPTION_API_URL 覆盖，默认 Cloudflare Worker
// - 能力：状态读取/刷新、登录、注册、下单、登出

const path = require('node:path');
const fs = require('node:fs/promises');

const DEFAULT_API_URL = 'https://geek-subscription.9529360.workers.dev';

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

function createSubscriptionStore({ userDataDir }) {
  const stateFile = () => path.join(userDataDir, 'subscription.json');

  async function writeStateDisk(disk) {
    const target = stateFile();
    const temporary = `${target}.tmp`;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(temporary, JSON.stringify(disk, null, 2), { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(temporary, target);
  }

  let cache = null; // { token, email, expires_at, plan, checked_at }
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
    // 内存 cache 保留明文（request 等需要明文 token），写盘时加密敏感字段
    cache = { ...current, ...patch };
    const disk = { ...cache };
    if (disk.token) disk.token = encryptField(disk.token);
    try {
      await writeStateDisk(disk);
    } catch (e) {
      console.error('[subscription] 状态写入失败:', e.message);
      throw e;
    }
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

  // 本地状态（不请求网络）：{ loggedIn, email, remaining_chars, valid }
  async function getState() {
    const state = await load();
    if (!state.token) return { loggedIn: false };
    const remaining = state.remaining_chars != null ? state.remaining_chars : state.quota_cache?.remaining_chars;
    return {
      loggedIn: true,
      email: state.email || '',
      remaining_chars: remaining != null ? remaining : 0,
      valid: remaining == null || remaining > 0,
    };
  }

  // 刷新远程状态：token 有效→更新本地；401/失效→清除本地
  async function refresh() {
    const state = await load();
    if (!state.token) return getState();
    try {
      const data = await request('/api/status');
      await save({ remaining_chars: data.remaining_chars, checked_at: new Date().toISOString() });
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
    await save({ token: data.token, email: data.user.email, checked_at: new Date().toISOString() });
    // 拉取字符余额
    const status = await request('/api/status').catch(() => ({}));
    if (status.remaining_chars != null) await save({ remaining_chars: status.remaining_chars });
    return { ok: true, user: data.user };
  }

  async function register(email, password) {
    const data = await request('/api/register', { method: 'POST', body: { email, password } });
    return login(email, password);
  }

  async function createOrder(plan) {
    return request('/api/orders', { method: 'POST', body: { plan } });
  }

  async function myOrders() {
    return request('/api/orders');
  }

  async function me() {
    return request('/api/me');
  }

  // 字符余额查询：{ remaining_chars }（纯字符包，无订阅概念）
  // 有本地缓存直接返回；否则请求远程
  async function getQuota(force = false) {
    const state = await load();
    const now = Date.now();
    const fresh = state.quota_checked_at && (now - new Date(state.quota_checked_at).getTime()) < 30 * 1000;
    if (!force && fresh && state.quota_cache) return state.quota_cache;
    try {
      const data = await request('/api/quota');
      const quota = {
        remaining_chars: data.remaining_chars,
        email: data.email || state.email || '',
      };
      await save({ quota_cache: quota, quota_checked_at: new Date().toISOString() });
      return quota;
    } catch (e) {
      // 网络失败：回退本地缓存（离线容忍）；无缓存则视为有额度（不阻断已有用户）
      if (state.quota_cache) return state.quota_cache;
      return { remaining_chars: Number.MAX_SAFE_INTEGER, email: state.email || '' };
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
        const quota = { remaining_chars: data.remaining_chars, email: state.email || '' };
        await save({ quota_cache: quota, quota_checked_at: new Date().toISOString() });
      }
      return data;
    } catch (e) {
      return { ok: false, remaining_chars: null };
    }
  }

  async function clear() {
    cache = {};
    translationTokenCache = null;
    try {
      await fs.rm(stateFile(), { force: true });
    } catch (e) { /* 忽略 */ }
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
