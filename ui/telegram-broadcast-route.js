(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekTelegramBroadcastRoute = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  let installed = false;
  let installTimer = null;

  function routeConfirmed(selected, currentChatId, targetChatId, sameChat) {
    return selected === true
      && typeof sameChat === 'function'
      && sameChat(currentChatId, targetChatId) === true;
  }

  function setTrace(stage) {
    if (typeof window === 'undefined') return;
    window.__geekBroadcastTelegramRouteTrace = Object.freeze({
      stage: String(stage || 'unknown'),
      at: Date.now(),
    });
  }

  function selectedRouteScript(targetId) {
    const targetHref = '#' + String(targetId || '').replace(/^#/, '');
    return `(() => [...document.querySelectorAll('.chat-item-clickable')].some(row =>
      row.classList.contains('selected') && row.querySelector('a')?.getAttribute('href') === ${JSON.stringify(targetHref)}
    ))()`;
  }

  async function confirmSelectedRoute(platform, wv, chatId, attempts = 8) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const current = await platform.getCurrentChat();
      const selected = await wv.executeJavaScript(selectedRouteScript(chatId));
      if (routeConfirmed(selected, current, chatId, window.GeekBroadcastSafety?.sameChat)) return true;
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    return false;
  }

  function realRouteScript(targetId) {
    return `(async () => {
      const targetId = ${JSON.stringify(String(targetId || ''))};
      const href = '#' + targetId.replace(/^#/, '');
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const chatLists = () => [...document.querySelectorAll('.chat-list.custom-scroll, .custom-scroll')]
        .filter((list, index, all) => all.indexOf(list) === index)
        .filter(list => list.querySelector('.chat-item-clickable'));
      const visibleList = list => {
        try {
          const style = getComputedStyle(list);
          const rect = list.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        } catch (_) { return false; }
      };
      const list = chatLists().find(visibleList) || chatLists()[0] || null;
      const rows = () => list ? [...list.querySelectorAll('.chat-item-clickable')] : [];
      const targetRow = () => rows().find(row => row.querySelector('a')?.getAttribute('href') === href) || null;
      const clickRow = row => {
        const a = row?.querySelector('a');
        if (!a) return false;
        row.scrollIntoView?.({ block: 'center' });
        const firePointer = (type, buttons) => a.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, view: window,
          pointerId: 1, pointerType: 'mouse', isPrimary: true,
          button: 0, buttons,
        }));
        firePointer('pointerdown', 1);
        a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
        firePointer('pointerup', 0);
        a.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 0 }));
        a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, button: 0 }));
        return true;
      };
      const selected = row => !!row?.classList?.contains('selected');

      if (!targetId) return 'INVALID_TARGET';
      if (!list) return 'NO_CHAT_LIST';
      let row = targetRow();
      if (!row) {
        const originalTop = Number(list.scrollTop) || 0;
        const maxTop = Math.max(0, Number(list.scrollHeight || 0) - Number(list.clientHeight || 0));
        const step = Math.max(220, Math.floor((Number(list.clientHeight) || 600) * 0.75));
        const positions = [];
        for (let top = 0; top <= maxTop + step; top += step) positions.push(Math.min(top, maxTop));
        if (!positions.includes(maxTop)) positions.push(maxTop);
        for (const top of positions.slice(0, 160)) {
          list.scrollTop = top;
          list.dispatchEvent(new Event('scroll', { bubbles: true }));
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          await sleep(30);
          row = targetRow();
          if (row) break;
        }
        if (!row) {
          list.scrollTop = originalTop;
          list.dispatchEvent(new Event('scroll', { bubbles: true }));
          return 'TARGET_NOT_MOUNTED';
        }
      }

      if (!clickRow(row)) return 'ROW_CLICK_FAILED';
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(120);
        const live = targetRow();
        if (selected(live)) return 'SELECTED';
      }
      return 'SELECTION_NOT_CONFIRMED';
    })()`;
  }

  function wrapFactory(factory) {
    return function telegramRouteAwareFactory(account, wv) {
      const platform = factory(account, wv);
      if (!platform || platform.family !== 'telegram' || typeof platform.openChat !== 'function') return platform;
      const baseOpenChat = platform.openChat.bind(platform);
      return Object.freeze({
        ...platform,
        async openChat(chatId) {
          setTrace('base-open');
          const baseOpened = await baseOpenChat(chatId);
          if (baseOpened) {
            setTrace('base-verifying');
            if (await confirmSelectedRoute(platform, wv, chatId)) {
              setTrace('base-confirmed');
              return true;
            }
            setTrace('base-unconfirmed');
          }

          // A matching hash is only navigation intent. If the real Telegram row is
          // not selected, continue through the bounded real-row route instead of
          // treating the hash as proof that React opened the chat.
          setTrace('virtual-search');
          const result = await wv.executeJavaScript(realRouteScript(chatId));
          if (result !== 'SELECTED') {
            setTrace('route-failed:' + String(result || 'UNKNOWN'));
            throw new Error('TG_CHAT_ROUTE_NOT_CONFIRMED:' + String(result || 'UNKNOWN'));
          }

          setTrace('selected-ui');
          if (await confirmSelectedRoute(platform, wv, chatId, 30)) {
            setTrace('confirmed');
            return true;
          }

          setTrace('identity-timeout');
          throw new Error('TG_CHAT_ROUTE_NOT_CONFIRMED:IDENTITY_TIMEOUT');
        },
      });
    };
  }

  function install() {
    if (installed || typeof window === 'undefined') return installed;
    const current = window.GeekPlatformTransports;
    const factory = current?.forAccount;
    if (typeof factory !== 'function') return false;
    if (factory.__geekTelegramRouteAware === true) {
      installed = true;
      return true;
    }
    const wrapped = wrapFactory(factory);
    Object.defineProperty(wrapped, '__geekTelegramRouteAware', { value: true });
    window.GeekPlatformTransports = Object.freeze({ ...current, forAccount: wrapped });
    installed = true;
    setTrace('installed');
    window.GeekTelegramBroadcastRouteInstalled = true;
    return true;
  }

  function installWhenReady() {
    if (install()) return;
    let attempts = 0;
    installTimer = setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 200) {
        clearInterval(installTimer);
        installTimer = null;
        if (!installed) setTrace('install-timeout');
      }
    }, 25);
  }

  if (typeof window !== 'undefined') installWhenReady();

  return Object.freeze({ install, routeConfirmed, realRouteScript, selectedRouteScript });
});
