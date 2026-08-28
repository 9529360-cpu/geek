'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workbenchPath = path.join(__dirname, '../ui/broadcast-workbench.js');
const workbench = fs.readFileSync(workbenchPath, 'utf8');
const safety = fs.readFileSync(path.join(__dirname, '../ui/broadcast-safety.js'), 'utf8');
const api = require(workbenchPath);

assert.equal(api.jobStatusLabel({ state: 'running' }), '发送中');
assert.equal(api.jobStatusLabel({ state: 'scheduled' }), '已定时');
assert.equal(api.stepForCard({ classList: { contains: name => name === 'bc-compose-card' } }), 'content');
assert.equal(api.stepForCard({ classList: { contains: name => name === 'bc-recipient-card' } }), 'audience');
assert.equal(api.stepForCard({ classList: { contains: name => name === 'bc-interval-card' } }), 'settings');
assert.equal(api.stepForCard({ classList: { contains: name => name === 'bc-review-card' } }), 'review');

assert.match(workbench, /closest\?\.\('#bc-menu-send'\)/, 'workbench must gate the real broadcast editor entrypoint');
assert.match(workbench, /window\.WAPLUS_WPP\|\|window\.WPP/, 'WhatsApp readiness must use the existing injected WPP bridge');
assert.match(workbench, /typeof W\.chat\.list!==['"]function['"]/, 'readiness requires the chat-list capability before opening the editor');
assert.match(workbench, /await W\.chat\.list\(\)/, 'readiness must prove the chat-list call is executable, not only that a global exists');
assert.match(workbench, /attempts[^\n]*18/, 'readiness retries must remain bounded');
assert.match(workbench, /WhatsApp 群发组件仍在初始化，可直接重试/, 'bounded readiness timeout must be presented as initialization, not a false send failure');
assert.match(workbench, /\['content', 'audience', 'settings', 'review'\]/, 'the editor must expose the four-stage creation flow');
assert.match(workbench, /固定受众快照/, 'review must preserve fixed-audience schedule semantics');
assert.match(workbench, /GeekBroadcastJobs/, 'task center must consume the existing account-scoped Job manager');
assert.match(workbench, /manager\.invoke\(job\.id/, 'task controls must address explicit Job ids');
assert.match(workbench, /accountData\.getAll\(accountId\)/, 'task center history must stay account-scoped');
assert.match(workbench, /sendHistory/, 'task center may summarize the existing encrypted send history');
assert.doesNotMatch(workbench, /message\s*:\s*item\.message|history[^\n]*msg\b/, 'task history UI must not persist or reconstruct chat message bodies');
assert.match(workbench, /prefers-reduced-motion:reduce/, 'motion must respect reduced-motion preferences');
assert.match(workbench, /role=['"]status['"]/, 'initialization feedback must be accessible status content');
assert.match(safety, /broadcast-workbench\.js/, 'workbench must be loaded by the established broadcast dependency chain');
assert.ok(safety.indexOf("'./broadcast-runtime.js'") < safety.indexOf("'./broadcast-workbench.js'"), 'workbench must load after the executable runtime');
assert.ok(safety.indexOf("'./broadcast-job-controller.js'") < safety.indexOf("'./broadcast-workbench.js'"), 'workbench extends, rather than replaces, the existing task presentation layer');

console.log('BROADCAST_WORKBENCH_CONTRACT_OK');
