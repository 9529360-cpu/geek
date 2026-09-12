'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
const start = main.indexOf("window.webContents.on('will-attach-webview'");
const end = main.indexOf("\n  window.webContents.on('did-attach-webview'", start);
assert.ok(start >= 0 && end > start, 'will-attach-webview security block must exist');
const block = main.slice(start, end);

const parseIndex = block.indexOf('parsedSource = new URL(source);');
const guardIndex = block.indexOf('if (!account || !config) {');
const policyIndex = block.indexOf('isAccountNavigationAllowed(account, partition, parsedSource.href)');

assert.ok(parseIndex >= 0, 'source URL parsing must remain present');
assert.ok(guardIndex > parseIndex, 'unknown account/config guard must run after URL parsing');
assert.ok(policyIndex > guardIndex, 'account-scoped navigation policy must run only after the null guard');
assert.match(block, /if \(!account \|\| !config\) \{\s*event\.preventDefault\(\);\s*return;\s*\}/, 'unknown or stale partitions must be rejected without dereferencing account');
assert.match(block, /if \(!isAccountNavigationAllowed\(account, partition, parsedSource\.href\)\) \{\s*event\.preventDefault\(\);\s*return;\s*\}/, 'known accounts with disallowed URLs must still fail closed through the shared authority');
assert.doesNotMatch(block, /\bhostAllowed\b|\bisAllowed\b|isLineExtensionPage|customAllowed/, 'will-attach must not reintroduce a second navigation policy implementation');

console.log('WEBVIEW_UNKNOWN_PARTITION_CONTRACT_OK');
