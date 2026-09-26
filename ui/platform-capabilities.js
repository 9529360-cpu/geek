/* Neutral host-side platform capability owner. Business flows consume capabilities; they do not own platform mechanics. */
(() => {
  'use strict';

  function create(options = {}) {
    const familyOf = options.familyOf;
    const definitions = options.definitions;
    const contract = options.contract;
    const buildAdapter = options.buildAdapter;

    if (typeof familyOf !== 'function') throw new TypeError('platform capability family resolver is required');
    if (!definitions || typeof definitions !== 'object') throw new TypeError('platform capability definitions are required');
    if (!contract || typeof contract.validate !== 'function' || !Array.isArray(contract.hostRequired)) {
      throw new TypeError('platform capability contract is required');
    }
    if (typeof buildAdapter !== 'function') throw new TypeError('platform capability adapter builder is required');

    function forAccount(account, webview) {
      if (!account || !webview) throw new Error("平台账号不可用");
      if (account.type === 'website') throw new Error("自定义网站暂不支持 Geek 平台增强功能");
      const family = familyOf(account.type).key;
      const definition = family === 'telegram' ? definitions['telegram-z'] : definitions[family];
      if (!definition) throw new Error("平台不支持群发：" + family);

      const adapter = buildAdapter({ account, webview, family, definition });
      return contract.validate(adapter, contract.hostRequired);
    }
    return Object.freeze({ forAccount });
  }

  window.GeekPlatformCapabilities = Object.freeze({ create });
})();
