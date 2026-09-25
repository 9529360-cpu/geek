(() => {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const noop = () => {};
  const event = () => Object.freeze({
    addListener: noop,
    removeListener: noop,
    hasListener: () => false,
  });

  if (typeof root._pluginKD !== 'function') root._pluginKD = (handler) => handler;
  if (typeof root._PluginT !== 'function') root._PluginT = (message) => message;
  if (typeof root._PluginVT !== 'function') root._PluginVT = noop;
  if (typeof root.hS !== 'function') {
    root.hS = () => ({
      legyHost: '',
      osName: 'Windows',
      proxyProtocol: '',
      proxyHost: '',
      proxyPort: '',
      proxyUser: '',
      proxyPwd: '',
      regionCode: 'JP',
      isFirst: false,
      appId: '',
      url: '',
      showName: '',
      translationEnabled: false,
      translationTargetLanguage: 'zh-CN',
      lineLang: '',
      openProxy: false,
    });
  }

  const chrome = root.chrome || (root.chrome = {});
  if (!chrome.notifications) {
    chrome.notifications = {
      create: noop,
      clear: noop,
      update: noop,
      onClicked: event(),
      onClosed: event(),
    };
  }
  if (!chrome.cookies) {
    chrome.cookies = { remove: noop };
  }
  if (!chrome.downloads) {
    chrome.downloads = {
      download: () => {
        const error = new Error('LINE download is unavailable in the context isolation candidate');
        error.code = 'LINE_CONTEXT_ISOLATION_DOWNLOAD_UNAVAILABLE';
        return Promise.reject(error);
      },
      ok: (callback) => { if (typeof callback === 'function') callback(); },
      onChanged: event(),
    };
  }
})();
