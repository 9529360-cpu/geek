/* 极客公共翻译核心：平台无关的数据模型与适配器注册表。 */
(() => {
  'use strict';

  const CHINESE_RE = /[\u3400-\u9fff]/;
  const PLATFORM_TYPES = Object.freeze({
    whatsapp: new Set(['whatsapp', 'whatsapp-pure']),
    telegram: new Set(['telegram', 'telegram-z', 'telegram-pure', 'telegram-k']),
    line: new Set(['line', 'line-business', 'linebusiness'])
  });
  const VALID_PROVIDERS = new Set(['auto', 'local']);
  const VALID_ROUTES = new Set(['default', 'primary', 'backup']);
  const adapters = new Map();

  function platformOf(type) {
    for (const [platform, types] of Object.entries(PLATFORM_TYPES)) {
      if (types.has(type)) return platform;
    }
    return null;
  }

  function normalizeConfig(globalConfig = {}, chatConfig = {}) {
    const g = globalConfig && typeof globalConfig === 'object' ? globalConfig : {};
    const c = chatConfig && typeof chatConfig === 'object' ? chatConfig : {};
    const base = {
      provider: g.source === 'local' || g.source === 'remote' ? 'auto' : (g.source || 'auto'),
      route: g.server || 'default',
      enabled: g.send === true,
      autoSend: g.send === true,
      source: g.sendFrom || 'auto',
      target: g.sendTo || 'en',
      messageAction: g.manual !== false,
      displayTranslation: g.displayTranslation !== false,
      translationMode: g.translationMode || (g.message === false ? 'click' : 'auto'),
      messageTarget: g.messageTo || 'zh',
      messageFrom: g.messageFrom || 'auto',
      groupAuto: g.group === true,
      includeZh: g.includeZh !== false,
      fontSize: g.fontSize || '13',
      fontColor: g.fontColor || '#667eea'
    };
    const merged = {
      ...base,
      ...c,
      source: c.source || base.source,
      messageTarget: c.messageTarget || base.messageTarget
    };
    merged.provider = VALID_PROVIDERS.has(String(merged.provider || '').toLowerCase())
      ? String(merged.provider).toLowerCase()
      : 'auto';
    merged.route = VALID_ROUTES.has(String(merged.route || '').toLowerCase())
      ? String(merged.route).toLowerCase()
      : 'default';
    return merged;
  }

  function registerAdapter(platform, adapter) {
    if (!platform || !adapter || typeof adapter.install !== 'function') {
      throw new TypeError('翻译适配器必须提供 install()');
    }
    if (adapters.has(platform)) throw new Error(`翻译适配器已注册: ${platform}`);
    adapters.set(platform, Object.freeze({ platform, ...adapter }));
    return adapters.get(platform);
  }

  function getAdapter(type) {
    return adapters.get(platformOf(type)) || null;
  }

  function messageKey({ accountId, chatId, messageId, direction = 'unknown', text = '' } = {}) {
    const raw = [accountId, chatId, messageId, direction, String(text).trim()].join('\u001f');
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 16777619); }
    return `g${(h >>> 0).toString(16)}`;
  }

  function isChinese(text) { return CHINESE_RE.test(String(text || '')); }

  function assertMessage(message) {
    if (!message || typeof message !== 'object') throw new TypeError('消息必须是对象');
    for (const field of ['accountId', 'chatId', 'messageId', 'text']) {
      if (typeof message[field] !== 'string' || !message[field].trim()) throw new TypeError(`消息缺少${field}`);
    }
    if (!['in', 'out', 'system', 'unknown'].includes(message.direction)) throw new TypeError('消息方向无效');
    return message;
  }

  window.GeekTranslationCore = Object.freeze({
    PLATFORM_TYPES,
    platformOf,
    normalizeConfig,
    registerAdapter,
    getAdapter,
    messageKey,
    isChinese,
    assertMessage
  });

  // WhatsApp chat navigation rehydration is intentionally isolated from app.js.
  // The module only asks the already-installed translation renderer to rescan when
  // WhatsApp changes active chat; actual text/cache ownership remains in main process.
  if (typeof document !== 'undefined' && !document.querySelector('script[data-geek-translation-rehydrate]')) {
    const script = document.createElement('script');
    script.src = './translation-whatsapp-rehydrate.js';
    script.defer = true;
    script.dataset.geekTranslationRehydrate = '1';
    document.head.appendChild(script);
  }
})();
