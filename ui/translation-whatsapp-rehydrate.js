(() => {
  'use strict';

  const INSTALL_MARKER = '__geekWhatsAppTranslationRehydrateInstalled';
  const WEBVIEW_MARKER = 'geekTranslationRehydrateBound';

  function guestInstallerSource() {
    return `(() => {
      try {
        if (window.${INSTALL_MARKER}) return 'ALREADY';
        const looksWhatsApp = location.hostname === '127.0.0.1'
          || !!window.WPP || !!window.WAPLUS_WPP
          || /whatsapp/i.test(String(document.title || ''));
        if (!looksWhatsApp) return 'NOT_WHATSAPP';
        window.${INSTALL_MARKER} = true;

        let lastChatId = '';
        let refreshTimer = null;
        let rootObserver = null;
        let bodyObserver = null;

        const activeChatId = () => {
          try {
            const chat = window.WPP?.chat?.getActiveChat?.() || window.WAPLUS_WPP?.chat?.getActiveChat?.() || window.W?.chat?.getActive?.();
            return String(chat?.id?._serialized || chat?.id || '');
          } catch (_) { return ''; }
        };

        const scheduleRefresh = () => {
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => {
            const next = activeChatId();
            if (!next || next === lastChatId) return;
            lastChatId = next;
            const refresh = window.__geekRefreshTranslationView;
            if (typeof refresh === 'function') refresh();
          }, 80);
        };

        const bindMain = () => {
          const main = document.querySelector('#main');
          if (!main || main === window.__geekTranslationRehydrateRoot) return false;
          rootObserver?.disconnect();
          window.__geekTranslationRehydrateRoot = main;
          rootObserver = new MutationObserver(scheduleRefresh);
          rootObserver.observe(main, { childList: true, subtree: true });
          scheduleRefresh();
          return true;
        };

        bodyObserver = new MutationObserver(() => {
          bindMain();
          scheduleRefresh();
        });
        bodyObserver.observe(document.documentElement, { childList: true, subtree: true });
        bindMain();
        scheduleRefresh();

        window.__geekTranslationRehydrateDispose = () => {
          clearTimeout(refreshTimer);
          rootObserver?.disconnect();
          bodyObserver?.disconnect();
          delete window.${INSTALL_MARKER};
          delete window.__geekTranslationRehydrateRoot;
        };
        return 'OK';
      } catch (error) {
        return 'ERR:' + String(error?.message || error);
      }
    })()`;
  }

  function installOnWebview(webview) {
    if (!webview || webview.dataset?.[WEBVIEW_MARKER] === '1') return;
    if (webview.dataset) webview.dataset[WEBVIEW_MARKER] = '1';
    const install = () => {
      if (!webview.isConnected || typeof webview.executeJavaScript !== 'function') return;
      webview.executeJavaScript(guestInstallerSource()).catch(() => {});
    };
    webview.addEventListener?.('dom-ready', install);
    try { install(); } catch (_) {}
  }

  function scan(root = document) {
    root.querySelectorAll?.('webview').forEach(installOnWebview);
  }

  function install() {
    scan(document);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'WEBVIEW') installOnWebview(node);
          scan(node);
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return observer;
  }

  window.GeekWhatsAppTranslationRehydrate = Object.freeze({ guestInstallerSource, installOnWebview, install });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
