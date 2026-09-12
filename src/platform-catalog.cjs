'use strict';

const LINE_EXTENSION_ID = 'ophjlpahpchlmihnnnihgmmeilfjmjjc';
const LINE_EXTENSION_URL = `chrome-extension://${LINE_EXTENSION_ID}/index.html`;
const WA_LOCAL_PORT = 1843;
const WA_LOCAL_ORIGIN = `http://127.0.0.1:${WA_LOCAL_PORT}`;
const WA_LOCAL_URL = `${WA_LOCAL_ORIGIN}/`;
const WA_WEB_URL = 'https://web.whatsapp.com/';

function freezeConfig(value) {
  const config = { ...value };
  if (Array.isArray(config.hostnames)) config.hostnames = Object.freeze([...config.hostnames]);
  return Object.freeze(config);
}

const PLATFORM_CATALOG = Object.freeze({
  whatsapp: freezeConfig({
    name: 'WhatsApp',
    short: 'WA',
    url: WA_WEB_URL,
    navigationKind: 'whatsapp',
    hostnames: ['web.whatsapp.com'],
    allowSuffix: '.whatsapp.com',
    localOrigin: WA_LOCAL_ORIGIN,
  }),
  'whatsapp-pure': freezeConfig({
    name: 'WhatsApp 纯净版',
    short: 'WAP',
    url: WA_WEB_URL,
    navigationKind: 'whatsapp',
    hostnames: ['web.whatsapp.com'],
    allowSuffix: '.whatsapp.com',
    localOrigin: WA_LOCAL_ORIGIN,
  }),
  'telegram-z': freezeConfig({
    name: 'TelegramZ',
    short: 'TGZ',
    url: 'https://web.telegram.org/a',
    navigationKind: 'telegram',
    hostnames: ['web.telegram.org'],
    allowSuffix: '.telegram.org',
  }),
  'telegram-k': freezeConfig({
    name: 'TelegramK',
    short: 'TGK',
    url: 'https://web.telegram.org/k/',
    navigationKind: 'telegram',
    hostnames: ['web.telegram.org'],
    allowSuffix: '.telegram.org',
  }),
  line: freezeConfig({
    name: 'Line',
    short: 'LN',
    url: LINE_EXTENSION_URL,
    navigationKind: 'line',
    hostnames: ['access.line.me', 'line.me'],
    allowSuffix: '.line.me',
    extensionId: LINE_EXTENSION_ID,
    needsExtension: true,
  }),
  'line-business': freezeConfig({
    name: 'Line 商业版',
    short: 'LNB',
    url: 'https://manager.line.biz/',
    navigationKind: 'line',
    hostnames: ['manager.line.biz', 'access.line.me', 'line.me'],
    allowSuffix: '.line.me',
    extensionId: LINE_EXTENSION_ID,
    needsExtension: true,
  }),
  website: freezeConfig({
    name: '自定义网站',
    short: 'WEB',
    navigationKind: 'website',
  }),
});

function platformConfig(type) {
  return PLATFORM_CATALOG[String(type || '')] || null;
}

module.exports = {
  LINE_EXTENSION_ID,
  LINE_EXTENSION_URL,
  WA_LOCAL_PORT,
  WA_LOCAL_ORIGIN,
  WA_LOCAL_URL,
  WA_WEB_URL,
  PLATFORM_CATALOG,
  platformConfig,
};
