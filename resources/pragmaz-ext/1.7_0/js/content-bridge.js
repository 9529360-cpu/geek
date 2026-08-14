// ─── postMessage origin 补丁 ─────────────────────────────────────
// WhatsApp 硬编码 webtp.whatsapp.net 等域名作为 postMessage targetOrigin，
// 但本地运行时 iframe/popup 实际 origin 为 localhost:1842，导致报错。
// 对这些窗口设置 own property 覆盖 postMessage，把 WA 域名替换为 '*'。
(function () {
  var WA_PM_ORIGINS = [
    'https://webtp.whatsapp.net',
    'https://web.whatsapp.com',
    'https://www.whatsapp.com',
    'https://static.whatsapp.net',
  ];
  function patchWin(win) {
    if (!win || win.__waPmPatched__) return;
    try {
      win.__waPmPatched__ = true;
      var proto = Object.getPrototypeOf(win);
      var nativePM = (proto && proto.postMessage) ? proto.postMessage : win.postMessage;
      win.postMessage = function (message, targetOrigin, transfer) {
        if (typeof targetOrigin === 'string' && WA_PM_ORIGINS.indexOf(targetOrigin) !== -1) {
          targetOrigin = '*';
        }
        return nativePM.call(this, message, targetOrigin, transfer);
      };
    } catch (e) {}
  }
  // 补丁主窗口
  patchWin(window);
  // 监听新 iframe 并补丁
  var _pmObs = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeName === 'IFRAME') {
          (function (iframe) {
            iframe.addEventListener('load', function () {
              try { patchWin(iframe.contentWindow); } catch (e) {}
            });
            try { patchWin(iframe.contentWindow); } catch (e) {}
          })(node);
        }
      }
    }
  });
  _pmObs.observe(document.documentElement || document, { childList: true, subtree: true });
})();
// ─────────────────────────────────────────────────────────────────

var WhatsApp = function (a, b) {
  this.mutex = a;
  this.majordomo = b;
};
WhatsApp.prototype.wrapCallbackWithDelay = function (a, b) {
  var c = this.mutex,
    d = this,
    e = function () {
      a.call(d);
      c.unlock();
    };
  c.lock(
    void 0 !== b
      ? function () {
          setTimeout(e, b);
        }
      : e
  );
};
WhatsApp.prototype.majordomoHandler = function (a) {};
WhatsApp.prototype.readContacts = function (a) {
  a = a || !1;
  this.wrapCallbackWithDelay(function () {
    this.majordomo.sendData({ action: 'readContacts', params: { reset: a } });
  }, 500);
};
function setCookie() {
  const a = new Date();
  a.setTime(a.getTime() + 31104e6);
  document.cookie = `wa_build=c;expires=${a.toUTCString()};domain=.web.whatsapp.com;path=/;Secure`;
}
var minhaDataToda;
chrome.storage.local.get(function (a) {
  try {
    (Object.keys(a).forEach((b) => {
      b.includes('file_') && delete a[b];
      b.includes('madata_cache') && delete a[b];
      b.includes('msgautosalvas') && (a[b] = btoa(unescape(encodeURIComponent(a[b]))));
    }),
      (minhaDataToda = a));
  } catch (b) {
    console.log(b);
  }
});
window.addEventListener(
  'SalvaNoBd',
  function (a) {
    chrome.storage.local.set({ [a.detail.msg]: a.detail.dir });
  },
  !1
);
window.addEventListener(
  'DeletaDoBd',
  function (a) {
    chrome.storage.local.remove(a.detail.msg);
  },
  !1
);
console.log('[WUPE DB Main] Handlers de banco de dados carregados');
window.addEventListener(
  'WUPE_DB_GET_ALL',
  function (a) {
    const { prefix: b, requestId: c } = a.detail;
    console.log('[WUPE DB] GET_ALL - prefix:', b, 'requestId:', c);
    chrome.storage.local.get(null, (d) => {
      if (chrome.runtime.lastError)
        (console.error('[WUPE DB] Erro ao obter todos:', chrome.runtime.lastError),
          window.dispatchEvent(new CustomEvent('WUPE_DB_ERROR', { detail: { operation: 'getAll', error: chrome.runtime.lastError.message, requestId: c } })));
      else {
        var e = {};
        for (const [f, g] of Object.entries(d)) f.startsWith(b) && (e[f] = g);
        console.log(`[WUPE DB] GET_ALL - Enviando ${Object.keys(e).length} itens para requestId:`, c);
        window.dispatchEvent(new CustomEvent('WUPE_DB_GET_BATCH_RESPONSE', { detail: { requestId: c, data: e } }));
      }
    });
  },
  !1
);
window.addEventListener(
  'WUPE_DB_SET',
  function (a) {
    const { msg: b, dir: c, requestId: d } = a.detail;
    chrome.storage.local.set({ [b]: c }, () => {
      chrome.runtime.lastError
        ? (console.error('[WUPE DB] Erro ao salvar:', chrome.runtime.lastError),
          window.dispatchEvent(new CustomEvent('WUPE_DB_ERROR', { detail: { operation: 'set', key: b, error: chrome.runtime.lastError.message, requestId: d } })))
        : window.dispatchEvent(new CustomEvent('WUPE_DB_SUCCESS', { detail: { operation: 'set', key: b, requestId: d } }));
    });
  },
  !1
);
window.addEventListener(
  'WUPE_DB_DELETE',
  function (a) {
    const { msg: b, requestId: c } = a.detail;
    chrome.storage.local.remove(b, () => {
      chrome.runtime.lastError
        ? (console.error('[WUPE DB] Erro ao deletar:', chrome.runtime.lastError),
          window.dispatchEvent(new CustomEvent('WUPE_DB_ERROR', { detail: { operation: 'delete', key: b, error: chrome.runtime.lastError.message, requestId: c } })))
        : window.dispatchEvent(new CustomEvent('WUPE_DB_SUCCESS', { detail: { operation: 'delete', key: b, requestId: c } }));
    });
  },
  !1
);
window.addEventListener(
  'WUPE_DB_GET',
  function (a) {
    const { key: b, requestId: c } = a.detail;
    chrome.storage.local.get([b], (d) => {
      chrome.runtime.lastError
        ? (console.error('[WUPE DB] Erro ao obter:', chrome.runtime.lastError),
          window.dispatchEvent(new CustomEvent('WUPE_DB_ERROR', { detail: { operation: 'get', key: b, error: chrome.runtime.lastError.message, requestId: c } })))
        : window.dispatchEvent(new CustomEvent('WUPE_DB_GET_RESPONSE', { detail: { requestId: c, value: d[b] } }));
    });
  },
  !1
);
window.addEventListener(
  'WUPE_DB_SET_BATCH',
  function (a) {
    const { entries: b, requestId: c } = a.detail,
      d = {};
    b.forEach(({ key: e, value: f }) => {
      d[e] = f;
    });
    chrome.storage.local.set(d, () => {
      chrome.runtime.lastError
        ? (console.error('[WUPE DB] Erro ao salvar lote:', chrome.runtime.lastError),
          window.dispatchEvent(new CustomEvent('WUPE_DB_ERROR', { detail: { operation: 'setMany', error: chrome.runtime.lastError.message, requestId: c } })))
        : window.dispatchEvent(new CustomEvent('WUPE_DB_SUCCESS', { detail: { operation: 'setMany', count: b.length, requestId: c } }));
    });
  },
  !1
);
window.addEventListener(
  'WUPE_DB_GET_BATCH',
  function (a) {
    const { keys: b, requestId: c } = a.detail;
    chrome.storage.local.get(b, (d) => {
      chrome.runtime.lastError
        ? (console.error('[WUPE DB] Erro ao obter lote:', chrome.runtime.lastError),
          window.dispatchEvent(new CustomEvent('WUPE_DB_ERROR', { detail: { operation: 'getMany', error: chrome.runtime.lastError.message, requestId: c } })))
        : window.dispatchEvent(new CustomEvent('WUPE_DB_GET_BATCH_RESPONSE', { detail: { requestId: c, data: d } }));
    });
  },
  !1
);
window.addEventListener(
  'WUPE_DB_DELETE_BATCH',
  function (a) {
    const { keys: b, requestId: c } = a.detail;
    chrome.storage.local.remove(b, () => {
      chrome.runtime.lastError
        ? (console.error('[WUPE DB] Erro ao deletar lote:', chrome.runtime.lastError),
          window.dispatchEvent(new CustomEvent('WUPE_DB_ERROR', { detail: { operation: 'deleteMany', error: chrome.runtime.lastError.message, requestId: c } })))
        : window.dispatchEvent(new CustomEvent('WUPE_DB_SUCCESS', { detail: { operation: 'deleteMany', count: b.length, requestId: c } }));
    });
  },
  !1
);
window.addEventListener(
  'WUPE_DB_FIND',
  function (a) {
    const { prefix: b, pattern: c, requestId: d } = a.detail;
    try {
      const e = new RegExp(c);
      chrome.storage.local.get(null, (f) => {
        if (chrome.runtime.lastError)
          (console.error('[WUPE DB] Erro ao buscar:', chrome.runtime.lastError),
            window.dispatchEvent(new CustomEvent('WUPE_DB_ERROR', { detail: { operation: 'find', error: chrome.runtime.lastError.message, requestId: d } })));
        else {
          var g = {};
          for (const [h, k] of Object.entries(f)) h.startsWith(b) && ((f = h.replace(b, '')), e.test(f) && (g[h] = k));
          window.dispatchEvent(new CustomEvent('WUPE_DB_FIND_RESPONSE', { detail: { requestId: d, data: g } }));
        }
      });
    } catch (e) {
      (console.error('[WUPE DB] Erro no padr\u00e3o regex:', e), window.dispatchEvent(new CustomEvent('WUPE_DB_ERROR', { detail: { operation: 'find', error: e.message, requestId: d } })));
    }
  },
  !1
);
window.addEventListener(
  'WUPE_DB_KEYS',
  function (a) {
    const { prefix: b, requestId: c } = a.detail;
    chrome.storage.local.get(null, (d) => {
      chrome.runtime.lastError
        ? (console.error('[WUPE DB] Erro ao listar chaves:', chrome.runtime.lastError),
          window.dispatchEvent(new CustomEvent('WUPE_DB_ERROR', { detail: { operation: 'keys', error: chrome.runtime.lastError.message, requestId: c } })))
        : ((d = Object.keys(d).filter((e) => e.startsWith(b))), window.dispatchEvent(new CustomEvent('WUPE_DB_KEYS_RESPONSE', { detail: { requestId: c, keys: d } })));
    });
  },
  !1
);
window.addEventListener(
  'WUPE_DB_LOAD_ALL',
  function (a) {
    const { prefix: b, requestId: c } = a.detail;
    chrome.storage.local.get(null, (d) => {
      if (chrome.runtime.lastError)
        (console.error('[WUPE DB] Erro ao carregar dados:', chrome.runtime.lastError),
          window.dispatchEvent(new CustomEvent('WUPE_DB_ERROR', { detail: { operation: 'loadAll', error: chrome.runtime.lastError.message, requestId: c } })));
      else {
        var e = {};
        for (const [f, g] of Object.entries(d)) f.startsWith(b) && (e[f] = g);
        console.log(`[WUPE DB] Carregados ${Object.keys(e).length} itens para ${b}`);
        window.dispatchEvent(new CustomEvent('WUPE_DB_GET_BATCH_RESPONSE', { detail: { requestId: c, data: e } }));
      }
    });
  },
  !1
);
window.addEventListener(
  'WUPE_DB_CLEAR',
  function (a) {
    const { prefix: b, requestId: c } = a.detail;
    chrome.storage.local.get(null, (d) => {
      if (chrome.runtime.lastError)
        (console.error('[WUPE DB] Erro ao buscar para limpar:', chrome.runtime.lastError),
          window.dispatchEvent(new CustomEvent('WUPE_DB_ERROR', { detail: { operation: 'clear', error: chrome.runtime.lastError.message, requestId: c } })));
      else {
        var e = Object.keys(d).filter((f) => f.startsWith(b));
        0 === e.length
          ? window.dispatchEvent(new CustomEvent('WUPE_DB_SUCCESS', { detail: { operation: 'clear', count: 0, requestId: c } }))
          : chrome.storage.local.remove(e, () => {
              chrome.runtime.lastError
                ? (console.error('[WUPE DB] Erro ao limpar:', chrome.runtime.lastError),
                  window.dispatchEvent(new CustomEvent('WUPE_DB_ERROR', { detail: { operation: 'clear', error: chrome.runtime.lastError.message, requestId: c } })))
                : (console.log(`[WUPE DB] Limpados ${e.length} itens`), window.dispatchEvent(new CustomEvent('WUPE_DB_SUCCESS', { detail: { operation: 'clear', count: e.length, requestId: c } })));
            });
      }
    });
  },
  !1
);
window.addEventListener(
  'exportadados',
  function (a) {
    chrome.storage.local.get(function (b) {
      Object.keys(b).forEach((d) => {
        d.includes('file_') && delete b[d];
      });
      var c = new CustomEvent('recebedados', { detail: { msg: b } });
      this.dispatchEvent(c);
    });
  },
  !1
);
window.addEventListener(
  'PegaTodosFiles',
  function (a) {
    let b = [];
    chrome.storage.local.get(function (c) {
      for (let [d, e] of Object.entries(c)) d.includes('file_') && b.push({ name: d, file: e });
      meutimer = setInterval(function () {
        if (0 < b.length) {
          clearInterval(meutimer);
          var d = new CustomEvent('DevolveTodosFiles', { detail: { msg: b } });
          this.dispatchEvent(d);
        }
      }, 1e3);
    });
  },
  !1
);
window.addEventListener(
  'PegaNoBd',
  function (a) {
    chrome.storage.local.get(a.detail.msg, function (b) {
      b = new CustomEvent('RecebeDoBd', { detail: { msg: b[a.detail.msg] } });
      this.dispatchEvent(b);
    });
  },
  !1
);
var meugrupoatual = chrome.runtime.id;
function injectScript(a, b) {
  try {
    if (!document.getElementById(b)) {
      var c = document.createElement('script');
      c.setAttribute('type', 'text/javascript');
      c.setAttribute('src', 'chrome-extension://' + meugrupoatual + '/' + a);
      c.setAttribute('id', b);
      document.body.appendChild(c);
    }
  } catch (d) {}
}
let inter = window.setInterval(function () {
  document.querySelector('.landing-wrapper')
    ? (clearInterval(inter),
      injectScript('js/public/lib/vendors.min.js', 'vendors-min-js'),
      injectScript('js/public/lib/alertify.min.js', 'alertify-min-js'),
      injectScript('js/public/lib/wonderplug.js', 'wonderplug-js'),
      injectScript('js/public/lib/selectize.min.js', 'selectize-min-js'),
      injectScript('js/public/p.js', 'p-js'),
      (injetado_parcial = !0))
    : injectScript('js/public/pragmaz-modules.js', 'p2-js');
}, 100);
var main = window.main || {};
main.utils = {
  injectScript: function (a, b) {
    if (!document.getElementById(b)) {
      var c = document.createElement('script');
      c.setAttribute('type', 'text/javascript');
      c.setAttribute('src', 'chrome-extension://' + meugrupoatual + '/' + a);
      c.setAttribute('id', b);
      document.body.appendChild(c);
    }
  },
};
main.api = {
  pageScriptsReady: !1,
  objs: {},
  isReady: function () {
    document.querySelector('#pane-side') && (window.clearInterval(main.api.intervalObject), main.api.onReady());
  },
  onReady: function () {
    var a = new Mutex(),
      b = main.api.initPageScripts();
    main.api.objs.whatsApp = new WhatsApp(a, b);
  },
  initPageScripts: function () {
    return (
      (main.api.pageScriptsReady = !1),
      (main.api.objs.majordomo = new Majordomo(window, !0, 'http://localhost:1842', 'http://localhost:1842')),
      main.api.objs.majordomo.setUpListener(function (a) {
        main.api.pageScriptsReady ? main.api.objs.whatsApp.majordomoHandler(a) : main.api.onPageScriptsReady();
      }),
      main.utils.injectScript('js/public/lib/vendors.min.js', 'vendors-min-js'),
      main.utils.injectScript('js/public/lib/alertify.min.js', 'alertify-min-js'),
      main.utils.injectScript('js/public/lib/alertifyjs.init.js', 'alertifyjs-init-js'),
      main.utils.injectScript('js/public/pragmaz-app.js', 'app.js'),
      main.utils.injectScript('js/public/lib/wonderplug.js', 'wonderplug-js'),
      main.utils.injectScript('js/public/lib/ion.rangeSlider.min.js', 'ion-rangeSlider-min-js'),
      main.utils.injectScript('js/public/lib/selectize.min.js', 'selectize-min-js'),
      main.utils.injectScript('js/public/lib/bootstrap-rating.min.js', 'bootstrap-rating-min-js'),
      main.utils.injectScript('js/public/lib/toastr.min.js', 'toastr-min-js'),
      main.utils.injectScript('js/public/lib/jquery.magnific-popup.min.js', 'jquery-magnific-popup-min-js'),
      main.utils.injectScript('js/public/lib/apex.js', 'apex-js'),
      main.utils.injectScript('js/public/lib/apexcharts.min.js', 'apexcharts-min-js'),
      main.utils.injectScript('js/public/lib/xlsx.full.min.js', 'xlsx-full-min-js'),
      main.utils.injectScript('js/public/pragmaz-init.js', 'maj-js'),
      main.utils.injectScript('js/public/lib/bootstrap.bundle.min.js', 'bootstrap-bundle-min-js'),
      main.utils.injectScript('js/public/lib/dropzone.min.js', 'dropzone-min-js'),
      main.utils.injectScript('js/public/lib/form-advanced.init.js', 'form-advanced-init-js'),
      main.utils.injectScript('js/public/lib/sweetalert2.min.js', 'sweetalert2-min-js'),
      main.utils.injectScript('js/public/lib/flatpickr.min.js', 'flatpickr-min-js'),
      main.utils.injectScript('js/public/pragmaz-dropzone.js', 'dapps-js'),
      main.utils.injectScript('js/public/pragmaz-core.js', 'apps-js'),
      main.api.objs.majordomo
    );
  },
  onPageScriptsReady: function () {
    const _keys = Object.keys(minhaDataToda || {});
    console.log('[License] onPageScriptsReady - 存储数据键数:', _keys.length, '，包含 mylicenid:', _keys.some(k => k.includes('mylicenid')));
    main.api.objs.whatsApp.readContacts(minhaDataToda);
  },
};
chrome.runtime && chrome.runtime.onMessage;
main.api.intervalObject = window.setInterval(main.api.isReady, 1);
chrome.runtime.onMessage.addListener(function (a, b, c) {
  'setblack' == a.type ? abreMenuAe() : 'reset' == a.type && abreMenuAe();
});
chrome.runtime.onMessage.addListener(function (a, b, c) {
  'compartilha' == a.type && compartilhAA(a.data, a.tipo);
});
var currentURL = '' + window.location;
chrome.runtime.sendMessage({ BlackOn: 1 }, function (a) {
  a && a.black && 0 < currentURL.indexOf('web.whatsapp.com') && abreMenuAe();
});
function abreMenuAe() {
  var a = new CustomEvent('abremenuaew', { detail: { msg: 'hey', tipo: 'how' } });
  this.dispatchEvent(a);
}
function compartilhAA(a, b) {
  a = new CustomEvent('compartilha', { detail: { msg: a, tipo: b } });
  this.dispatchEvent(a);
}
window.addEventListener('track-event', function (a) {}, !1);
window.addEventListener(
  'logoutallgcontacts',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'logoutallgcontacts' }, function (b) {});
  },
  !1
);
window.addEventListener(
  'salvapersonalia',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'salvapersonalia', id: a.detail.id, data: a.detail.data }, function (b) {});
  },
  !1
);
window.addEventListener(
  'salvapersonalia',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'salvapersonalia', id: a.detail.id, data: a.detail.data }, function (b) {});
  },
  !1
);
window.addEventListener(
  'salvaflow',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'salvaflow', id: a.detail.id, drawflow: a.detail.drawflow, msgsalvas: a.detail.msgsalvas }, function (b) {});
  },
  !1
);
window.addEventListener(
  'limpageral',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'limpageral' }, function (b) {});
  },
  !1
);
window.addEventListener(
  'msg_teste',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'msg_teste', id: a.detail.id, text: a.detail.text, lid: a.detail.lid }, function (b) {
      b = new CustomEvent('recebe_msg_teste', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'pegapersonalia',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'pegapersonalia', id: a.detail.id }, function (b) {
      b = new CustomEvent('recebepersonalia', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'flow',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'flow', id: a.detail.id }, function (b) {
      b = new CustomEvent('recebeflow', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'getuserinfo',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'getuserinfo', interactive: a.detail.interactive }, function (b) {
      b = new CustomEvent('respostauserinfo', { detail: { msg: b?.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'salvacontato',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'salvacontato', number: a.detail.number, name: a.detail.name }, function (b) {});
  },
  !1
);
window.addEventListener(
  'addtomytr',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'addtomytr', ids: a.detail.ids }, function (b) {});
  },
  !1
);
window.addEventListener(
  'transcreve',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'transcreve', b64: a.detail.b64 }, function (b) {
      b = new CustomEvent('respostatranscreve', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'fazupload',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'fazupload', number: a.detail.number, filename: a.detail.filename, type: a.detail.type, file: a.detail.file }, function (b) {
      b = new CustomEvent('respostaupload', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'criawebhook',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'criawebhook', id: a.detail.id, numero: a.detail.numero }, function (b) {
      b = new CustomEvent('respostacriawebhook', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'envialinkagrupador',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'envialinkagrupador', id: a.detail.id, numero: a.detail.numero, linkgrupos: a.detail.linkgrupos }, function (b) {});
  },
  !1
);
window.addEventListener(
  'enviawebhook',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'enviawebhook', url: a.detail.url, body: a.detail.body }, function (b) {});
  },
  !1
);
window.addEventListener(
  'criaagrupador',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'criaagrupador', id: a.detail.id, numero: a.detail.numero }, function (b) {
      b = new CustomEvent('respostacriaGL', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'criasmartrsmwh',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'criasmartrsmwh', id: a.detail.id, numero: a.detail.numero }, function (b) {
      b = new CustomEvent('respostacriaSRWH', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
function grupospublis() {
  var a = chrome.runtime.id;
  0 >= a.indexOf('hhlaibcklk') &&
    0 >= a.indexOf('abebjmbieeeabnc') &&
    0 >= a.indexOf('oglfgkokogbociko') &&
    0 >= a.indexOf('dnkgdlkpbndnjjfdka') &&
    ((a = new CustomEvent('retorna-grupos-publicos', { detail: { msg: 'grupo-lotado' } })), this.dispatchEvent(a));
}
grupospublis();
window.addEventListener(
  'getgrouppublic',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'criawebhookpersonal', id: a.detail.id, numero: a.detail.numero }, function (b) {
      'grupo-lotado' == b.resposta && ((b = new CustomEvent('retorna-grupos-publicos', { detail: { msg: 'grupo-lotado' } })), this.dispatchEvent(b));
    });
  },
  !1
);
window.addEventListener(
  'criawebhookpersonal',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'criawebhookpersonal', id: a.detail.id, numero: a.detail.numero }, function (b) {});
  },
  !1
);
window.addEventListener(
  'salvaparametroswebhookpersonal',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'salvaparametroswebhookpersonal', id: a.detail.id, numero: a.detail.numero, parametros: a.detail.parametros }, function (b) {});
  },
  !1
);
window.addEventListener(
  'criawebhookpersonal2',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'criawebhookpersonal2', id: a.detail.id, numero: a.detail.numero }, function (b) {});
  },
  !1
);
window.addEventListener(
  'salvaparametroswebhookpersonal2',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'salvaparametroswebhookpersonal2', id: a.detail.id, numero: a.detail.numero, parametros: a.detail.parametros, msgsalvas: a.detail.msgsalvas }, function (b) {});
  },
  !1
);
window.addEventListener(
  'deletaagrupador',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'deletaagrupador', id: a.detail.id, numero: a.detail.numero }, function (b) {});
  },
  !1
);
window.addEventListener(
  'deletawebhook',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'deletawebhook', id: a.detail.id }, function (b) {});
  },
  !1
);
window.addEventListener(
  'deletawebhookpersonal',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'deletawebhookpersonal', id: a.detail.id }, function (b) {});
  },
  !1
);
window.addEventListener(
  'deletawebhookpersonal2',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'deletawebhookpersonal2', id: a.detail.id }, function (b) {});
  },
  !1
);
window.addEventListener(
  'pttext',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'pttext', file: a.detail.file }, function (b) {
      b = new CustomEvent('textodoptt', { detail: { response: b } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'enviabotao',
  function (a) {
    chrome.runtime.sendMessage(
      { tipo: 'enviabotao', number: a.detail.number, content: a.detail.content, to: a.detail.to, buttons: a.detail.buttons, filename: a.detail.filename, type: a.detail.type, file: a.detail.file },
      function (b) {}
    );
  },
  !1
);
window.addEventListener(
  'api-grupos-publicos_old',
  function (a) {
    a = chrome.runtime.id;
    0 >= a.indexOf('hhlaibcklk') &&
      0 >= a.indexOf('abebjmbieeeabnc') &&
      0 >= a.indexOf('oglfgkokogbociko') &&
      0 >= a.indexOf('dnkgdlkpbndnjjfdka') &&
      ((a = new CustomEvent('retorna-grupos-publicos', { detail: { msg: 'grupo-lotado' } })), this.dispatchEvent(a));
  },
  !1
);
window.addEventListener(
  'seta-proxy',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'seta-proxy', ip: a.detail.ip }, function (b) {});
  },
  !1
);
window.addEventListener(
  'pega-proxy',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'pega-proxy', lid: a.detail.lid }, function (b) {
      b = new CustomEvent('retorna-proxy', { detail: { meuip: b.ip, online: b.online, pais: b.pais, listaproxy: b.lista } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'voice',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'voice', texto: a.detail.texto, voz: a.detail.voz, time: a.detail.time }, function (b) {
      b = new CustomEvent('retorna-voice', { detail: { msg: b.resposta, time: b.time } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'gli',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'gli', id: a.detail.id, numero: a.detail.numero }, function (b) {
      b = new CustomEvent('retorna-gli', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'gli2',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'gli2', id: a.detail.id, numero: a.detail.numero }, function (b) {
      b = new CustomEvent('retorna-gli2', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'api-grupos-publicos',
  function (a) {
    var b = chrome.runtime.id;
    0 >= b.indexOf('hhlaibcklk') &&
      0 >= b.indexOf('abebjmbieeeabnc') &&
      0 >= b.indexOf('oglfgkokogbociko') &&
      0 >= b.indexOf('dnkgdlkpbndnjjfdka') &&
      ((b = new CustomEvent('retorna-grupos-publicos', { detail: { msg: 'grupo-lotado' } })), this.dispatchEvent(b));
    chrome.runtime.sendMessage({ tipo: 'api-grupos-publicos', groupid: a.detail.groupid }, function (c) {
      c = new CustomEvent('retorna-grupos-publicos', { detail: { msg: c.resposta } });
      this.dispatchEvent(c);
    });
  },
  !1
);
window.addEventListener(
  'api-grupos-publicos-2',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'getgrouppublic' }, function (b) {
      b = new CustomEvent('retorna-grupos-publicos', { detail: { msg: JSON.stringify({ b: b.resposta }) } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'license_ia',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'license', license: a.detail.license }, function (b) {
      console.log('[License] license_ia 收到激活数据:', b && b.resposta ? JSON.parse(b.resposta) : b);
      b = new CustomEvent('recebelicense_ia', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'license',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'license', license: a.detail.license }, function (b) {
      console.log('[License] license 收到激活数据:', b && b.resposta ? JSON.parse(b.resposta) : b);
      b = new CustomEvent('recebelicense', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'licensesalva',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'license', license: a.detail.license }, function (b) {
      console.log('[License] license 收到激活数据:', b && b.resposta ? JSON.parse(b.resposta) : b);
      b = new CustomEvent('recebelicensesalva', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'myipdata',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'myipdata' }, function (b) {
      b = new CustomEvent('recebe-myipdata', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'qrcode-botoes',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'qrcode', number: a.detail.number }, function (b) {
      b = new CustomEvent('recebe-qr-botoes', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'qrcode-webhook',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'qrcode', number: a.detail.number }, function (b) {
      b = new CustomEvent('recebeu-qr-webhook', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'remove-dispositivo',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'remove-dispositivo', number: a.detail.number }, function (b) {});
  },
  !1
);
window.addEventListener(
  'deleta-voz-clonada',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'deleta-voz-clonada', number: a.detail.id, lid: a.detail.lid }, function (b) {});
  },
  !1
);
window.addEventListener(
  'cria-voz-clonada',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'cria-voz-clonada', number: a.detail.id, lid: a.detail.lid, name: a.detail.name, audios: a.detail.audios }, function (b) {
      b = new CustomEvent('recebe-voz-clonada', { detail: { response: b } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'add-dispositivo',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'add-dispositivo', number: a.detail.number, lid: a.detail.lid }, function (b) {
      b = new CustomEvent('recebe-dispositivo', { detail: { msg: b.resposta, number: b.numero, online: b.online } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'verifica-dispositivo',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'busca-dispositivo', number: a.detail.number, lid: a.detail.lid }, function (b) {
      b = new CustomEvent('recebe-verifica-dispositivo', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'qrcode_numeroconectado',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'qrcode_numeroconectado', number: a.detail.number }, function (b) {
      b = new CustomEvent('recebe_qrcode_numeroconectado', { detail: { msg: b.resposta, number: a.detail.number } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'qrcode',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'qrcode', number: a.detail.number }, function (b) {
      b = new CustomEvent('recebeqr', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'linkpreview',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'linkpreview', link: a.detail.link }, function (b) {
      b = new CustomEvent('recebelinkpreview', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'get-group-list',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'api-restaga-grupos', msg: a.detail.msg, dir: a.detail.dir }, function (b) {
      console.log(b);
      b = new CustomEvent('recebe', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'verificawebhookpersonal',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'verificawebhookpersonal', id: a.detail.id }, function (b) {
      b = new CustomEvent('respostawebhookpersonal', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'verificawebhookpersonal2',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'verificawebhookpersonal2', id: a.detail.id }, function (b) {
      b = new CustomEvent('respostawebhookpersonal2', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'verificawebhook',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'verificawebhook', id: a.detail.id }, function (b) {
      b = new CustomEvent('respostawebhook', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
window.addEventListener(
  'get-group-list-total',
  function (a) {
    chrome.runtime.sendMessage({ tipo: 'api-resgata-todos-grupos', msg: a.detail.msg }, function (b) {
      b = new CustomEvent('recebe2', { detail: { msg: b.resposta } });
      this.dispatchEvent(b);
    });
  },
  !1
);
