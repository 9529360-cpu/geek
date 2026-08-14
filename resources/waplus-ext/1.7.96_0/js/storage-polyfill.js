/**
 * chrome.storage.local Promise polyfill for Electron 22 MV2 extensions.
 * MV2 的 chrome.storage.local.get/set/remove 只支持回调，不返回 Promise。
 * 此脚本在 content-script.js 之前执行，将 API 统一包装为 Promise 风格。
 */
(function () {
  // content script 中可能 chrome 对象还没注入，此时直接返回
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
  // 防重入：如果已经 polyfill 过则跳过
  if (chrome.storage.local.__polyfilled) return;

  var _get = chrome.storage.local.get;
  var _set = chrome.storage.local.set;
  var _remove = chrome.storage.local.remove;

  // chrome.storage.local.get(keys, callback) 或 chrome.storage.local.get(keys) => Promise
  chrome.storage.local.get = function (keys, callback) {
    if (typeof callback === 'function') return _get.call(this, keys, callback);
    return new Promise(function (resolve, reject) {
      try {
        _get.call(this, keys, function (result) {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); }
          else { resolve(result); }
        });
      } catch (e) { reject(e); }
    }.bind(this));
  };

  // chrome.storage.local.set(items, callback) 或 chrome.storage.local.set(items) => Promise
  chrome.storage.local.set = function (items, callback) {
    if (typeof callback === 'function') return _set.call(this, items, callback);
    return new Promise(function (resolve, reject) {
      try {
        _set.call(this, items, function () {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); }
          else { resolve(); }
        });
      } catch (e) { reject(e); }
    }.bind(this));
  };

  // chrome.storage.local.remove(keys, callback) 或 chrome.storage.local.remove(keys) => Promise
  chrome.storage.local.remove = function (keys, callback) {
    if (typeof callback === 'function') return _remove.call(this, keys, callback);
    return new Promise(function (resolve, reject) {
      try {
        _remove.call(this, keys, function () {
          if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); }
          else { resolve(); }
        });
      } catch (e) { reject(e); }
    }.bind(this));
  };

  // 标记已 polyfill，防止 document_start/document_end 重复注入时二次包装
  try { Object.defineProperty(chrome.storage.local, '__polyfilled', { value: true, writable: false, configurable: false }); } catch (_) {}
})();
