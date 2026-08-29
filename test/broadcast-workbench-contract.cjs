'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workbenchPath = path.join(__dirname, '../ui/broadcast-workbench.js');
const audiencePath = path.join(__dirname, '../ui/broadcast-audience-ux.js');
const workbench = fs.readFileSync(workbenchPath, 'utf8');
const audience = fs.readFileSync(audiencePath, 'utf8');
const safety = fs.readFileSync(path.join(__dirname, '../ui/broadcast-safety.js'), 'utf8');
const api = require(workbenchPath);
const audienceApi = require(audiencePath);

assert.equal(api.jobStatusLabel({ state: 'running' }), '发送中');
assert.equal(api.jobStatusLabel({ state: 'scheduled' }), '已定时');
assert.equal(api.stepForCard({ classList: { contains: name => name === 'bc-compose-card' } }), 'content');
assert.equal(api.stepForCard({ classList: { contains: name => name === 'bc-recipient-card' } }), 'audience');
assert.equal(api.stepForCard({ classList: { contains: name => name === 'bc-interval-card' } }), 'settings');
assert.equal(api.stepForCard({ classList: { contains: name => name === 'bc-review-card' } }), 'review');
assert.equal(typeof audienceApi.relabelRecipientPresets, 'function');
assert.equal(typeof audienceApi.retireLegacyScheduler, 'function');

// Workbench is presentation only. It must never hold the legacy editor entrypoint
// hostage while probing WPP/readiness. Contact loading belongs to the existing
// broadcast app/runtime path and may update inline status after the modal opens.
assert.doesNotMatch(workbench, /closest\?\.\('#bc-menu-send'\)/, 'workbench must not intercept the broadcast editor entrypoint');
assert.doesNotMatch(workbench, /stopImmediatePropagation\s*\(/, 'workbench must not synchronously block the original broadcast open handler');
assert.doesNotMatch(workbench, /preventDefault\s*\(/, 'workbench must not cancel the original broadcast open action');
assert.doesNotMatch(workbench, /prepareAndReopen|awaitBroadcastReadiness|probeWhatsAppReadiness/, 'workbench must not duplicate transport/readiness orchestration');
assert.doesNotMatch(workbench, /window\.WAPLUS_WPP\s*\|\|\s*window\.WPP/, 'presentation layer must not directly probe the WhatsApp runtime');
assert.match(workbench, /getElementById\(['"]broadcast-overlay['"]\)/, 'workbench should enhance the already-open broadcast overlay');
assert.match(workbench, /getElementById\(['"]broadcast-meta['"]\)/, 'contact readiness feedback should follow the existing broadcast loader state');
assert.match(workbench, /正在后台同步联系人与群组，可继续编辑消息/, 'loading feedback must explicitly remain non-blocking');
assert.match(workbench, /联系人暂未就绪，不影响编辑/, 'contact errors must stay scoped to the contact area instead of freezing the editor');
assert.match(workbench, /overlayObserver\.observe\(overlay, \{ attributes: true, attributeFilter: \['class'\] \}\)/, 'overlay observer must only watch open/close state');
assert.match(workbench, /metaObserver\.observe\(meta, \{ subtree: true, childList: true, characterData: true \}\)/, 'contact status observer must be scoped to the legacy meta node');
assert.doesNotMatch(workbench, /observer\.observe\(overlay, \{[^}]*subtree:\s*true/, 'workbench must not observe and mutate the same overlay subtree');
assert.match(workbench, /span\.textContent !== text/, 'status writes must be idempotent even if status sync is invoked repeatedly');

assert.match(workbench, /\['content', 'audience', 'settings', 'review'\]/, 'the editor must expose the four-stage creation flow');
assert.match(workbench, /固定受众快照/, 'review must preserve fixed-audience schedule semantics');
assert.match(workbench, /GeekBroadcastJobs/, 'task center must consume the existing account-scoped Job manager');
assert.match(workbench, /manager\.invoke\(job\.id/, 'task controls must address explicit Job ids');
assert.match(workbench, /accountData\.getAll\(accountId\)/, 'task center history must stay account-scoped');
assert.match(workbench, /sendHistory/, 'task center may summarize the existing encrypted send history');
assert.doesNotMatch(workbench, /message\s*:\s*item\.message|history[^\n]*msg\b/, 'task history UI must not persist or reconstruct chat message bodies');
assert.match(workbench, /prefers-reduced-motion:reduce/, 'motion must respect reduced-motion preferences');
assert.match(workbench, /setAttribute\(['"]role['"],\s*['"]status['"]\)/, 'inline readiness feedback must be accessible status content');

assert.match(audience, /保存收件人名单/, 'contacts and groups must have an explicit reusable recipient-list action');
assert.match(audience, /保存群组集合/, 'group-only collections must be clearly named as group-only');
assert.match(audience, /broadcast-add-schedule/, 'legacy multi-message scheduler UI must be explicitly retired');
assert.match(audience, /broadcast-schedule-toggle/, 'the canonical account-scoped scheduled Job entry must remain available');
assert.match(audience, /受众、内容和附件在创建时固定/, 'scheduled Job copy must communicate immutable snapshot semantics');

assert.match(safety, /broadcast-workbench\.js/, 'workbench must be loaded by the established broadcast dependency chain');
assert.match(safety, /broadcast-audience-ux\.js/, 'recipient/scheduler UX must be loaded by the same bounded broadcast chain');
assert.ok(safety.indexOf("'./broadcast-runtime.js'") < safety.indexOf("'./broadcast-workbench.js'"), 'workbench must load after the executable runtime');
assert.ok(safety.indexOf("'./broadcast-job-controller.js'") < safety.indexOf("'./broadcast-workbench.js'"), 'workbench extends, rather than replaces, the existing task presentation layer');

console.log('BROADCAST_WORKBENCH_CONTRACT_OK');
