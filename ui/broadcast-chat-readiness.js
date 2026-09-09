(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastChatReadiness = api;
  if (root && root.document) {
    const installWhenAvailable = () => {
      try { api.install(root); }
      catch (error) { console.error('[broadcast-readiness] install failed', error); }
    };
    if (root.GeekPlatformTransports) installWhenAvailable();
    else if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', installWhenAvailable, { once: true });
    else installWhenAvailable();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const INSTALL_MARKER = '__geekBroadcastReadinessInstalled';

  function createWhatsAppGetChatsScript(options = {}) {
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || 12000);
    const pollMs = Math.max(1, Number(options.pollMs) || 500);
    return `(async () => {
      /* __GEEK_BROADCAST_CHAT_READINESS__ */
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const deadline = Date.now() + ${timeoutMs};
      let lastError = '';
      while (Date.now() <= deadline) {
        try {
          const candidates = [window.WPP, window.WAPLUS_WPP].filter(Boolean);
          for (const W of candidates) {
            if (!W?.conn || typeof W.conn.isMainReady !== 'function' || !W?.chat || typeof W.chat.list !== 'function') continue;
            let ready = false;
            try { ready = (await W.conn.isMainReady()) === true; }
            catch (error) { lastError = String(error?.message || error || ''); }
            if (!ready) continue;
            try {
              const chats = await W.chat.list();
              const arr = Array.isArray(chats) ? chats : (chats ? Object.values(chats) : []);
              const out = arr.map(c => ({
                id: String(c.id),
                name: (c.name || c.formattedTitle || String(c.id)).trim(),
                realName: (!c.isGroup && c.contact ? (c.contact.pushname || c.contact.name || c.contact.shortName || '') : ''),
                type: c.isGroup ? '群组' : '联系人'
              })).filter(c => c.id.includes('@'));
              return JSON.stringify(out);
            } catch (error) {
              lastError = String(error?.message || error || '');
            }
          }
        } catch (error) {
          lastError = String(error?.message || error || '');
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(${pollMs}, Math.max(1, remaining)));
      }
      return 'ERR:WhatsApp 聊天列表仍在初始化，请关闭后重试' + (lastError ? '：' + lastError : '');
    })()`;
  }

  function install(target) {
    const forAccount = target?.GeekPlatformTransports?.forAccount;
    if (typeof forAccount !== 'function') return false;
    const stubWebview = {
      executeJavaScript: async () => null,
      getWebContentsId: () => 0,
    };
    const adapter = forAccount({ id: '__geek_broadcast_readiness__', type: 'whatsapp' }, stubWebview);
    const transport = adapter?.transport;
    if (!transport || typeof transport.getChats !== 'string') return false;
    if (transport[INSTALL_MARKER] === true) return true;
    transport.getChats = createWhatsAppGetChatsScript();
    Object.defineProperty(transport, INSTALL_MARKER, { value: true, configurable: true });
    return true;
  }

  return Object.freeze({ createWhatsAppGetChatsScript, install });
});
