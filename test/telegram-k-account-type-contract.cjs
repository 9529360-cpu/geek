'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const normalizeLineEndings = (value) => String(value).replace(/\r\n?/g, '\n');
const main = normalizeLineEndings(fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8'));
const accountState = normalizeLineEndings(fs.readFileSync(path.join(__dirname, '../src/account-state.cjs'), 'utf8'));
assert.equal(normalizeLineEndings('a\r\nb\rc\n'), 'a\nb\nc\n');

const appTypes = main.match(/const APP_TYPES = \{[\s\S]*?\n\};\n\nfunction appTypeConfig/)?.[0] || '';
assert.ok(appTypes, '必须能定位主进程 APP_TYPES');

assert.match(
  appTypes,
  /'telegram-k':\s*\{[\s\S]*?name:\s*'TelegramK'[\s\S]*?short:\s*'TGK'[\s\S]*?url:\s*'https:\/\/web\.telegram\.org\/k\/'[\s\S]*?hostnames:\s*\['web\.telegram\.org'\][\s\S]*?allowSuffix:\s*'\.telegram\.org'/,
  'Telegram K 必须作为正式账号类型注册到 APP_TYPES，并保持 Telegram 官方域名边界'
);

assert.match(main, /resolveTypeConfig:\s*appTypeConfig/, 'Account State owner 必须继续使用主进程 APP_TYPES 作为唯一平台类型 authority');
assert.match(
  accountState,
  /const type = resolveTypeConfig\(item\.type\) \? item\.type : 'whatsapp';/,
  'stored account 类型归一化必须继续以注入的 appTypeConfig authority 为准；Telegram K 注册后不得落入 WhatsApp fallback'
);

assert.match(
  main,
  /const isTelegram = \['telegram-z', 'telegram', 'telegram-pure', 'telegram-k'\]\.includes\(account\?\.type\);/,
  'Telegram K 必须继续通过受保护的 WebView ownership/translation bridge 登记'
);

console.log('TELEGRAM_K_ACCOUNT_TYPE_CONTRACT_OK');