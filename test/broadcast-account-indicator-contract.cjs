'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indicatorPath = path.join(__dirname, '../ui/broadcast-account-indicator.js');
const source = fs.readFileSync(indicatorPath, 'utf8');
const api = require(indicatorPath);

assert.equal(api.labelFor({ state: 'running' }), '群发中');
assert.equal(api.labelFor({ state: 'completed', fail: 0 }), '已完成');
assert.equal(api.labelFor({ state: 'completed', fail: 1 }), '有失败');
assert.equal(typeof api.isAccountStructureMutation, 'function');

assert.match(source, /setTextIfChanged\(badge, label\)/, 'badge text writes must be idempotent');
assert.match(source, /setAttrIfChanged\(badge, 'title'/, 'badge title writes must be idempotent');
assert.match(source, /classList\?\.contains\('bc-account-job-state'\)/, 'observer must explicitly ignore its own badge mutations');
assert.match(source, /records\.some\(isAccountStructureMutation\)/, 'observer must rerender only for account structure changes');
assert.doesNotMatch(source, /const sidebar = document\.getElementById\('nav-accounts'\) \|\| document\.body/, 'indicator observer must never fall back to the full document body');
assert.doesNotMatch(source, /new MutationObserver\(rerender\)/, 'indicator must not rerender on every child mutation');

console.log('BROADCAST_ACCOUNT_INDICATOR_CONTRACT_OK');
