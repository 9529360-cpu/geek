(function (e) {
  var t = {};
  function n(o) {
    if (t[o]) return t[o].exports;
    var r = (t[o] = { i: o, l: !1, exports: {} });
    return (e[o].call(r.exports, r, r.exports, n), (r.l = !0), r.exports);
  }
  ((n.m = e),
    (n.c = t),
    (n.d = function (e, t, o) {
      n.o(e, t) || Object.defineProperty(e, t, { enumerable: !0, get: o });
    }),
    (n.r = function (e) {
      ('undefined' !== typeof Symbol && Symbol.toStringTag && Object.defineProperty(e, Symbol.toStringTag, { value: 'Module' }), Object.defineProperty(e, '__esModule', { value: !0 }));
    }),
    (n.t = function (e, t) {
      if ((1 & t && (e = n(e)), 8 & t)) return e;
      if (4 & t && 'object' === typeof e && e && e.__esModule) return e;
      var o = Object.create(null);
      if ((n.r(o), Object.defineProperty(o, 'default', { enumerable: !0, value: e }), 2 & t && 'string' != typeof e))
        for (var r in e)
          n.d(
            o,
            r,
            function (t) {
              return e[t];
            }.bind(null, r)
          );
      return o;
    }),
    (n.n = function (e) {
      var t =
        e && e.__esModule
          ? function () {
              return e['default'];
            }
          : function () {
              return e;
            };
      return (n.d(t, 'a', t), t);
    }),
    (n.o = function (e, t) {
      return Object.prototype.hasOwnProperty.call(e, t);
    }),
    (n.p = '/'),
    n((n.s = 20)));
})({
  20: function (e, t, n) {
    e.exports = n('dc996');
  },
  '51be': function (e, t, n) {
    'use strict';
    (n.d(t, 'c', function () {
      return o;
    }),
      n.d(t, 'b', function () {
        return r;
      }),
      n.d(t, 'a', function () {
        return i;
      }),
      n.d(t, 'j', function () {
        return s;
      }),
      n.d(t, 'f', function () {
        return l;
      }),
      n.d(t, 'g', function () {
        return c;
      }),
      n.d(t, 'd', function () {
        return d;
      }),
      n.d(t, 'e', function () {
        return b;
      }));
    const o = 'chrome',
      r = 'default',
      i = 'waplus.io',
      s = 'lab.zingfront.com',
      l = 'https://' + i,
      u = 'production',
      c = n('9224').version;
    let a = '';
    a = 'chrome' === o ? 'jmjcgjmipjiklbnfbdclkdikplgajhgc' : 'nhkkbpphaankeiolhcpmaemibkamionn';
    const d = a;
    // 'production' === u && ((console.log = function () {}), (console.warn = function () {}), (console.info = function () {}), (console.error = function () {}));
    const p = [];
    async function b() {
      try {
        var e;
        const { zbaseConfig: n } = await chrome.storage.local.get('zbaseConfig');
        if (null !== n && void 0 !== n && null !== (e = n.data) && void 0 !== e && e.config) {
          const e = n.data.config.find((e) => '304' === e.id);
          if (null !== e && void 0 !== e && e.params)
            try {
              return e.params;
            } catch (t) {
              return (console.warn('Failed to parse RESPONSE_DATA_LOG_PATHS from zbaseConfig:', t), p);
            }
        }
        return p;
      } catch (n) {
        return (console.warn('Failed to get response data log paths from zbaseConfig:', n), p);
      }
    }
  },
  9224: function (e) {
    e.exports = JSON.parse(
      '{"name":"WAPlus","version":"1.7.96","private":true,"scripts":{"serve":"vue-cli-service build --mode production --my-env=development --watch","dev":"concurrently \\"npm run serve\\" \\"web-ext run --source-dir ./dist --target chromium --no-reload\\"","build":"npm run build:chrome && npm run build:edge","build:test":"vue-cli-service build --my-env=development","build:chrome":"node scripts/build.js chrome production","build:edge":"node scripts/build.js edge production","build:chrome:dev":"node scripts/build.js chrome development","build:edge:dev":"node scripts/build.js edge development","build:all":"npm run build:chrome && npm run build:edge","build:all:dev":"npm run build:chrome:dev && npm run build:edge:dev"},"dependencies":{"@hubspot/api-client":"^10.2.0","ali-oss":"^6.17.1","ant-design-vue":"1.7.8","awesome-phonenumber":"^3.0.2","axios":"^0.27.2","babel-plugin-component":"^1.1.1","copy-webpack-plugin":"6","core-js":"^3.6.5","crypto-js":"^4.2.0","dayjs":"^1.11.0","dayjs-business-days":"^1.0.4","dotenv":"^16.0.0","element-ui":"^2.15.6","file-saver":"^2.0.5","highlight.js":"^11.11.1","js-audio-recorder":"^1.0.7","js-sls-logger-v3":"^1.0.16","jsencrypt":"^3.3.2","lamejs":"^1.2.1","lodash":"~4.17.21","markdown-it":"^14.1.0","mime-types":"^2.1.35","mri":"~1.2.0","phone-number-to-timezone":"~1.0.8","shepherd.js":"^11.0.1","vcards-js":"^2.10.0","vue":"^2.6.11","vue-infinite-scroll":"^2.0.2","vue-router":"^3.5.3","vue-shepherd":"^0.3.0","vue-virtual-scroller":"^1.1.2","vue2-editor":"^2.10.3","vuedraggable":"^2.24.3","vuex":"^3.6.2","webext-bridge":"^6.0.1","xlsx":"^0.17.4","xss":"^1.0.15","zbase-popup-component":"git+ssh://git@git.zingfront.cn:scrm/zbase-popup-component.git"},"devDependencies":{"@babel/core":"^7.27.4","@babel/preset-env":"^7.27.2","@types/webextension-polyfill":"^0.8.2","@vue/cli-plugin-babel":"~4.5.0","@vue/cli-plugin-eslint":"~4.5.0","@vue/cli-service":"~4.5.0","@vue/eslint-config-prettier":"^6.0.0","@vue/test-utils":"^1.3.6","@vue/vue2-jest":"^29.2.6","babel-eslint":"^10.1.0","babel-jest":"^29.7.0","babel-plugin-transform-remove-console":"^6.9.4","concurrently":"^9.2.1","cross-env":"^7.0.3","cypress":"^14.5.0","dotenv-webpack":"^7.1.0","eslint":"^6.7.2","eslint-plugin-prettier":"^3.3.1","eslint-plugin-vue":"^6.2.2","jest":"^29.7.0","jest-environment-jsdom":"^29.7.0","less":"^4.1.3","less-loader":"^6.0.0","prettier":"^2.2.1","sass":"~1.32.6","sass-loader":"8.x","stylus":"^0.57.0","stylus-loader":"^3.0.2","vue-cli-plugin-browser-extension":"~0.25.2","vue-i18n":"^8.27.1","vue-template-compiler":"^2.6.11","web-ext":"^10.1.0","web-ext-types":"^3.2.1","webextension-polyfill":"^0.8.0"},"browserslist":["> 1%","last 2 versions","not dead"]}'
    );
  },
  dc996: function (e, t, n) {
    'use strict';
    n.r(t);
    var o = n('ff6b'),
      r = n('51be');
    function i() {
      const e = new o['a']();
      e.setInterval(function () {
        null !== document.querySelector('.pay-success-bth') && (chrome.runtime.sendMessage({ type: 'refreshUserInfo' }), e.clearInterval());
      }, 500);
    }
    let s = new RegExp(`https://${r['a']}/pricing.*$`);
    s.test(window.location.href) && i();
  },
  ff6b: function (e, t, n) {
    'use strict';
    class o {
      constructor() {
        ((this.timerId = null), (this.hasSetCallback = !1), (this.testId = null));
      }
      setTimeout(e, t, ...n) {
        this.hasSetCallback ? console.warn('The callback function has set. You could not set another callback function.') : (this.timerId = setTimeout(e, t, ...n));
      }
      clearTimeout() {
        this._clearTimeout();
      }
      setInterval(e, t, ...n) {
        if (((this.testId = n[0]), this.hasSetCallback)) return void console.warn('The callback function has set. You could not set another callback function.');
        this.hasSetCallback = !0;
        const o = this;
        function r() {
          const i = setTimeout(
            () => {
              ((o.timerId = i), e(...n), clearTimeout(i), o.timerId && r());
            },
            t,
            ...n
          );
        }
        r();
      }
      clearInterval() {
        this._clearTimeout();
      }
      _clearTimeout() {
        this.timerId && (clearTimeout(this.timerId), (this.timerId = null));
      }
    }
    t['a'] = o;
  },
});
