'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const mainSource = read('src/main.cjs');
const appSource = read('ui/app.js');
const coreSource = read('ui/translation-core.js');
const adapterSource = read('ui/facebook-translation-adapter.js');
const indexSource = read('ui/index.html');
const styleSource = read('ui/style.css');

const coreContext = { window: {} };
vm.createContext(coreContext);
vm.runInContext(coreSource, coreContext, { filename: 'translation-core.js' });
assert.equal(coreContext.window.GeekTranslationCore.platformOf('facebook'), 'facebook', 'Facebook 必须映射到 facebook 翻译平台');
assert.equal(coreContext.window.GeekTranslationCore.platformOf('facebook-business'), 'facebook', 'Facebook Business 必须映射到 facebook 翻译平台');

const adapterContext = { window: { GeekTranslationAdapters: {} } };
vm.createContext(adapterContext);
vm.runInContext(adapterSource, adapterContext, { filename: 'facebook-translation-adapter.js' });
assert.equal(typeof adapterContext.window.GeekTranslationAdapters.facebook, 'function', '必须注册 Facebook 独立翻译适配器');

assert.match(mainSource, /facebook:\s*\{[\s\S]*?url:\s*'https:\/\/www\.facebook\.com\/messages/,
  '主进程必须注册 Facebook Messenger 平台');
assert.match(mainSource, /'facebook-business':\s*\{[\s\S]*?business\.facebook\.com/,
  '主进程必须注册 Facebook Business 平台');
assert.match(mainSource, /const isFacebook = account\?\.type === 'facebook' \|\| account\?\.type === 'facebook-business';/,
  'WebView 安全登记必须显式识别 Facebook 账号');
assert.match(mainSource, /isFacebook[\s\S]*?facebook\\\.com\|messenger\\\.com/,
  'WebView 安全登记必须只允许 Facebook/Messenger 页面');
assert.match(mainSource, /allowedInputPage[\s\S]*?facebook\\\.com\|messenger\\\.com/,
  '原生输入白名单必须包含 Facebook/Messenger 页面');
assert.match(mainSource, /data-lexical-editor[\s\S]*?role=\"textbox\"|role=\\\"textbox\\\"[\s\S]*?data-lexical-editor/,
  'Facebook 原生输入必须验证已聚焦的消息编辑器');

assert.match(appSource, /key:\s*'facebook'[\s\S]*?types:\s*\['facebook',\s*'facebook-business'\]/,
  '顶部平台家族必须包含 Facebook 与 Facebook Business');
assert.match(appSource, /family === 'telegram' \|\| family === 'line' \|\| family === 'facebook'/,
  'Facebook 必须进入 WebView 安全桥登记');
assert.match(appSource, /function syncFacebookTranslationCfgToWebview\(wv, account\)/,
  '宿主必须提供 Facebook 翻译配置注入函数');
assert.match(appSource, /account\.type === 'facebook' \|\| account\.type === 'facebook-business'/,
  'Facebook 两种账号都必须进入翻译适配器注入分支');
assert.match(appSource, /family === 'facebook'[\s\S]*?__geekFacebookCurrentChatId/,
  '当前聊天设置必须能读取 Facebook 会话 ID');
assert.match(appSource, /p-icon-facebook/,
  'Facebook 账号必须有独立平台图标映射');

const adapterScriptPos = indexSource.indexOf('<script src="facebook-translation-adapter.js"></script>');
const appScriptPos = indexSource.indexOf('<script src="app.js"></script>');
assert.ok(adapterScriptPos >= 0 && appScriptPos > adapterScriptPos,
  'Facebook 适配器必须在 app.js 之前加载');
assert.match(styleSource, /\.p-icon-facebook\s*\{\s*background:\s*#1877F2;/,
  'Facebook 图标必须使用独立品牌色');

assert.match(adapterSource, /MutationObserver/,
  'Facebook 动态消息列表必须由 MutationObserver 跟踪');
assert.match(adapterSource, /data-geek-facebook-translation-state|geekFacebookTranslationState/,
  'Facebook DOM 复用必须有独立翻译状态标记');
assert.match(adapterSource, /geekFacebookTranslationKey/,
  'Facebook 虚拟列表节点复用必须通过消息指纹重新校验');
assert.match(adapterSource, /selected_item_id/,
  'Facebook Business 必须从收件箱 URL 提取稳定当前会话标识');
assert.match(adapterSource, /messages\\\/\(\?:e2ee\\\/\)\?t|messages\/\(\?:e2ee/,
  'Facebook Messenger 必须支持普通和端到端加密会话 URL');
assert.match(adapterSource, /type:\s*'native-input-request'/,
  '发送前翻译必须通过受控原生输入桥回填编辑器');
assert.match(adapterSource, /event\?\.stopImmediatePropagation|stopImmediatePropagation/,
  '发送前翻译必须拦截原发送动作，避免原文和译文重复发送');
assert.match(adapterSource, /box\.textContent\s*=\s*translated/,
  '译文必须通过 textContent 安全挂载');
assert.doesNotMatch(adapterSource, /\.innerHTML\s*=/,
  'Facebook 适配器不得用 innerHTML 写入消息或译文');

console.log('FACEBOOK_TRANSLATION_CONTRACT_OK');
