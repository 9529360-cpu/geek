const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
const coreSource = fs.readFileSync(path.join(root, 'ui', 'translation-core.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const adapterSource = fs.readFileSync(path.join(root, 'ui', 'translation-adapters.js'), 'utf8');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(coreSource, context, { filename: 'translation-core.js' });

assert.equal(
  context.window.GeekTranslationCore.platformOf('telegram-k'),
  'telegram',
  'Telegram K 必须映射到 Telegram 翻译平台'
);

const syncTranslationSource = appSource.match(/function syncTranslationCfgToWebview\(wv, account\) \{[\s\S]*?\n  \}/)?.[0] || '';
assert.match(
  syncTranslationSource,
  /account\.type === 'telegram-k'/,
  'Telegram K 必须进入 Telegram 翻译适配器注入分支'
);

assert.equal(
  context.window.GeekTranslationCore.platformOf('line-business'),
  'line',
  'LINE Business 必须映射到 LINE 翻译平台'
);

assert.match(
  syncTranslationSource,
  /account\.type === 'line-business'/,
  'LINE Business 必须进入 LINE 翻译适配器注入分支'
);

assert.match(
  mainSource,
  /const isLine = account\?\.type === 'line' \|\| account\?\.type === 'line-business';/,
  'LINE Business 必须通过 WebView 翻译桥安全登记'
);

assert.match(
  mainSource,
  /const isLineExtensionPage =\s*\(account\.type === 'line' \|\| account\.type === 'line-business'\)/,
  'LINE Business 必须通过扩展页面加载白名单'
);

const lineIpcSource = appSource.match(/async function handleLineTranslationIpc\(wv, event\) \{[\s\S]*?\n  \}/)?.[0] || '';
assert.match(
  lineIpcSource,
  /account\.type !== 'line-business'/,
  'LINE Business 必须通过 LINE 翻译 IPC 账号校验'
);

assert.match(
  adapterSource,
  /setTimeout\(\(\) => \{[^}]*process\(row, isHistory\); \}, 500\);/,
  'Telegram 历史消息延迟重试必须保留 isHistory 标记'
);

assert.match(
  appSource,
  /const original = window\.__geekTakeOutgoing\(text\);\s*let outgoing = !!original;\s*if \(!outgoing\)/,
  'WhatsApp 新发送消息必须先消费原文映射，避免 fromMe 数据库竞态触发二次反向翻译'
);

console.log('TRANSLATION_PLATFORM_CONTRACT_OK');
