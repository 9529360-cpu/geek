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

        const BACKGROUND_ACTIVE_LIMIT = 2;
        const BACKGROUND_QUEUE_LIMIT = 8;
        const ADMISSION_RETRY_LIMIT = 20;
        const OUTGOING_INTENT_TTL_MS = 2500;
        const HISTORY_MARKER = 'geekTranslationInitialHistory';
        let lastChatId = '';
        let refreshTimer = null;
        let admissionRetryTimer = null;
        let admissionRetryCount = 0;
        let rootObserver = null;
        let bodyObserver = null;
        let backgroundGeneration = 0;
        let backgroundActive = 0;
        let pendingOutgoingIntent = null;
        const backgroundQueue = [];
        const intentAbort = new AbortController();

        const activeChatId = () => {
          try {
            const chat = window.WPP?.chat?.getActiveChat?.() || window.WAPLUS_WPP?.chat?.getActiveChat?.() || window.W?.chat?.getActive?.();
            return String(chat?.id?._serialized || chat?.id || '');
          } catch (_) { return ''; }
        };

        const cleanText = value => String(value == null ? '' : value).replace(/\\u200b/g, '').trim();
        const activeComposerText = () => {
          try {
            const editor = document.querySelector('#main footer [contenteditable="true"],#main [data-testid="conversation-compose-box-input"],[contenteditable="true"][data-tab="10"]');
            return cleanText(editor?.innerText || editor?.textContent || '');
          } catch (_) { return ''; }
        };
        const isComposerTarget = target => !!target?.closest?.('[contenteditable="true"], [data-testid="conversation-compose-box-input"]');
        const isSendButtonTarget = target => !!target?.closest?.('button[aria-label="Send"],button[aria-label="发送"],[data-testid="compose-btn-send"],button:has([data-icon="send"])');
        const recordOutgoingIntent = event => {
          if (event?.isTrusted !== true) return;
          const chatId = activeChatId();
          const text = activeComposerText();
          if (!chatId || !text) { pendingOutgoingIntent = null; return; }
          pendingOutgoingIntent = { chatId, text, expiresAt: Date.now() + OUTGOING_INTENT_TTL_MS };
        };
        window.addEventListener('keydown', event => {
          if (event?.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.isComposing || !isComposerTarget(event.target)) return;
          recordOutgoingIntent(event);
        }, { capture: true, signal: intentAbort.signal });
        window.addEventListener('click', event => {
          if (isSendButtonTarget(event?.target)) recordOutgoingIntent(event);
        }, { capture: true, signal: intentAbort.signal });

        const installTranslationIntentTransport = () => {
          const current = window.__geekTranslationRequest;
          if (typeof current !== 'function') return false;
          if (current.__geekTranslationIntentTransport === true) return true;
          const wrapped = function (payload) {
            const body = payload && typeof payload === 'object' ? payload : {};
            let intent = body.intent === 'outgoing-send' ? 'outgoing-send' : 'message-display';
            const pending = pendingOutgoingIntent;
            if (intent !== 'outgoing-send' && pending) {
              if (pending.expiresAt <= Date.now()) {
                pendingOutgoingIntent = null;
              } else if (String(body.chatId || '') === pending.chatId && cleanText(body.text) === pending.text) {
                intent = 'outgoing-send';
                pendingOutgoingIntent = null;
              }
            }
            return current.call(this, Object.assign({}, body, { intent }));
          };
          try {
            Object.defineProperty(wrapped, '__geekTranslationIntentTransport', { value: true });
            Object.defineProperty(wrapped, '__geekTranslationIntentOriginal', { value: current });
          } catch (_) {}
          window.__geekTranslationRequest = wrapped;
          return true;
        };

        const markInitialHistoryRows = () => {
          const main = document.querySelector('#main');
          if (!main) return;
          main.querySelectorAll('div[role="row"]').forEach(row => {
            if (row.querySelector('[data-pre-plain-text]')) row.dataset[HISTORY_MARKER] = '1';
          });
        };

        const clearQueuedBackground = () => {
          backgroundGeneration += 1;
          while (backgroundQueue.length) {
            const item = backgroundQueue.shift();
            try { item.resolve(false); } catch (_) {}
          }
        };

        const invokeBackground = item => {
          if (!item.isHistory) return item.original(item.row);
          const getter = window.__geekGetTranslationSetting;
          if (typeof getter !== 'function') return item.original(item.row);
          window.__geekGetTranslationSetting = function (chatId) {
            const setting = getter(chatId);
            return setting && typeof setting === 'object'
              ? Object.assign({}, setting, { translationMode: 'click' })
              : setting;
          };
          try {
            return item.original(item.row);
          } finally {
            window.__geekGetTranslationSetting = getter;
          }
        };

        const drainBackground = () => {
          while (backgroundActive < BACKGROUND_ACTIVE_LIMIT && backgroundQueue.length) {
            const item = backgroundQueue.shift();
            if (item.generation !== backgroundGeneration || !item.chatId || item.chatId !== activeChatId()) {
              try { item.resolve(false); } catch (_) {}
              continue;
            }
            backgroundActive += 1;
            Promise.resolve()
              .then(() => invokeBackground(item))
              .then(value => item.resolve(value), error => item.reject(error))
              .finally(() => {
                backgroundActive = Math.max(0, backgroundActive - 1);
                drainBackground();
              });
          }
        };

        const installBackgroundAdmission = () => {
          const current = window.__geekTranslateVisibleMessage;
          if (typeof current !== 'function') return false;
          if (current.__geekBackgroundAdmission === true) return true;
          const original = current;
          const wrapped = function (row) {
            const chatId = activeChatId();
            const generation = backgroundGeneration;
            const isHistory = row?.dataset?.[HISTORY_MARKER] === '1';
            if (isHistory && row?.dataset) delete row.dataset[HISTORY_MARKER];
            return new Promise((resolve, reject) => {
              if (!chatId || generation !== backgroundGeneration) { resolve(false); return; }
              if (backgroundQueue.length >= BACKGROUND_QUEUE_LIMIT) {
                const dropped = backgroundQueue.shift();
                try { dropped.resolve(false); } catch (_) {}
              }
              backgroundQueue.push({ row, chatId, generation, isHistory, original, resolve, reject });
              drainBackground();
            });
          };
          wrapped.__geekBackgroundAdmission = true;
          wrapped.__geekBackgroundOriginal = original;
          window.__geekTranslateVisibleMessage = wrapped;
          window.__geekWhatsAppTranslationAdmission = Object.freeze({
            activeLimit: BACKGROUND_ACTIVE_LIMIT,
            queueLimit: BACKGROUND_QUEUE_LIMIT,
          });
          return true;
        };

        const scheduleAdmissionInstall = () => {
          const intentReady = installTranslationIntentTransport();
          const admissionReady = installBackgroundAdmission();
          if (intentReady && admissionReady) {
            if (admissionRetryTimer) clearTimeout(admissionRetryTimer);
            admissionRetryTimer = null;
            admissionRetryCount = 0;
            return;
          }
          if (admissionRetryTimer || admissionRetryCount >= ADMISSION_RETRY_LIMIT) return;
          admissionRetryCount += 1;
          admissionRetryTimer = setTimeout(() => {
            admissionRetryTimer = null;
            scheduleAdmissionInstall();
          }, 100);
        };

        const scheduleRefresh = () => {
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => {
            scheduleAdmissionInstall();
            const next = activeChatId();
            if (!next || next === lastChatId) return;
            pendingOutgoingIntent = null;
            clearQueuedBackground();
            lastChatId = next;
            markInitialHistoryRows();
            const refresh = window.__geekRefreshTranslationView;
            if (typeof refresh === 'function') refresh();
          }, 80);
        };

        const bindMain = () => {
          const main = document.querySelector('#main');
          if (!main || main === window.__geekTranslationRehydrateRoot) return false;
          rootObserver?.disconnect();
          window.__geekTranslationRehydrateRoot = main;
          markInitialHistoryRows();
          rootObserver = new MutationObserver(scheduleRefresh);
          rootObserver.observe(main, { childList: true, subtree: true });
          scheduleAdmissionInstall();
          scheduleRefresh();
          return true;
        };

        bodyObserver = new MutationObserver(() => {
          bindMain();
          scheduleAdmissionInstall();
          scheduleRefresh();
        });
        bodyObserver.observe(document.documentElement, { childList: true, subtree: true });
        bindMain();
        scheduleAdmissionInstall();
        scheduleRefresh();

        window.__geekTranslationRehydrateDispose = () => {
          clearTimeout(refreshTimer);
          if (admissionRetryTimer) clearTimeout(admissionRetryTimer);
          admissionRetryTimer = null;
          pendingOutgoingIntent = null;
          intentAbort.abort();
          clearQueuedBackground();
          rootObserver?.disconnect();
          bodyObserver?.disconnect();
          delete window.${INSTALL_MARKER};
          delete window.__geekTranslationRehydrateRoot;
          delete window.__geekWhatsAppTranslationAdmission;
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
