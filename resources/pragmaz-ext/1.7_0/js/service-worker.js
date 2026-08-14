var main = {};

// ==============================
// PROXY SYSTEM
// ==============================

var localStorage = [];

var auth_now = function (details, callbackFn) {
  if (details.isProxy && localStorage['proxy']) {
    console.log('callbackFn: ' + localStorage['proxy']);
    callbackFn({
      authCredentials: {
        username: 'brd-customer-hl_c2a52987-zone-data_center-ip-' + localStorage['proxy'],
        password: 'xo5ofp3byw6r',
      },
    });
  }
};

chrome.storage.local.get('proxy', function (retorno) {
  if (retorno['proxy']) {
    localStorage['proxy'] = retorno['proxy'];
    if (!chrome.webRequest.onAuthRequired.hasListener(auth_now)) {
      chrome.webRequest.onAuthRequired.addListener(auth_now, { urls: ['<all_urls>'] }, ['asyncBlocking']);
      console.log('=> Adicionei: onAuthRequired.addListener');
    }
  }
});

// ==============================
// UTILITY FUNCTIONS
// ==============================

Array.prototype.forEachAsyncParallel = async function (fn) {
  await Promise.all(this.map(fn));
};

function toDataUrl(e, t) {
  fetch(e)
    .then((response) => response.blob())
    .then(function (myBlob) {
      var f = new FileReader();
      f.onloadend = function () {
        t(f.result);
      };
      f.readAsDataURL(myBlob);
    });
}

getWhatsAppTab = function (callback) {
  chrome.tabs.query(
    {
      currentWindow: true,
      url: 'https://web.whatsapp.com/*',
    },
    function (tabs) {
      if (tabs.length === 0) {
        chrome.tabs.create({ url: 'https://web.whatsapp.com/' }, callback);
      } else {
        chrome.tabs.update(tabs[0].id, { selected: true }, callback);
      }
    }
  );
};

// ==============================
// LANGUAGE SETUP
// ==============================

var lng = 'en';
var linguas = [];

function setlng() {
  var lang = navigator.language.split(/[^a-z]/)[0].toLowerCase();
  if (lang === 'en' || lang === 'fr' || lang === 'es' || lang === 'pt') {
    return lang;
  }
  return 'en';
}

lng = setlng();

linguas['share_site'] = {
  en: '在WhatsApp上分享网站',
  fr: 'Partager le site Web sur Whatsapp',
  es: 'Compartir sitio web en Whatsapp',
  pt: 'Compartilhar site no Whatsapp',
};
linguas['share_text'] = {
  en: '在WhatsApp上分享文本',
  fr: 'Partager du texte sur WhatsApp',
  es: 'Compartir texto en whatsapp',
  pt: 'Compartilhar texto no Whatsapp',
};
linguas['share_link'] = {
  en: '在WhatsApp上分享链接',
  fr: 'Partager le lien sur WhatsApp',
  es: 'Compartir enlace en whatsapp',
  pt: 'Compartilhar link no Whatsapp',
};
linguas['share_image'] = {
  en: '在WhatsApp上分享图片',
  fr: "Partager l'image sur WhatsApp",
  es: 'Compartir imagen en whatsapp',
  pt: 'Compartilhar imagem no Whatsapp',
};
linguas['share_sticker'] = {
  en: '将图片作为贴纸分享到WhatsApp',
  fr: "Partager l'image sous forme d'autocollant sur WhatsApp",
  es: 'Compartir imagen como pegatina en whatsapp',
  pt: 'Compartilhar imagem como figurinha no Whatsapp',
};

// ==============================
// MESSAGE HANDLERS
// ==============================

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.tipo == 'seta-proxy') {
    if (request.ip == 'reset') {
      if (localStorage['proxy']) {
        chrome.storage.local.remove('proxy');
        localStorage['proxy'] = undefined;
        chrome.proxy.settings.clear({ scope: 'regular' });
        chrome.webRequest.onAuthRequired.removeListener(auth_now);

        setTimeout(() => {
          chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, function (e) {
            if (e && e.length > 0) for (var o = 0; o < e.length; ++o) chrome.tabs.remove(e[o].id);
          });
          chrome.tabs.create({ url: 'http://web.whatsapp.com/' }, function (e) {});
        }, 500);
      }
    } else {
      localStorage['proxy'] = request.ip;
      if (!chrome.webRequest.onAuthRequired.hasListener(auth_now)) chrome.webRequest.onAuthRequired.addListener(auth_now, { urls: ['<all_urls>'] }, ['asyncBlocking']);

      var config = {
        mode: 'pac_script',
        pacScript: {
          data: `function FindProxyForURL(url, host) {
                        if (shExpMatch(url, "wss://web.whatsapp.com/*")||localHostOrDomainIs(host, "web.whatsapp.com")||localHostOrDomainIs(host, "lumtest.com")) {
                            return "PROXY session-${Math.floor(Math.random() * Math.pow(10, 20))}.zproxy.lum-superproxy.io:22225;";
                        } else {
                            return "DIRECT";
                        }
                    }`,
          mandatory: true,
        },
      };

      chrome.proxy.settings.set({ value: config, scope: 'regular' }, function () {});
      chrome.storage.local.set({ ['proxy']: request.ip });

      setTimeout(() => {
        chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, function (e) {
          if (e && e.length > 0) for (var o = 0; o < e.length; ++o) chrome.tabs.remove(e[o].id);
        });
        chrome.tabs.create({ url: 'http://web.whatsapp.com/' }, function (e) {});
      }, 500);
    }

    return;
  }

  if (request.tipo == 'pega-proxy') {
    var linkcomcategoria = 'https://pragmaz.ai/proxys/';
    fetch(linkcomcategoria, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ lid: request.lid }),
    })
      .then((res) => res.text())
      .then((jsonarray) => {
        let novo = JSON.parse(jsonarray);
        sendResponse({ ip: novo.ip, online: localStorage['proxy'] ? true : false, pais: novo.pais, lista: novo.lista });
      });
    return true;
  }

  if (request.tipo == 'limpageral') {
    chrome.browsingData.remove(
      {
        origins: ['https://web.whatsapp.com'],
      },
      {
        cacheStorage: true,
        cookies: true,
        fileSystems: true,
        indexedDB: true,
        localStorage: true,
        serviceWorkers: true,
        webSQL: true,
      },
      function () {
        setTimeout(() => {
          chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, function (e) {
            if (e && e.length > 0) for (var o = 0; o < e.length; ++o) chrome.tabs.remove(e[o].id);
          });
          chrome.tabs.create({ url: 'http://web.whatsapp.com/' }, function (e) {});
        }, 500);
      }
    );
  }

  if (request.tipo == 'limpaCacheAtual') {
    console.log('[!] Limpando cache do WhatsApp Web...');
    chrome.browsingData.remove(
      {
        origins: ['https://web.whatsapp.com'],
      },
      {
        cacheStorage: true,
        cookies: false,
        fileSystems: false,
        indexedDB: false,
        localStorage: false,
        serviceWorkers: true,
        webSQL: false,
      },
      function () {
        setTimeout(() => {
          chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, function (e) {
            if (e && e.length > 0) for (var o = 0; o < e.length; ++o) chrome.tabs.remove(e[o].id);
          });
          chrome.tabs.create({ url: 'http://web.whatsapp.com/' }, function (e) {});
        }, 500);
      }
    );
    return true;
  }

  // if (request.tipo == "logoutallgcontacts") {
  //     chrome.identity.getAuthToken({ interactive: false }, function (token) {
  //         let fetch_url = `https://accounts.google.com/o/oauth2/revoke?token=${token}`;
  //         let fetch_options = { headers: { 'Authorization': `Bearer ${token}` } };
  //         fetch(fetch_url, fetch_options)
  //             .then(res => res.json())
  //             .then(res => {
  //                 chrome.identity.clearAllCachedAuthTokens((res) => {
  //                     console.log('>> logout all auth tokens');
  //                 });
  //             });
  //     });
  //     return true;
  // }

  // if (request.tipo == "getuserinfo") {
  //     chrome.identity.getAuthToken({ interactive: request.interactive }, function (token) {
  //         let fetch_url = `https://www.googleapis.com/oauth2/v3/userinfo`;
  //         let fetch_options = { headers: { 'Authorization': `Bearer ${token}` } };
  //         fetch(fetch_url, fetch_options)
  //             .then(res => res.json())
  //             .then(res => {
  //                 sendResponse({ resposta: JSON.stringify(res) });
  //             });
  //     });
  //     return true;
  // }

  // if (request.tipo == "salvacontato") {
  //     chrome.identity.getAuthToken({ interactive: true }, function (token) {
  //         let fetch_url = `https://people.googleapis.com/v1/people:createContact?key=AIzaSyD9ws3StPQWHim2FQ6COYU2octnE_OF-oU`;
  //         let fetch_options = {
  //             method: 'POST',
  //             headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  //             body: JSON.stringify({
  //                 'names': [{ "givenName": request.name }],
  //                 'phoneNumbers': [{ "value": request.number }]
  //             })
  //         };
  //         fetch(fetch_url, fetch_options)
  //             .then(res => res.json())
  //             .then(res => { sendResponse({ resposta: res }); });
  //     });
  //     return true;
  // }

  if (request.tipo == 'myipdata') {
    fetch('http://lumtest.com/myip.json')
      .then((res) => res.text())
      .then((jsonarray) => {
        sendResponse({ resposta: jsonarray });
      });
    return true;
  }

  if (request.tipo == 'remove-dispositivo') {
    fetch('https://pragmaz.ai/s_desconecta/' + request.number)
      .then((res) => res.text())
      .then((jsonarray) => {});
    return true;
  }

  if (request.tipo == 'add-dispositivo') {
    fetch('https://pragmaz.ai/s_conecta/' + request.number + '?lid=' + request.lid)
      .then((res) => res.text())
      .then((jsonarray) => {
        var obj2 = JSON.parse(jsonarray);
        sendResponse({ resposta: obj2.qr, numero: obj2.number ? obj2.number : '', online: obj2.online });
      });
    return true;
  }

  if (request.tipo == 'busca-dispositivo') {
    fetch('https://pragmaz.ai/s_conecta/' + request.number + '?lid=' + request.lid)
      .then((res) => res.text())
      .then((jsonarray) => {
        var obj2 = JSON.parse(jsonarray);
        sendResponse({ resposta: obj2 });
      });
    return true;
  }

  if (request.tipo == 'qrcode_numeroconectado' || request.tipo == 'qrcode') {
    fetch('https://pragmaz.ai/loginb/' + request.number)
      .then((res) => res.text())
      .then((jsonarray) => {
        var obj2 = JSON.parse(jsonarray);
        sendResponse({ resposta: obj2.qr });
      });
    return true;
  }

  if (request.tipo == 'voice') {
    fetch('https://pragmaz.ai/voice/', {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto: request.texto, voz: request.voz }),
    })
      .then((res) => res.text())
      .then((jsonarray) => {
        sendResponse({ resposta: jsonarray, time: request.time });
      });
    return true;
  }

  if (request.tipo == 'gli') {
    fetch('https://pragmaz.ai/gli/' + request.id, {
      method: 'PUT',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ cellphone: request.numero }),
    })
      .then((res) => res.text())
      .then((jsonarray) => {
        sendResponse({ resposta: jsonarray });
      });
    return true;
  }

  if (request.tipo == 'gli2') {
    fetch('https://pragmaz.ai/wri/' + request.id, {
      method: 'PUT',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ cellphone: request.numero }),
    })
      .then((res) => res.text())
      .then((jsonarray) => {
        sendResponse({ resposta: jsonarray });
      });
    return true;
  }

  if (request.tipo == 'api-grupos-publicos') {
    const jsonarray = JSON.stringify({"b":"off"});
    sendResponse({ resposta: jsonarray });
    return true;
  }

  if (request.tipo == 'license') {
    const localLicense = JSON.stringify({
      s_status: 'active',
      lid: '1TFANMJ2nxnn0MuvtmpuKzbB',
      email: 'admin@helloword.com.cn',
      first_name: 'Hello',
      last_name: 'World',
      users: ['85284807520'],
      plan_id: 8,
      plan_name: 'Intermediário',
      support_number: '85284807520',
      cancelado: '',
      skip_phone_check: true,
    });
    sendResponse({ resposta: localLicense });
    return true;
  }

  if (request.tipo == 'deleta-voz-clonada') {
    fetch('https://pragmaz.ai/s_deletavoz/' + request.number, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ lid: request.lid }),
    })
      .then((res) => res.json())
      .then((json) => {});
    return true;
  }

  if (request.tipo == 'cria-voz-clonada') {
    fetch('https://pragmaz.ai/s_criavoz/' + request.number, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ lid: request.lid, name: request.name, audios: request.audios }),
    })
      .then((res) => res.json())
      .then((json) => {
        sendResponse({ json });
      });
    return true;
  }

  if (request.tipo == 'linkpreview') {
    fetch('https://pragmaz.ai/preview/' + request.link)
      .then((res) => res.text())
      .then((jsonarray) => {
        sendResponse({ resposta: jsonarray });
      });
    return true;
  }

  if (request.tipo == 'licensesalva') {
    const localLicense = JSON.stringify({
      s_status: 'active',
      lid: '1TFANMJ2nxnn0MuvtmpuKzbB',
      email: 'admin@helloword.com.cn',
      first_name: 'Hello',
      last_name: 'World',
      users: ['85284807520'],
      plan_id: 8,
      plan_name: 'Intermediário',
      support_number: '85284807520',
      cancelado: '',
      skip_phone_check: true,
    });
    sendResponse({ resposta: localLicense });
    return true;
  }

  if (request.tipo == 'api-restaga-grupos') {
    var linkcomcategoria = 'https://pragmaz.ai/public-groups?&c=' + request.msg + '&d=' + request.dir;
    fetch(linkcomcategoria)
      .then((res) => res.text())
      .then((jsonarray) => {
        sendResponse({ resposta: jsonarray });
      });
    return true;
  }

  if (request.tipo == 'api-resgata-todos-grupos') {
    fetch('https://pragmaz.ai/grupos-total/?c=' + request.msg)
      .then((res) => res.text())
      .then((jsonarray) => {
        sendResponse({ resposta: jsonarray });
      });
    return true;
  }

  if (request.tipo == 'enviawebhook') {
    fetch(request.url, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: request.body,
    })
      .then((res) => res.text())
      .then((jsonarray) => {
        sendResponse({ resposta: jsonarray });
      });
    return true;
  }

  if (request.tipo == 'criaagrupador') {
    fetch('https://pragmaz.ai/gl/' + request.id, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ cellphone: request.numero }),
    })
      .then((res) => res.text())
      .then((jsonarray) => {
        sendResponse({ resposta: jsonarray });
      });
    return true;
  }

  if (request.tipo == 'criasmartrsmwh') {
    fetch('https://pragmaz.ai/smart-wh/' + request.id, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ cellphone: request.numero }),
    })
      .then((res) => res.text())
      .then((jsonarray) => {
        sendResponse({ resposta: jsonarray });
      });
    return true;
  }

  if (request.tipo == 'envialinkagrupador') {
    fetch('https://pragmaz.ai/gl/' + request.id, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ cellphone: request.numero, linkgrupos: request.linkgrupos }),
    });
    return true;
  }

  if (request.tipo == 'flow') {
    fetch('https://pragmaz.ai/s_flow/' + request.id)
      .then((res) => res.text())
      .then((jsonarray) => {
        sendResponse({ resposta: jsonarray });
      });
    return true;
  }

  if (request.tipo == 'pegapersonalia') {
    fetch('https://pragmaz.ai/s_personal/' + request.id)
      .then((res) => res.text())
      .then((jsonarray) => {
        sendResponse({ resposta: jsonarray });
      });
    return true;
  }

  if (request.tipo == 'salvapersonalia') {
    fetch('https://pragmaz.ai/s_personal/' + request.id, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: request.data }),
    })
      .then((res) => res.text())
      .then((jsonarray) => {});
    return true;
  }

  if (request.tipo == 'salvaflow') {
    fetch('https://pragmaz.ai/s_flow/' + request.id, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ drawflow: request.drawflow, msgsalvas: request.msgsalvas }),
    })
      .then((res) => res.text())
      .then((jsonarray) => {});
    return true;
  }

  if (request.tipo == 'msg_teste') {
    fetch('https://pragmaz.ai/s_pergunta/' + request.id + '?lid=' + request.lid, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: request.text }),
    })
      .then((res) => res.text())
      .then((jsonarray) => {
        sendResponse({ resposta: jsonarray });
      });
    return true;
  }

  if (request.tipo == 'transcreve') {
    fetch('https://pragmaz.ai/transcaudio.png', {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ b64: request.b64 }),
    })
      .then((res) => res.text())
      .then((jsonarray) => {
        sendResponse({ resposta: jsonarray });
      });
    return true;
  }

  if (request.tipo == 'fazupload') {
    fetch('https://pragmaz.ai/upload-files-wup/', {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: request.number, filename: request.filename, type: request.type, file: request.file }),
    })
      .then((res) => res.text())
      .then((jsonarray) => {
        sendResponse({ resposta: jsonarray });
      });
    return true;
  }

  if (request.tipo == 'criawebhook') {
    fetch('https://pragmaz.ai/webhook/' + request.id, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ cellphone: request.numero }),
    })
      .then((res) => res.text())
      .then((jsonarray) => {
        sendResponse({ resposta: jsonarray });
      });
    return true;
  }

  if (request.tipo == 'salvaparametroswebhookpersonal') {
    fetch('https://pragmaz.ai/smart-webhook/' + request.id, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ cellphone: request.numero, parametros: request.parametros }),
    });
    return true;
  }

  if (request.tipo == 'criawebhookpersonal') {
    fetch('https://pragmaz.ai/smart-webhook/' + request.id, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ cellphone: request.numero }),
    });
    return true;
  }

  if (request.tipo == 'salvaparametroswebhookpersonal2') {
    fetch('https://pragmaz.ai/smart-wh/' + request.id, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ cellphone: request.numero, parametros: request.parametros, msgsalvas: request.msgsalvas }),
    });
    return true;
  }

  if (request.tipo == 'criawebhookpersonal2') {
    fetch('https://pragmaz.ai/smart-wh/' + request.id, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ cellphone: request.numero }),
    });
    return true;
  }

  if (request.tipo == 'deletawebhookpersonal2') {
    fetch('https://pragmaz.ai/smart-wh/' + request.id, {
      method: 'DELETE',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
    });
    return true;
  }

  if (request.tipo == 'getgrouppublic') {
    chrome.management.getSelf(function (extensionInfo) {
      if (extensionInfo.installType !== 'normal') {
        sendResponse({ resposta: 'grupo-lotado1' });
      }
    });
    return true;
  }

  if (request.tipo == 'pttext') {
    fetch('https://pragmaz.ai/ppttext/', {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ptt: request.file }),
    })
      .then((res) => res.text())
      .then((text) => {
        sendResponse({ resposta: text });
      });
    return true;
  }

  if (request.tipo == 'enviabotao') {
    fetch('https://pragmaz.ai/enviabotao/' + request.number, {
      method: 'POST',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        number: request.number,
        content: request.content,
        to: request.to,
        buttons: request.buttons,
        filename: request.filename,
        type: request.type,
        file: request.file,
        img: request.img,
      }),
    });
    return true;
  }

  if (request.tipo == 'deletawebhookpersonal') {
    fetch('https://pragmaz.ai/smart-webhook/' + request.id, {
      method: 'DELETE',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
    });
    return true;
  }

  if (request.tipo == 'deletaagrupador') {
    fetch('https://pragmaz.ai/groupslink/' + request.id, {
      method: 'DELETE',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ cellphone: request.numero }),
    });
    return true;
  }

  if (request.tipo == 'deletawebhook') {
    fetch('https://pragmaz.ai/webhook/' + request.id, {
      method: 'DELETE',
      headers: { Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json' },
    });
    return true;
  }

  if (request.tipo == 'verificawebhook') {
    fetch('https://pragmaz.ai/webhook/' + request.id)
      .then((res) => res.text())
      .then((jsonarray) => {
        var obj2 = JSON.parse(jsonarray);
        if (obj2.newmsg !== 'off') {
          if (obj2.action && obj2.type && obj2.content && obj2.phone && obj2.cellphone) {
            sendResponse({ resposta: jsonarray });
          }
        } else {
          sendResponse({ resposta: 'off' });
        }
      });
    return true;
  }

  if (request.tipo == 'verificawebhookpersonal') {
    fetch('https://pragmaz.ai/smart-webhook/' + request.id)
      .then((res) => res.text())
      .then((jsonarray) => {
        var obj2 = JSON.parse(jsonarray);
        if (obj2.newmsg !== 'off') {
          if (obj2.content && obj2.cellphone) {
            sendResponse({ resposta: jsonarray });
          }
        } else {
          sendResponse({ resposta: 'off' });
        }
      });
    return true;
  }

  if (request.tipo == 'verificawebhookpersonal2') {
    fetch('https://pragmaz.ai/smart-wh/' + request.id)
      .then((res) => res.text())
      .then((jsonarray) => {
        var obj2 = JSON.parse(jsonarray);
        if (obj2.newmsg !== 'off') {
          if (obj2.content && obj2.cellphone) {
            sendResponse({ resposta: jsonarray });
          }
        } else {
          sendResponse({ resposta: 'off' });
        }
      });
    return true;
  }

  if (request.tipo == 'enviaIMG') {
    getWhatsAppTab(function (whatsTab) {
      toDataUrl(request.msg, function (myBase64) {
        chrome.tabs.sendMessage(whatsTab.id, { type: 'compartilha', tipo: 'image', data: myBase64 });
      });
    });
    return true;
  }
});

// ==============================
// ACTION BUTTON
// ==============================

chrome.action.onClicked.addListener(function (e) {
  var o = { url: '*://web.whatsapp.com/*' };
  chrome.tabs.query(o, function (o) {
    if (o && o.length > 0) {
      for (var t = 0; t < o.length; ++t) (chrome.tabs.sendMessage(o[t].id, { type: 'setblack' }), chrome.tabs.update(o[t].id, { selected: true }));
    } else {
      chrome.tabs.create({ url: 'https://web.whatsapp.com' });
    }
  });
});

// ==============================
// CONTEXT MENUS & INSTALL
// ==============================

chrome.runtime.onInstalled.addListener(async function (e) {
  chrome.contextMenus &&
    (chrome.contextMenus.create({ title: linguas['share_site'][lng], contexts: ['page'], id: 'page' }, () => chrome.runtime.lastError),
    chrome.contextMenus.create({ title: linguas['share_text'][lng], contexts: ['selection'], id: 'selection' }, () => chrome.runtime.lastError),
    chrome.contextMenus.create({ title: linguas['share_link'][lng], contexts: ['link'], id: 'link' }, () => chrome.runtime.lastError),
    chrome.contextMenus.create({ title: linguas['share_image'][lng], contexts: ['image'], id: 'image' }, () => chrome.runtime.lastError),
    chrome.contextMenus.create({ title: linguas['share_sticker'][lng], contexts: ['image'], id: 'stick' }, () => chrome.runtime.lastError),
    chrome.contextMenus.create({ title: 'Limpar cache WhatsApp Web', documentUrlPatterns: ['https://web.whatsapp.com/*'], id: 'limpageral' }, () => chrome.runtime.lastError));

  // On install: open WhatsApp Web and clear cache
  chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, function (existingTabs) {
    if (existingTabs && existingTabs.length > 0) {
      for (var i = 0; i < existingTabs.length; i++) {
        chrome.tabs.remove(existingTabs[i].id);
      }
    }
  });

  chrome.tabs.create({ url: 'http://web.whatsapp.com/' }, function (newTab) {
    chrome.browsingData.remove(
      {
        origins: ['https://web.whatsapp.com'],
      },
      {
        cacheStorage: true,
        cookies: false,
        fileSystems: false,
        indexedDB: false,
        localStorage: false,
        serviceWorkers: true,
        webSQL: false,
      },
      function () {
        chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, function (activeTabs) {
          if (activeTabs && activeTabs.length > 0) {
            for (var j = 0; j < activeTabs.length; j++) {
              chrome.tabs.reload(activeTabs[j].id, { bypassCache: true });
            }
          }
        });
      }
    );
  });
});

// ==============================
// CONTEXT MENU HANDLERS
// ==============================

main.context = {
  clickHandlerGeneric: function (type, content, trackingInfo) {
    getWhatsAppTab(function (whatsTab) {
      if (trackingInfo === 'image' || trackingInfo === 'sticker') {
        toDataUrl(content, function (myBase64) {
          chrome.tabs.sendMessage(whatsTab.id, { type: 'compartilha', tipo: trackingInfo, data: myBase64 });
        });
      } else {
        chrome.tabs.sendMessage(whatsTab.id, { type: 'compartilha', tipo: trackingInfo, data: content });
      }
    });
  },
  clickHandlerGeneric2: function () {
    chrome.browsingData.remove(
      {
        origins: ['https://web.whatsapp.com'],
      },
      {
        cacheStorage: true,
        cookies: true,
        fileSystems: true,
        indexedDB: true,
        localStorage: true,
        serviceWorkers: true,
        webSQL: true,
      },
      function () {
        setTimeout(() => {
          chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, function (e) {
            if (e && e.length > 0) for (var o = 0; o < e.length; ++o) chrome.tabs.remove(e[o].id);
          });
          chrome.tabs.create({ url: 'http://web.whatsapp.com/' }, function (e) {
            chrome.tabs.query({ url: '*://web.whatsapp.com/*' }, function (x) {
              if (x && x.length > 0)
                for (var o = 0; o < x.length; ++o) {
                  chrome.tabs.reload(x[o].id, { bypassCache: true });
                }
            });
          });
        }, 500);
      }
    );
  },
};
