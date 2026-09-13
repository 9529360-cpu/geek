'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const normalizeLineEndings = (value) => String(value).replace(/\r\n?/g, '\n');
const main = normalizeLineEndings(fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8'));
const webviewIpc = normalizeLineEndings(fs.readFileSync(path.join(__dirname, '../src/webview-ipc.cjs'), 'utf8'));
const catalog = normalizeLineEndings(fs.readFileSync(path.join(__dirname, '../src/platform-catalog.cjs'), 'utf8'));
const accountState = normalizeLineEndings(fs.readFileSync(path.join(__dirname, '../src/account-state.cjs'), 'utf8'));
assert.equal(normalizeLineEndings('a\r\nb\rc\n'), 'a\nb\nc\n');

assert.match(
  catalog,
  /'telegram-k':\s*freezeConfig\(\{[\s\S]*?name:\s*'TelegramK'[\s\S]*?short:\s*'TGK'[\s\S]*?url:\s*'https:\/\/web\.telegram\.org\/k\/'[\s\S]*?hostnames:\s*\['web\.telegram\.org'\][\s\S]*?allowSuffix:\s*'\.telegram\.org'/,
  'Telegram K 必须由 platform-catalog 注册并保持 Telegram 官方域名边界'
);
assert.match(main, /resolveTypeConfig:\s*platformConfig/, 'Account State owner 必须使用 platform-catalog authority');
assert.match(
  accountState,
  /const type = resolveTypeConfig\(item\.type\) \? item\.type : 'whatsapp';/,
  'stored account 类型归一化必须继续以注入的 appTypeConfig authority 为准；Telegram K 注册后不得落入 WhatsApp fallback'
);

assert.match(
  webviewIpc,
  /const TELEGRAM_TYPES = new Set\(\['telegram-z', 'telegram', 'telegram-pure', 'telegram-k'\]\);/,
  'Telegram K 必须继续由 WebView IPC owner 识别为受保护的 Telegram guest'
);
assert.match(
  webviewIpc,
  /register\('webview:register',[\s\S]*TELEGRAM_TYPES\.has\(account\.type\)[\s\S]*webviewOwnership\.register\(/,
  'Telegram K 必须继续通过受保护的 WebView ownership bridge 登记'
);

console.log('TELEGRAM_K_ACCOUNT_TYPE_CONTRACT_OK');