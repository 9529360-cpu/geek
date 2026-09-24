'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n?/g, '\n');

const main = read('src/main.cjs');
const catalog = read('src/platform-catalog.cjs');
const navigation = read('src/webview-navigation-boundary.cjs');
const cdp = read('src/internal-cdp.cjs');

assert.match(catalog, /const WA_WEB_URL = 'https:\/\/web\.whatsapp\.com\/';/);
assert.match(catalog, /whatsapp:[\s\S]{0,240}url: WA_WEB_URL/);
assert.match(catalog, /'whatsapp-pure':[\s\S]{0,240}url: WA_WEB_URL/);

for (const [name, source] of [
  ['main', main],
  ['platform catalog', catalog],
  ['navigation boundary', navigation],
  ['internal CDP', cdp],
]) {
  assert.doesNotMatch(source, /WA_LOCAL_|127\.0\.0\.1:1843/, name + ' must not retain the retired WhatsApp localhost bootstrap');
}

assert.doesNotMatch(main, /resources[\\/]wa[\\/]index\.html/);
assert.doesNotMatch(main, /startWaLocalServer/);
assert.match(main, /let url = config \? config\.url : PLATFORM_CATALOG\[account\.type\]\.url;/);
assert.doesNotMatch(main, /account\.type === 'whatsapp'[\s\S]{0,100}url\s*=/);
assert.equal(
  fs.existsSync(path.join(root, 'resources', 'wa', 'index.html')),
  false,
  'frozen WhatsApp HTML snapshot must not ship as a future startup fallback',
);

console.log('WHATSAPP_LIVE_SOURCE_CONTRACT_OK');
