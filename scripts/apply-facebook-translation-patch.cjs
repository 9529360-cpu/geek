'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function write(rel, text) {
  fs.writeFileSync(path.join(root, rel), text, 'utf8');
}

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);
  if (first < 0) throw new Error(`找不到补丁锚点: ${label}`);
  if (source.indexOf(from, first + from.length) >= 0) throw new Error(`补丁锚点不唯一: ${label}`);
  return source.slice(0, first) + to + source.slice(first + from.length);
}

function replaceRegexOnce(source, regex, replacement, label) {
  const flags = regex.flags.replace('g', '');
  const probe = new RegExp(regex.source, flags);
  if (!probe.test(source)) throw new Error(`找不到正则补丁锚点: ${label}`);
  const next = source.replace(new RegExp(regex.source, flags), replacement);
  if (next === source) throw new Error(`正则补丁未生效: ${label}`);
  return next;
}

// ---------- src/main.cjs ----------
let main = read('src/main.cjs');

const lineBusinessBlock = [
  "  'line-business': {",
  "    name: 'Line 商业版',",
  "    short: 'LNB',",
  "    url: 'https://manager.line.biz/',",
  "    hostnames: ['manager.line.biz', 'access.line.me', 'line.me'],",
  "    allowSuffix: '.line.me',",
  "    needsExtension: true",
  "  }",
  "};"
].join('\n');
const lineBusinessWithFacebook = [
  "  'line-business': {",
  "    name: 'Line 商业版',",
  "    short: 'LNB',",
  "    url: 'https://manager.line.biz/',",
  "    hostnames: ['manager.line.biz', 'access.line.me', 'line.me'],",
  "    allowSuffix: '.line.me',",
  "    needsExtension: true",
  "  },",
  "  facebook: {",
  "    name: 'Facebook',",
  "    short: 'FB',",
  "    url: 'https://www.facebook.com/messages/',",
  "    hostnames: ['www.facebook.com', 'm.facebook.com', 'facebook.com', 'www.messenger.com', 'messenger.com'],",
  "    allowSuffix: '.facebook.com'",
  "  },",
  "  'facebook-business': {",
  "    name: 'Facebook 商业版',",
  "    short: 'FBB',",
  "    url: 'https://business.facebook.com/latest/inbox/all',",
  "    hostnames: ['business.facebook.com', 'www.facebook.com', 'facebook.com'],",
  "    allowSuffix: '.facebook.com'",
  "  }",
  "};"
].join('\n');
main = replaceOnce(main, lineBusinessBlock, lineBusinessWithFacebook, 'APP_TYPES Facebook');

const registerOld = [
  "    const isTelegram = ['telegram-z', 'telegram', 'telegram-pure', 'telegram-k'].includes(account?.type);",
  "    const isLine = account?.type === 'line' || account?.type === 'line-business';",
  "    const allowedPage = (isTelegram && /^https:\\/\\/web\\.telegram\\.org\\//.test(guestUrl))",
  "      || (isLine && /^chrome-extension:\\/\\/ophjlpahpchlmihnnnihgmmeilfjmjjc\\//.test(guestUrl));"
].join('\n');
const registerNew = [
  "    const isTelegram = ['telegram-z', 'telegram', 'telegram-pure', 'telegram-k'].includes(account?.type);",
  "    const isLine = account?.type === 'line' || account?.type === 'line-business';",
  "    const isFacebook = account?.type === 'facebook' || account?.type === 'facebook-business';",
  "    const allowedPage = (isTelegram && /^https:\\/\\/web\\.telegram\\.org\\//.test(guestUrl))",
  "      || (isLine && /^chrome-extension:\\/\\/ophjlpahpchlmihnnnihgmmeilfjmjjc\\//.test(guestUrl))",
  "      || (isFacebook && /^https:\\/\\/(?:[^/]+\\.)?(?:facebook\\.com|messenger\\.com)\\//.test(guestUrl));"
].join('\n');
main = replaceOnce(main, registerOld, registerNew, 'Facebook WebView register');

const allowedInputOld = "    const allowedInputPage = /^https:\\/\\/web\\.telegram\\.org\\//.test(guestUrl) || /^chrome-extension:\\/\\/ophjlpahpchlmihnnnihgmmeilfjmjjc\\//.test(guestUrl);";
const allowedInputNew = "    const allowedInputPage = /^https:\\/\\/web\\.telegram\\.org\\//.test(guestUrl) || /^chrome-extension:\\/\\/ophjlpahpchlmihnnnihgmmeilfjmjjc\\//.test(guestUrl) || /^https:\\/\\/(?:[^/]+\\.)?(?:facebook\\.com|messenger\\.com)\\//.test(guestUrl);";
main = replaceOnce(main, allowedInputOld, allowedInputNew, 'Facebook native input page allowlist');

const lineFocusTail = [
  "      if (/^chrome-extension:\\\\/\\\\/ophjlpahpchlmihnnnihgmmeilfjmjjc\\\\//.test(location.href)) {",
  "        const host = document.querySelector('textarea-ex[class*=\"chatroomEditor-module__textarea__\"]');",
  "        const textarea = host?.shadowRoot?.querySelector('textarea');",
  "        return /#\\\\/chats\\\\/[^/?#]+/.test(location.hash) && !!textarea && (document.activeElement === host || host.shadowRoot?.activeElement === textarea);",
  "      }",
  "      return false;"
].join('\n');
const facebookFocusTail = [
  "      if (/^chrome-extension:\\\\/\\\\/ophjlpahpchlmihnnnihgmmeilfjmjjc\\\\//.test(location.href)) {",
  "        const host = document.querySelector('textarea-ex[class*=\"chatroomEditor-module__textarea__\"]');",
  "        const textarea = host?.shadowRoot?.querySelector('textarea');",
  "        return /#\\\\/chats\\\\/[^/?#]+/.test(location.hash) && !!textarea && (document.activeElement === host || host.shadowRoot?.activeElement === textarea);",
  "      }",
  "      if (/^https:\\\\/\\\\/(?:[^/]+\\\\.)?(?:facebook\\\\.com|messenger\\\\.com)\\\\//.test(location.href)) {",
  "        const selector = '[contenteditable=\"true\"][role=\"textbox\"],[contenteditable=\"true\"][data-lexical-editor=\"true\"],textarea[aria-label],textarea[placeholder]';",
  "        const active = document.activeElement;",
  "        const editor = active?.closest?.(selector) || [...document.querySelectorAll(selector)].find(node => node === active || node.contains(active));",
  "        if (!editor) return false;",
  "        const label = [editor.getAttribute('aria-label'), editor.getAttribute('placeholder'), editor.getAttribute('data-placeholder')].filter(Boolean).join(' ');",
  "        if (/search|搜索|搜尋|buscar|rechercher|cerca|suche|поиск|评论|評論|comment/i.test(label)) return false;",
  "        const rect = editor.getBoundingClientRect();",
  "        return rect.width > 120 && rect.height > 16 && rect.bottom > innerHeight * 0.45 && (document.activeElement === editor || editor.contains(document.activeElement));",
  "      }",
  "      return false;"
].join('\n');
main = replaceOnce(main, lineFocusTail, facebookFocusTail, 'Facebook focused composer');
main = main.replace('// Ordinary Chrome UA so WhatsApp/Telegram Web don\'t reject the embedded browser.', '// Ordinary Chrome UA so WhatsApp/Telegram/Facebook Web do not reject the embedded browser.');
write('src/main.cjs', main);

// ---------- ui/translation-core.js ----------
let core = read('ui/translation-core.js');
const coreOld = "    telegram: new Set(['telegram', 'telegram-z', 'telegram-pure', 'telegram-k']),\n    line: new Set(['line', 'line-business', 'linebusiness'])";
const coreNew = "    telegram: new Set(['telegram', 'telegram-z', 'telegram-pure', 'telegram-k']),\n    line: new Set(['line', 'line-business', 'linebusiness']),\n    facebook: new Set(['facebook', 'facebook-business'])";
core = replaceOnce(core, coreOld, coreNew, 'translation core Facebook map');
write('ui/translation-core.js', core);

// ---------- ui/app.js ----------
let app = read('ui/app.js');
app = replaceOnce(
  app,
  "    if (!(family === 'telegram' || family === 'line')) return true;",
  "    if (!(family === 'telegram' || family === 'line' || family === 'facebook')) return true;",
  'Facebook bridge registration'
);

const familiesOld = [
  "  const PLATFORM_FAMILIES = [",
  "    { key: 'whatsapp', label: 'WhatsApp', iconType: 'whatsapp', iconClass: 'p-icon-whatsapp', types: ['whatsapp', 'whatsapp-pure'] },",
  "    { key: 'telegram', label: 'Telegram', iconType: 'telegram-z', iconClass: 'p-icon-telegram-z', types: ['telegram-z', 'telegram-k'] },",
  "    { key: 'line', label: 'Line', iconType: 'line', iconClass: 'p-icon-line', types: ['line', 'line-business'] }",
  "  ];"
].join('\n');
const familiesNew = [
  "  const PLATFORM_FAMILIES = [",
  "    { key: 'whatsapp', label: 'WhatsApp', iconType: 'whatsapp', iconClass: 'p-icon-whatsapp', types: ['whatsapp', 'whatsapp-pure'] },",
  "    { key: 'telegram', label: 'Telegram', iconType: 'telegram-z', iconClass: 'p-icon-telegram-z', types: ['telegram-z', 'telegram-k'] },",
  "    { key: 'line', label: 'Line', iconType: 'line', iconClass: 'p-icon-line', types: ['line', 'line-business'] },",
  "    { key: 'facebook', label: 'Facebook', iconType: 'facebook', iconClass: 'p-icon-facebook', types: ['facebook', 'facebook-business'] }",
  "  ];"
].join('\n');
app = replaceOnce(app, familiesOld, familiesNew, 'Facebook platform family');

app = replaceRegexOnce(
  app,
  /(\n\s+line:\s+'[^']+')\n  \};\n\n  \/\/ 平台 → 图标\/品牌色 class 映射/,
  "$1,\n    facebook: 'M24 12.073c0-6.627-5.373-12-12-12S0 5.446 0 12.073c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z'\n  };\n\n  // 平台 → 图标/品牌色 class 映射",
  'Facebook icon SVG'
);

app = replaceOnce(
  app,
  "    if (type === 'line-business') return 'p-icon-line-business';\n    return 'p-icon-whatsapp';",
  "    if (type === 'line-business') return 'p-icon-line-business';\n    if (type === 'facebook' || type === 'facebook-business') return 'p-icon-facebook';\n    return 'p-icon-whatsapp';",
  'Facebook icon class'
);
app = replaceOnce(
  app,
  "    if (type === 'telegram-z' || type === 'telegram-k') return ICON_PATHS.telegram;\n    return ICON_PATHS.whatsapp;",
  "    if (type === 'telegram-z' || type === 'telegram-k') return ICON_PATHS.telegram;\n    if (type === 'facebook' || type === 'facebook-business') return ICON_PATHS.facebook;\n    return ICON_PATHS.whatsapp;",
  'Facebook icon path'
);

const groupsOld = [
  "  const PLATFORM_GROUPS = [",
  "    { label: 'WhatsApp', types: ['whatsapp', 'whatsapp-pure'] },",
  "    { label: 'Telegram', types: ['telegram-z'] },",
  "    { label: 'Line', types: ['line', 'line-business'] }",
  "  ];"
].join('\n');
const groupsNew = [
  "  const PLATFORM_GROUPS = [",
  "    { label: 'WhatsApp', types: ['whatsapp', 'whatsapp-pure'] },",
  "    { label: 'Telegram', types: ['telegram-z'] },",
  "    { label: 'Line', types: ['line', 'line-business'] },",
  "    { label: 'Facebook', types: ['facebook', 'facebook-business'] }",
  "  ];"
].join('\n');
app = replaceOnce(app, groupsOld, groupsNew, 'Facebook platform group');

const facebookSyncFunction = [
  "  function syncFacebookTranslationCfgToWebview(wv, account) {",
  "    const installer = window.GeekTranslationAdapters?.facebook;",
  "    if (!wv || !account || typeof installer !== 'function') return;",
  "    let chatConfig = {}, globalConfig = {};",
  "    try { chatConfig = JSON.parse(accountStorageGetItemFor(account.id, 'translationChats') || '{}'); globalConfig = JSON.parse(accountStorageGetItemFor(account.id, 'translationGlobal') || '{}'); } catch {}",
  "    wv.executeJavaScript(`(${installer.toString()})(${JSON.stringify({ accountId: account.id, bridgeToken: bridgeTokenFor(wv), chats: chatConfig, global: globalConfig })})()`).catch(error => console.error('Facebook翻译适配器注入失败:', error.message));",
  "  }",
  "",
].join('\n');
app = replaceOnce(
  app,
  "  // 翻译通道注入：只同步语言和聊天配置；服务地址与供应商密钥均留在主进程。",
  facebookSyncFunction + "  // 翻译通道注入：只同步语言和聊天配置；服务地址与供应商密钥均留在主进程。",
  'Facebook sync function'
);

const syncLineBranch = [
  "    if (account.type === 'line' || account.type === 'line-business') {",
  "      syncLineTranslationCfgToWebview(wv, account);",
  "      return;",
  "    }",
  "    if (!(account.type === 'whatsapp' || account.type === 'whatsapp-pure')) return;"
].join('\n');
const syncFacebookBranch = [
  "    if (account.type === 'line' || account.type === 'line-business') {",
  "      syncLineTranslationCfgToWebview(wv, account);",
  "      return;",
  "    }",
  "    if (account.type === 'facebook' || account.type === 'facebook-business') {",
  "      syncFacebookTranslationCfgToWebview(wv, account);",
  "      return;",
  "    }",
  "    if (!(account.type === 'whatsapp' || account.type === 'whatsapp-pure')) return;"
].join('\n');
app = replaceOnce(app, syncLineBranch, syncFacebookBranch, 'Facebook translation branch');

const currentChatOld = [
  "  async function currentTranslationChat() {",
  "    const account = accounts.find(item => item.id === activeId);",
  "    const wv = wvMap.get(activeId);",
  "    if (!account || !wv || typeof wv.executeJavaScript !== 'function') return null;",
  "    try { return await platformTransportFor(account, wv).getCurrentChat(); }",
  "    catch { return null; }",
  "  }"
].join('\n');
const currentChatNew = [
  "  async function currentTranslationChat() {",
  "    const account = accounts.find(item => item.id === activeId);",
  "    const wv = wvMap.get(activeId);",
  "    if (!account || !wv || typeof wv.executeJavaScript !== 'function') return null;",
  "    const family = familyOf(account.type).key;",
  "    if (family === 'facebook') {",
  "      try {",
  "        return await wv.executeJavaScript(`(() => {",
  "          try {",
  "            if (typeof window.__geekFacebookCurrentChatId === 'function') return window.__geekFacebookCurrentChatId() || null;",
  "            const path = decodeURIComponent(String(location.pathname || ''));",
  "            const hit = path.match(/\\/messages\\/(?:e2ee\\/)?t\\/([^/?#]+)/i) || path.match(/^\\/t\\/([^/?#]+)/i);",
  "            if (hit?.[1]) return 'facebook:' + hit[1];",
  "            const query = new URLSearchParams(location.search || '');",
  "            const selected = query.get('selected_item_id') || query.get('thread_id') || query.get('conversation_id');",
  "            return selected ? 'facebook-business:' + selected : null;",
  "          } catch { return null; }",
  "        })()`);",
  "      } catch { return null; }",
  "    }",
  "    try { return await platformTransportFor(account, wv).getCurrentChat(); }",
  "    catch { return null; }",
  "  }"
].join('\n');
app = replaceOnce(app, currentChatOld, currentChatNew, 'Facebook current translation chat');

const accountLabelOld = "      opt.textContent = `${a.name} (${(a.type === 'telegram-z' || a.type === 'telegram-k') ? 'TG' : 'WA'})`;";
const accountLabelNew = [
  "      const family = familyOf(a.type).key;",
  "      const familyShort = { whatsapp: 'WA', telegram: 'TG', line: 'LINE', facebook: 'FB' }[family] || String(a.type || '').slice(0, 4).toUpperCase();",
  "      opt.textContent = `${a.name} (${familyShort})`;"
].join('\n');
app = replaceOnce(app, accountLabelOld, accountLabelNew, 'settings account family label');
app = app.replace('let activePlatform = null; // 当前平台家族 key（whatsapp/telegram/line）', 'let activePlatform = null; // 当前平台家族 key（whatsapp/telegram/line/facebook）');
app = app.replace('// WA/TG 页面翻译/原生输入桥：guest preload（sendToHost）；LINE 用自己的扩展 preload，不叠加', '// WA/TG/FB 页面翻译/原生输入桥：guest preload（sendToHost）；LINE 用自己的扩展 preload，不叠加');
write('ui/app.js', app);

// ---------- ui/index.html ----------
let index = read('ui/index.html');
index = replaceOnce(
  index,
  '<script src="translation-adapters.js"></script>\n<script src="app.js"></script>',
  '<script src="translation-adapters.js"></script>\n<script src="facebook-translation-adapter.js"></script>\n<script src="app.js"></script>',
  'Facebook adapter script tag'
);
write('ui/index.html', index);

// ---------- ui/style.css ----------
let style = read('ui/style.css');
style = replaceOnce(
  style,
  '.p-icon-line-business { background: #00B900; }',
  '.p-icon-line-business { background: #00B900; }\n.p-icon-facebook { background: #1877F2; }',
  'Facebook platform style'
);
write('ui/style.css', style);

console.log('FACEBOOK_INTEGRATION_PATCH_OK');
