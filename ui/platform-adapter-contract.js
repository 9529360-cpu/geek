/* 极客统一平台能力契约。翻译与群发共享能力，不共享业务状态。 */
(() => {
  'use strict';
  const required = Object.freeze([
    'getCurrentChat', 'listChats', 'openChat', 'observeMessages',
    'parseMessage', 'getComposer', 'setComposerText', 'sendText'
  ]);
  const optional = Object.freeze(['sendMedia', 'sendFile', 'getMessageId', 'getChatId']);
  function validate(adapter) {
    if (!adapter || typeof adapter !== 'object') throw new TypeError('平台适配器必须是对象');
    for (const name of required) if (typeof adapter[name] !== 'function') throw new TypeError(`平台适配器缺少${name}()`);
    return adapter;
  }
  function envelope(accountId, payload) {
    if (typeof accountId !== 'string' || !accountId) throw new TypeError('平台能力调用缺少accountId');
    return Object.freeze({ protocolVersion: 1, accountId, timestamp: Date.now(), payload });
  }
  window.GeekPlatformAdapterContract = Object.freeze({ required, optional, validate, envelope });
})();
