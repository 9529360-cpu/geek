'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../ui/broadcast-job-controller.js'), 'utf8');

assert.doesNotMatch(source, /#broadcast-overlay\s*\{/,
  'job controller must not override the formal broadcast editor geometry');
assert.doesNotMatch(source, /workspace side sheet|bc-job-stats|bc-job-activity|targetContext\(/,
  'heavy side-sheet and stats/activity UI must not return');
assert.doesNotMatch(source, /applyCopyAndSemantics|refreshSummary|selectedCount\(/,
  'job controller must not rewrite formal editor copy or summary UI');
assert.doesNotMatch(source, /observe\(document\.body/,
  'job controller must never observe document.body');
assert.match(source, /const dismiss = createButton\('dismiss', '关闭', 'hidden'\)/,
  'terminal job bar must expose an explicit Close action');
assert.match(source, /if \(jobId && jobId !== runtime\.lastJobId\)[\s\S]*overlay\.classList\.add\('hidden'\)/,
  'a newly created job must close the editor and return focus to the workspace');
assert.match(source, /width:min\(350px,calc\(100vw - 36px\)\)/,
  'job feedback must remain a compact upper-right surface');

console.log('BROADCAST_FORMAL_UX_CONTRACT_OK');
