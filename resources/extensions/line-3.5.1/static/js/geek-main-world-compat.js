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
    const downloadError = (code, message) => {
      const error = new Error(message);
      error.code = code;
      return error;
    };
    const safeFilename = (value) => {
      const basename = String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim();
      return (basename || 'download').slice(0, 180);
    };
    const download = async (options = {}) => {
      const url = String(options?.url || '').trim();
      const origin = String(root.location?.origin || '').trim();
      const expectedBlobPrefix = origin ? `blob:${origin}/` : '';
      if (!expectedBlobPrefix || !url.startsWith(expectedBlobPrefix)) {
        throw downloadError(
          'LINE_CONTEXT_ISOLATION_DOWNLOAD_URL_REJECTED',
          'LINE context isolation downloads only accept same-origin blob URLs',
        );
      }
      if (typeof root.fetch !== 'function'
        || typeof root.GeekLineDownloads?.saveBlob !== 'function') {
        throw downloadError(
          'LINE_CONTEXT_ISOLATION_DOWNLOAD_BRIDGE_UNAVAILABLE',
          'LINE context isolation download bridge is unavailable',
        );
      }
      const response = await root.fetch(url);
      if (!response || typeof response.blob !== 'function') {
        throw downloadError(
          'LINE_CONTEXT_ISOLATION_DOWNLOAD_BLOB_INVALID',
          'LINE context isolation blob response is invalid',
        );
      }
      const blob = await response.blob();
      return root.GeekLineDownloads.saveBlob(
        blob,
        safeFilename(options?.filename),
        options?.saveAs === true,
      );
    };
    chrome.downloads = {
      download,
      ok: (callback) => { if (typeof callback === 'function') callback(); },
      onChanged: event(),
    };
  }
})();
