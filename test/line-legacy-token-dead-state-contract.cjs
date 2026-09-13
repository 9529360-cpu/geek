'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const main = fs.readFileSync(path.join(srcDir, 'main.cjs'), 'utf8');
const accountState = fs.readFileSync(path.join(srcDir, 'account-state.cjs'), 'utf8');
const { LINE_EXTENSION_ID, LINE_EXTENSION_URL, PLATFORM_CATALOG } = require('../src/platform-catalog.cjs');

const deadMainSymbols = [
  'LINE_TOKENS_FILE',
  'lineTokensCache',
  'lineGuestContents',
  'loadLineTokens',
  'saveLineToken',
  'writeLineTokensEncrypted',
  'lineTokenEncrypt',
  'lineTokenDecrypt',
];

for (const symbol of deadMainSymbols) {
  assert.equal(
    main.includes(symbol),
    false,
    `production main must not recreate the legacy LINE token backup symbol: ${symbol}`
  );
}

function productionSourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...productionSourceFiles(fullPath));
      continue;
    }
    if (/\.(?:cjs|mjs|js|json)$/.test(entry.name)) files.push(fullPath);
  }
  return files;
}

for (const file of productionSourceFiles(srcDir)) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(
    source,
    /line-tokens\.json/i,
    `production src must not own an independent line-tokens.json persistence path: ${path.relative(root, file)}`
  );
}

assert.match(
  accountState,
  /const ACCOUNT_PARTITION_PREFIX = 'persist:webview-page-';/,
  'account sessions must remain persistent Electron partitions'
);
assert.match(
  main,
  /const PARTITION_PREFIX = ACCOUNT_PARTITION_PREFIX;/,
  'main must keep using the canonical persistent account partition prefix'
);
assert.match(
  main,
  /const ses = session\.fromPartition\(partition, \{ cache: true \}\);[\s\S]{0,2000}ses\.extensions\.loadExtension\(LINE_EXTENSION_PATH\);/,
  'LINE extension must continue loading inside the account persistent Session'
);
assert.match(
  main,
  /const LINE_EXTENSION_PATH = path\.join\(\s*RESOURCES_DIR, 'extensions', 'line-3\.5\.1'\s*\);/,
  'LINE extension resource path must remain unchanged'
);
assert.match(
  main,
  /if \(isLine\) \{\s*webPreferences\.preload = path\.join\(__dirname, '\.\.', 'resources', 's3loYR\.js'\);\s*webPreferences\.contextIsolation = true;/,
  'LINE candidate must keep the same compatibility preload while enabling contextIsolation'
);
assert.match(
  main,
  /params\.webpreferences = isLine\s*\? 'contextIsolation=yes,sandbox=true,nativeWindowOpen=yes,spellcheck=no,backgroundThrottling=false'/,
  'LINE candidate must change only contextIsolation in its scoped WebView preferences'
);

assert.equal(LINE_EXTENSION_ID, 'ophjlpahpchlmihnnnihgmmeilfjmjjc', 'LINE extension ID must remain unchanged');
assert.equal(LINE_EXTENSION_URL, `chrome-extension://${LINE_EXTENSION_ID}/index.html`, 'LINE extension URL must remain unchanged');
assert.equal(PLATFORM_CATALOG.line.url, LINE_EXTENSION_URL, 'LINE platform must still use the extension page');
assert.equal(PLATFORM_CATALOG.line.needsExtension, true, 'LINE platform must still require the extension');
assert.equal(PLATFORM_CATALOG['line-business'].needsExtension, true, 'LINE Business must still require the extension integration');

console.log('LINE_LEGACY_TOKEN_DEAD_STATE_CONTRACT_OK');
