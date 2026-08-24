'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(name) {
  return fs.readFileSync(path.join(__dirname, '../ui', name), 'utf8');
}

const controller = read('broadcast-job-controller.js');
const indicator = read('broadcast-account-indicator.js');
const runtime = read('broadcast-runtime.js');
const guard = read('broadcast-job-guard.js');

// The controller owns task presentation only. It must not observe or rewrite the formal
// broadcast editor, removing the entire self-trigger class that previously caused starvation.
assert.doesNotMatch(controller, /summaryObserver|refreshSummary|setTextIfChanged\(send,/, 'controller must not maintain editor summaries');
assert.doesNotMatch(controller, /observe\([^\n]*broadcast-overlay|summaryRoot\.observe/, 'controller must not observe the broadcast editor');
assert.match(controller, /getElementById\('nav-accounts'\)/, 'controller account observer must be account-list scoped');
assert.doesNotMatch(controller, /observe\(document\.body/, 'controller must not observe document.body');

// Account badges are especially sensitive because adding/removing the badge is itself a
// childList mutation. The observer must distinguish real account structure changes from
// mutations produced by its own render.
assert.match(indicator, /records\.some\(isAccountStructureMutation\)/, 'indicator must filter mutation records');
assert.match(indicator, /classList\?\.contains\('bc-account-job-state'\)/, 'indicator must ignore its own badge nodes');
assert.match(indicator, /setTextIfChanged\(badge, label\)/, 'indicator text writes must be idempotent');
assert.match(indicator, /setAttrIfChanged\(badge, 'title'/, 'indicator attribute writes must be idempotent');
assert.doesNotMatch(indicator, /new MutationObserver\(rerender\)/, 'indicator must not rerender for every child mutation');
assert.doesNotMatch(indicator, /document\.getElementById\('nav-accounts'\) \|\| document\.body/, 'indicator must not fall back to document.body');

// Runtime and guard are event/manager driven and should stay free of DOM mutation observers.
assert.doesNotMatch(runtime, /new MutationObserver/, 'runtime must stay manager/event driven');
assert.doesNotMatch(guard, /new MutationObserver/, 'guard must stay manager/event driven');

console.log('BROADCAST_RENDERER_STARVATION_CONTRACT_OK');
