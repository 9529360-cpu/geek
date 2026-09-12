'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n?/g, '\n');

const main = read('src/main.cjs');
const catalog = read('src/platform-catalog.cjs');
const boundary = read('src/webview-navigation-boundary.cjs');
const entry = read('src/main-entry.cjs');

assert.match(main, /require\('\.\/platform-catalog\.cjs'\)/, 'main must consume platform catalog');
assert.match(main, /resolveTypeConfig:\s*platformConfig/, 'Account State must validate against platform catalog');
assert.match(main, /Object\.entries\(PLATFORM_CATALOG\)/, 'platform listing must come from platform catalog');
assert.match(main, /isAccountNavigationAllowed\(account, partition, parsedSource\.href\)/, 'pre-attach URL checks must share the navigation policy authority');
assert.doesNotMatch(main, /\bconst\s+APP_TYPES\s*=/, 'main must not reintroduce a second platform metadata table');
assert.doesNotMatch(main, /\bfunction\s+appTypeConfig\s*\(/, 'main must not reintroduce a second platform resolver');
assert.doesNotMatch(main, /\bhostAllowed\b/, 'legacy global navigation allowlist must stay removed');

// Scan every production CommonJS module so a later refactor cannot hide a second catalog elsewhere.
const srcDir = path.join(root, 'src');
for (const filename of fs.readdirSync(srcDir).filter(name => name.endsWith('.cjs') && name !== 'platform-catalog.cjs')) {
  const source = read(path.join('src', filename));
  assert.doesNotMatch(source, /\bconst\s+APP_TYPES\s*=/, `${filename} must not declare a second platform metadata table`);
}

assert.match(catalog, /const PLATFORM_CATALOG = Object\.freeze\(/, 'platform catalog must own platform metadata');
for (const marker of [
  "'https://web.whatsapp.com/'",
  "'https://web.telegram.org/a'",
  "'https://web.telegram.org/k/'",
  "'https://manager.line.biz/'",
  "'ophjlpahpchlmihnnnihgmmeilfjmjjc'",
]) {
  assert.ok(catalog.includes(marker), `catalog must retain ${marker}`);
}
assert.doesNotMatch(boundary, /https:\/\/web\.whatsapp\.com|https:\/\/web\.telegram\.org|https:\/\/manager\.line\.biz|ophjlpahpchlmihnnnihgmmeilfjmjjc/, 'navigation boundary must consume, not duplicate, platform literals');

assert.match(boundary, /platformConfig\(account\.type\)/, 'navigation policy must resolve through catalog');
assert.match(boundary, /contents\.setWindowOpenHandler\?\.\(/, 'navigation boundary must own account popup policy');
assert.match(boundary, /contents\.on\?\.\('will-navigate'/, 'navigation boundary must own account navigation policy');
assert.match(boundary, /contents\.on\?\.\('will-redirect'/, 'navigation boundary must own account redirect policy');

const didAttachStart = main.indexOf("window.webContents.on('did-attach-webview'");
const subscriptionStart = main.indexOf('\nlet subscriptionWindow', didAttachStart);
assert.ok(didAttachStart >= 0 && subscriptionStart > didAttachStart, 'main must retain guest lifecycle instrumentation');
const didAttachRegion = main.slice(didAttachStart, subscriptionStart);
assert.doesNotMatch(didAttachRegion, /setWindowOpenHandler|will-navigate|will-redirect/, 'main guest lifecycle instrumentation must not become a second navigation authority');

const installAt = entry.indexOf('installAccountScopedWebviewNavigationBoundary({');
const mainAt = entry.indexOf("require('./main.cjs')");
assert.ok(installAt >= 0 && mainAt > installAt, 'sole navigation authority must install before main composition');

console.log('PLATFORM_NAVIGATION_OWNERSHIP_CONTRACT_OK');
