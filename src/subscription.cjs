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
    const data = await request('/api/login', { method: 'POST', body: { email, password } });
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
