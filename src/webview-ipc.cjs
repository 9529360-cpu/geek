'use strict';

const WEBVIEW_IPC_CHANNELS = Object.freeze([
  'webview:register',
  'webview:insert-text',
]);

const TELEGRAM_TYPES = new Set(['telegram-z', 'telegram', 'telegram-pure', 'telegram-k']);
const TELEGRAM_URL = /^https:\/\/web\.telegram\.org\//;
const LINE_URL = /^chrome-extension:\/\/ophjlpahpchlmihnnnihgmmeilfjmjjc\//;

const FOCUSED_COMPOSER_SCRIPT = `(() => {
      if (/^https:\\/\\/web\\.telegram\\.org\\//.test(location.href)) {
        const editor = document.querySelector('#editable-message-text.form-control.ProseMirror, #editable-message-text[contenteditable="true"]');
        return !!editor && (document.activeElement === editor || editor.contains(document.activeElement));
      }
      if (/^chrome-extension:\\/\\/ophjlpahpchlmihnnnihgmmeilfjmjjc\\//.test(location.href)) {
        const host = document.querySelector('textarea-ex[class*="chatroomEditor-module__textarea__"]');
        const textarea = host?.shadowRoot?.querySelector('textarea');
        return /#\\/chats\\/[^/?#]+/.test(location.hash) && !!textarea && (document.activeElement === host || host.shadowRoot?.activeElement === textarea);
      }
      return false;
    })()`;

function installWebviewIpc(options = {}) {
  const {
    ipcMain,
    assertTrustedSender,
    accountState,
    webviewOwnership,
    getWebContentsById,
    getSessionForPartition,
  } = options;

  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function') {
    throw new TypeError('ipcMain handle/removeHandler API is required');
  }
  if (typeof assertTrustedSender !== 'function') throw new TypeError('assertTrustedSender is required');
  if (!accountState || typeof accountState.resolvePartition !== 'function' || typeof accountState.findById !== 'function') {
    throw new TypeError('accountState resolve/find authority is required');
  }
  if (!webviewOwnership || typeof webviewOwnership.register !== 'function' || typeof webviewOwnership.authorize !== 'function' || typeof webviewOwnership.remove !== 'function') {
    throw new TypeError('webviewOwnership authority is required');
  }
  if (typeof getWebContentsById !== 'function') throw new TypeError('getWebContentsById is required');
  if (typeof getSessionForPartition !== 'function') throw new TypeError('getSessionForPartition is required');

  const registeredChannels = new Set();
  const cleanupBoundGuests = new WeakSet();
  let disposed = false;

  const register = (channel, handler) => {
    ipcMain.handle(channel, async (event, ...args) => {
      assertTrustedSender(event);
      return handler(event, ...args);
    });
    registeredChannels.add(channel);
  };

  const resolveAccountBinding = (accountId, errorMessage) => {
    const partition = accountState.resolvePartition(accountId);
    const account = accountState.findById(accountId);
    if (!account || typeof partition !== 'string' || !partition || String(account.partition || '') !== partition) {
      throw new Error(errorMessage);
    }
    return { account, partition };
  };

  const resolveLiveGuest = (guestId) => {
    const id = Number(guestId);
    if (!Number.isInteger(id) || id <= 0) return null;
    const guest = getWebContentsById(id);
    if (!guest || typeof guest.isDestroyed !== 'function') return null;
    try {
      return guest.isDestroyed() ? null : guest;
    } catch {
      return null;
    }
  };

  const guestUrl = (guest) => {
    try { return String(guest.getURL?.() || ''); } catch { return ''; }
  };

  const bindGuestCleanup = (guest) => {
    if (cleanupBoundGuests.has(guest)) return;
    cleanupBoundGuests.add(guest);
    guest.once('destroyed', () => webviewOwnership.remove(guest.id));
  };

  register('webview:register', async (event, accountId, guestId, token) => {
    const { account, partition } = resolveAccountBinding(accountId, 'WebView登记失败');
    const guest = resolveLiveGuest(guestId);
    const url = guestUrl(guest);
    const allowedPage = (TELEGRAM_TYPES.has(account.type) && TELEGRAM_URL.test(url))
      || ((account.type === 'line' || account.type === 'line-business') && LINE_URL.test(url));
    if (!guest
      || guest === event.sender
      || guest.hostWebContents !== event.sender
      || guest.session !== getSessionForPartition(partition)
      || !allowedPage) {
      throw new Error('WebView登记失败');
    }
    webviewOwnership.register({
      guestId: guest.id,
      accountId,
      partition,
      token,
      senderId: event.sender.id,
    });
    bindGuestCleanup(guest);
    return true;
  });

  register('webview:insert-text', async (event, accountId, guestId, text, token) => {
    const { partition } = resolveAccountBinding(accountId, '账号输入页面不可用');
    const value = String(text ?? '');
    if (!value || value.length > 10000) throw new Error('输入文本不合法');
    const guest = resolveLiveGuest(guestId);
    const url = guestUrl(guest);
    const allowedInputPage = TELEGRAM_URL.test(url) || LINE_URL.test(url);
    const ownershipOk = webviewOwnership.authorize({
      guestId,
      accountId,
      partition,
      token,
      senderId: event.sender.id,
    });
    if (!guest
      || guest === event.sender
      || guest.session !== getSessionForPartition(partition)
      || !allowedInputPage
      || !ownershipOk
      || typeof guest.executeJavaScript !== 'function'
      || typeof guest.insertText !== 'function') {
      throw new Error('账号输入页面不可用');
    }
    const focusedComposer = await guest.executeJavaScript(FOCUSED_COMPOSER_SCRIPT);
    if (!focusedComposer) throw new Error('消息输入框未获得焦点');
    await guest.insertText(value);
    return true;
  });

  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const channel of registeredChannels) ipcMain.removeHandler(channel);
      registeredChannels.clear();
    },
  });
}

module.exports = {
  WEBVIEW_IPC_CHANNELS,
  installWebviewIpc,
};
