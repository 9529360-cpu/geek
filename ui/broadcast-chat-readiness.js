(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastChatReadiness = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STATE_LOADING = 'loading';
  const STATE_READY = 'ready';
  const STATE_RETRYABLE = 'retryable';
  const STATE_CANCELLED = 'cancelled';

  function requireChats(value) {
    if (!Array.isArray(value)) throw new TypeError('listChats must resolve to an array');
    return value;
  }

  async function loadBroadcastChatsWithReadiness(options = {}) {
    const family = String(options.family || '');
    const listChats = options.listChats;
    const isReady = options.isReady;
    const isCurrent = typeof options.isCurrent === 'function' ? options.isCurrent : () => true;
    const onState = typeof options.onState === 'function' ? options.onState : () => {};
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const sleep = typeof options.sleep === 'function'
      ? options.sleep
      : ms => new Promise(resolve => setTimeout(resolve, ms));
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || 12000);
    const pollMs = Math.max(1, Number(options.pollMs) || 500);

    if (typeof listChats !== 'function') throw new TypeError('listChats must be a function');

    if (family !== 'whatsapp') {
      const chats = requireChats(await listChats());
      return isCurrent() ? { state: STATE_READY, chats } : { state: STATE_CANCELLED };
    }
    if (typeof isReady !== 'function') throw new TypeError('WhatsApp isReady must be a function');

    const startedAt = now();
    let lastError = null;
    onState(STATE_LOADING);

    while (isCurrent()) {
      let ready = false;
      try {
        ready = (await isReady()) === true;
      } catch (error) {
        lastError = error;
      }

      if (!isCurrent()) return { state: STATE_CANCELLED };

      if (ready) {
        try {
          const chats = requireChats(await listChats());
          if (!isCurrent()) return { state: STATE_CANCELLED };
          return { state: STATE_READY, chats };
        } catch (error) {
          lastError = error;
        }
      }

      const elapsed = Math.max(0, now() - startedAt);
      if (elapsed >= timeoutMs) {
        onState(STATE_RETRYABLE);
        return { state: STATE_RETRYABLE, error: lastError || null };
      }

      await sleep(Math.min(pollMs, Math.max(1, timeoutMs - elapsed)));
    }

    return { state: STATE_CANCELLED };
  }

  return Object.freeze({
    STATE_LOADING,
    STATE_READY,
    STATE_RETRYABLE,
    STATE_CANCELLED,
    loadBroadcastChatsWithReadiness,
  });
});
