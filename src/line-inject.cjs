// src/line-inject.cjs — LINE 扩展页面兼容注入
// 原理（逆向自原版 Hello-GPT）：LINE 官方扩展页面（chrome-extension://.../index.html）
// 是完整 React 应用，依赖真实 Chrome 的 chrome.tabs / chrome.action / chrome.downloads
// 等 API。Electron 环境没有这些，页面会直接崩成空白。这里把缺失的 API mock 掉，
// 让 LINE 应用能正常渲染。
// 只在 chrome-extension: 页面生效（配合 contextIsolation=false 注入主世界），
// 普通网站不注入任何东西。

if (typeof location !== 'undefined' && location.protocol === 'chrome-extension:') {
  console.log('[line-inject] preload 运行于扩展页面', location.href);
  const noop = () => {};

  // 兜底 Proxy：任何缺失的 chrome.xxx 或 chrome.xxx.yyy 访问都不报错。
  // - 属性名以 on 开头 → 返回事件对象（addListener/removeListener/hasListener）
  // - 其他缺失属性 → 返回一个返回 Promise 的函数（LINE 应用大量 await chrome.*）
  function apiProxyHandler() {
    return {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === Symbol.toPrimitive || prop === 'then') return undefined;
        if (typeof prop === 'string' && prop.startsWith('on')) {
          return { addListener: noop, removeListener: noop, hasListener: () => false };
        }
        return (...args) => Promise.resolve(undefined);
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      }
    };
  }
  const proxied = (base) => new Proxy(base || {}, apiProxyHandler());

  window.chrome = window.chrome || {};

  window.chrome.runtime = proxied({
    sendMessage: () => Promise.resolve(1),
    getManifest: () => ({ name: 'LINE', version: '3.5.1' }),
    lastError: undefined
  });

  window.chrome.tabs = proxied({
    onClicked: { addListener: noop, removeListener: noop },
    onClosed: { addListener: noop, removeListener: noop },
    onUpdated: { addListener: noop, removeListener: noop },
    onActivated: { addListener: noop, removeListener: noop },
    create: noop,
    clear: noop,
    update: noop,
    query: () => Promise.resolve([]),
    get: () => Promise.resolve({}),
    getZoom: () => Promise.resolve(1),
    setZoom: noop,
    sendMessage: () => Promise.resolve({})
  });

  window.chrome.windows = proxied({
    remove: noop,
    create: () => Promise.resolve({ id: 1 }),
    getAll: () => Promise.resolve([])
  });

  window.chrome.action = proxied({
    setBadgeText: noop,
    setTitle: noop,
    setIcon: noop
  });

  window.chrome.downloads = proxied({
    ok: noop,
    onChanged: { addListener: noop, removeListener: noop },
    download: () => Promise.resolve(1),
    search: () => Promise.resolve([])
  });

  window.chrome.notifications = proxied({
    create: () => Promise.resolve(''),
    clear: noop,
    getAll: () => Promise.resolve({})
  });

  // chrome.storage 用 localStorage 做后端（可靠持久化，不丢会话数据）。
  // 原版 mock 未破坏 storage；我们用 localStorage 兜底，二维码会话/证书能存下来。
  function storageAreaBackend() {
    const read = (key) => {
      try { const v = localStorage.getItem(key); return v == null ? undefined : JSON.parse(v); }
      catch { return undefined; }
    };
    return {
      get(keys) {
        return Promise.resolve().then(() => {
          const result = {};
          if (keys == null) {
            for (let i = 0; i < localStorage.length; i += 1) {
              const k = localStorage.key(i);
              const v = read(k);
              if (v !== undefined) result[k] = v;
            }
          } else if (typeof keys === 'string') {
            const v = read(keys);
            if (v !== undefined) result[keys] = v;
          } else if (Array.isArray(keys)) {
            keys.forEach((k) => { const v = read(k); if (v !== undefined) result[k] = v; });
          } else {
            Object.entries(keys).forEach(([k, def]) => { const v = read(k); result[k] = v === undefined ? def : v; });
          }
          return result;
        });
      },
      set(items) {
        return Promise.resolve().then(() => {
          Object.entries(items).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
        });
      },
      remove(keys) {
        return Promise.resolve().then(() => {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => localStorage.removeItem(k));
        });
      },
      clear() {
        return Promise.resolve().then(() => localStorage.clear());
      }
    };
  }
  window.chrome.storage = {
    local: storageAreaBackend(),
    sync: storageAreaBackend()
  };

  // cookies：Electron 扩展 API 不可用则用 document.cookie 兜底
  window.chrome.cookies = proxied({
    get: (details) => Promise.resolve(null),
    getAll: () => Promise.resolve([]),
    set: () => Promise.resolve({}),
    remove: () => Promise.resolve({}),
    onChanged: { addListener: noop, removeListener: noop }
  });

  window.chrome.i18n = proxied({
    getMessage: () => '',
    getUILanguage: () => 'en'
  });

  // 顶级兜底：任何未列出的 chrome.xxx 也返回 Proxy
  window.chrome = proxied(window.chrome);
}
