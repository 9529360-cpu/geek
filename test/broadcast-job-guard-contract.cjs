'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const guardPath = path.join(__dirname, '../ui/broadcast-job-guard.js');
const loaderPath = path.join(__dirname, '../ui/broadcast-safety.js');
const source = fs.readFileSync(guardPath, 'utf8');
const loader = fs.readFileSync(loaderPath, 'utf8');
const api = require(guardPath);

assert.deepEqual(api.failureMessages({ failed: [{ message: 'main failure' }, { reason: 'target failure' }] }), ['main failure', 'target failure']);
assert.deepEqual(api.failureMessages({ failed: [] }), []);
assert.match(source, /closest\?\.\('#bc-menu-send'\)/, 'guard must intercept reopening the broadcast editor');
assert.match(source, /manager\.hasActive\(accountId\)/, 'reopen protection must be scoped to the current account only');
assert.match(source, /event\.stopImmediatePropagation\(\)/, 'active-job reopen must stop the legacy openBroadcast handler');
assert.match(source, /broadcast-overlay'\)\?\.classList\.add\('hidden'\)/, 'active-job reopen must keep the editor closed');
assert.match(source, /scheduler\.cancel\(job\.accountId, `timer-\$\{job\.id\}`\)/, 'terminal jobs must cancel current-session timers');
assert.match(source, /scheduler\.cancel\(job\.accountId, `persisted-\$\{job\.id\}`\)/, 'terminal jobs must cancel restored timers');
assert.match(source, /bc-job-hard-failure/, 'pre-send hard failures need an inline visible reason');
assert.match(source, /data-hard-failure/, 'hard failures must expose failure-details action even when target fail count is zero');
assert.ok(loader.indexOf("'./broadcast-job-controller.js'") < loader.indexOf("'./broadcast-job-guard.js'"), 'guard must load after the taskbar controller');

console.log('BROADCAST_JOB_GUARD_CONTRACT_OK');
