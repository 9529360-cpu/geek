'use strict';
// 极客付费订阅客户端模块
// - token/订阅状态存储：<userData>/subscription.json（与 accounts.json 同层，明文 JSON，权限 600）
// - 远程 API：环境变量 GEEK_SUBSCRIPTION_API_URL 覆盖，默认 Cloudflare Worker
// - 能力：状态读取/刷新、登录、注册、下单、登出

const path = require('node:path');
const fs = require('node:fs/promises');

const DEFAULT_API_URL = 'https://geek-subscription.9529360.workers.dev';

function apiBase() {
  return (process.env.GEEK_SUBSCRIPTION_API_URL || DEFAULT_API_URL).replace(/\/+$/, '');
}

function createSubscriptionStore({ userDataDir }) {
  const stateFile = () => path.join(userDataDir, 'subscription.json');

  let cache = null; // { token, email, expires_at, plan, checked_at }

  async function load() {
    if (cache) return cache;
    try {
      const raw = await fs.readFile(stateFile(), 'utf-8');
      cache = JSON.parse(raw || '{}');
    } catch {
      cache = {};
    }
    return cache;
  }

  async function save(patch) {
    const current = await load();
    cache = { ...current, ...patch };
    try {
      await fs.writeFile(stateFile(), JSON.stringify(cache, null, 2), { encoding: 'utf-8', mode: 0o600 });
    } catch (e) {
      console.error('[subscription] 状态写入失败:', e.message);
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

  // 本地状态（不请求网络）：{ loggedIn, email, plan, expires_at, days_left }
  async function getState() {
    const state = await load();
    if (!state.token) return { loggedIn: false };
    const now = Date.now();
    const exp = state.expires_at ? new Date(state.expires_at + (state.expires_at.includes('T') ? '' : 'Z')).getTime() : 0;
    const valid = state.expires_at ? exp > now : false;
    return {
      loggedIn: true,
      email: state.email || '',
      plan: state.plan || '',
      expires_at: state.expires_at || '',
      days_left: valid ? Math.max(1, Math.ceil((exp - now) / 86400000)) : 0,
      valid,
    };
  }

  // 刷新远程状态：token 有效→更新本地；401/失效→清除本地
  async function refresh() {
    const state = await load();
    if (!state.token) return getState();
    try {
      const data = await request('/api/status');
      if (data.valid) {
        await save({ email: state.email, plan: data.plan, expires_at: data.expires_at, checked_at: new Date().toISOString() });
      } else {
        // 无订阅或已过期：保留 token（用户可能续费），标记未验证
        await save({ plan: data.plan || '', expires_at: data.expires_at || '', checked_at: new Date().toISOString() });
      }
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
    const data = await request('/api/login', { method: 'POST', body: { email, password } });
    await save({ token: data.token, email: data.user.email, checked_at: new Date().toISOString() });
    // 拉取订阅状态
    const status = await request('/api/status').catch(() => ({}));
    if (status.valid) await save({ plan: status.plan, expires_at: status.expires_at });
    else await save({ plan: '', expires_at: '' });
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

  // Freemium 额度查询：{ unlimited, remaining_chars, plan, expires_at }
  // 有本地缓存直接返回；否则请求远程
  async function getQuota(force = false) {
    const state = await load();
    const now = Date.now();
    const fresh = state.quota_checked_at && (now - new Date(state.quota_checked_at).getTime()) < 30 * 1000;
    if (!force && fresh && state.quota_cache) return state.quota_cache;
    try {
      const data = await request('/api/quota');
      const quota = {
        unlimited: !!data.unlimited,
        remaining_chars: data.remaining_chars,
        plan: data.plan || '',
        expires_at: data.expires_at || '',
        email: data.email || state.email || '',
      };
      await save({ quota_cache: quota, quota_checked_at: new Date().toISOString() });
      return quota;
    } catch (e) {
      // 网络失败：回退本地缓存（离线容忍）；无缓存则视为不限量（不阻断已有用户）
      if (state.quota_cache) return state.quota_cache;
      return { unlimited: true, remaining_chars: null, plan: '', expires_at: '', email: state.email || '' };
    }
  }

  // Freemium 扣减：翻译成功后上报字符数；订阅有效期服务端不扣
  async function reportUsage(chars) {
    const state = await load();
    if (!state.token) return { ok: true, unlimited: true, remaining_chars: null };
    try {
      const data = await request('/api/usage', { method: 'POST', body: { chars } });
      if (data.remaining_chars != null) {
        const quota = { unlimited: false, remaining_chars: data.remaining_chars, plan: '', expires_at: '', email: state.email || '' };
        await save({ quota_cache: quota, quota_checked_at: new Date().toISOString() });
      }
      return data;
    } catch (e) {
      return { ok: false, unlimited: true, remaining_chars: null };
    }
  }

  async function clear() {
    cache = {};
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
    reportUsage,
    logout,
    clear,
    _file: stateFile,
  };
}

module.exports = { createSubscriptionStore, DEFAULT_API_URL };
