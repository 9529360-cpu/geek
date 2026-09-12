'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
const start = main.indexOf('function configureWebviewSecurity(window)');
const end = main.indexOf("\nlet subscriptionWindow", start);
assert.ok(start >= 0 && end > start, 'configureWebviewSecurity block must exist');
const block = main.slice(start, end);

const parseIndex = block.indexOf('parsedSource = new URL(source);');
const guardIndex = block.indexOf('if (!account || !config) {');
const customAccountIndex = block.indexOf("if (account.type === 'website' && account.customUrl)");
const lineAccountIndex = block.indexOf("(account.type === 'line' || account.type === 'line-business')");

assert.ok(parseIndex >= 0, 'source URL parsing must remain present');
assert.ok(guardIndex > parseIndex, 'unknown account/config guard must run after URL parsing');
assert.ok(customAccountIndex > guardIndex, 'account.type custom-site access must occur only after the null guard');
assert.ok(lineAccountIndex > guardIndex, 'account.type LINE access must occur only after the null guard');
assert.match(block, /if \(!account \|\| !config\) \{\s*event\.preventDefault\(\);\s*return;\s*\}/, 'unknown or stale partitions must be rejected without dereferencing account');
assert.match(block, /if \(!isAllowed\) \{\s*event\.preventDefault\(\);\s*return;\s*\}/, 'known accounts with disallowed URLs must still fail closed');

console.log('WEBVIEW_UNKNOWN_PARTITION_CONTRACT_OK');
