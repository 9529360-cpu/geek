// WebView2 page script for the LINE extension document only.
// Fills chrome.* names the page asks for when the host did not provide them.
// Existing WebView2 chrome APIs are left in place. This is not a Node preload.
(function () {
  'use strict';
  var extensionId = 'ophjlpahpchlmihnnnihgmmeilfjmjjc';
  if (window !== window.top || !location || location.protocol !== 'chrome-extension:'
      || location.hostname !== extensionId || window.__geekLineChromeShim) return;
  window.__geekLineChromeShim = true;
  var noop = function () {};
  function missing(prop) {
    if (typeof prop === 'string' && prop.indexOf('on') === 0) {
      return { addListener: noop, removeListener: noop, hasListener: function () { return false; } };
    }
    return function () { return Promise.resolve(undefined); };
  }
  function fill(target) {
    return new Proxy(target || {}, {
      get: function (obj, prop) {
        if (prop in obj) return obj[prop];
        if (prop === Symbol.toPrimitive || prop === 'then') return undefined;
        var value = missing(prop);
        obj[prop] = value;
        return value;
      },
      set: function (obj, prop, value) { obj[prop] = value; return true; },
    });
  }
  function storageArea() {
    function read(key) {
      try {
        var stored = localStorage.getItem(key);
        return stored == null ? undefined : JSON.parse(stored);
      } catch (error) { return undefined; }
    }
    return {
      get: function (keys) {
        return Promise.resolve().then(function () {
          var result = {};
          if (keys == null) {
            for (var index = 0; index < localStorage.length; index += 1) {
              var name = localStorage.key(index);
              var value = read(name);
              if (value !== undefined) result[name] = value;
            }
          } else if (typeof keys === 'string') {
            var one = read(keys);
            if (one !== undefined) result[keys] = one;
          } else if (Array.isArray(keys)) {
            keys.forEach(function (key) { var value = read(key); if (value !== undefined) result[key] = value; });
          }
          return result;
        });
      },
      set: function (items) {
        return Promise.resolve().then(function () {
          Object.keys(items || {}).forEach(function (key) {
            localStorage.setItem(key, JSON.stringify(items[key]));
          });
        });
      },
      remove: function (keys) {
        return Promise.resolve().then(function () {
          (Array.isArray(keys) ? keys : [keys]).forEach(function (key) { localStorage.removeItem(key); });
        });
      },
      clear: function () { return Promise.resolve().then(function () { localStorage.clear(); }); },
    };
  }
  var chromeApi = window.chrome || {};
  if (!chromeApi.runtime) {
    chromeApi.runtime = fill({
      sendMessage: function () { return Promise.resolve(1); },
      getManifest: function () { return { name: 'LINE', version: '3.5.1' }; },
    });
  }
  if (!chromeApi.storage) chromeApi.storage = { local: storageArea(), sync: storageArea() };
  window.chrome = fill(chromeApi);
})();
