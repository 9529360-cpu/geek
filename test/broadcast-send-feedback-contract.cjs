'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const loader = fs.readFileSync(path.join(root, 'ui', 'broadcast-safety.js'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'ui', 'broadcast-send-controller.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'ui', 'broadcast-runtime.js'), 'utf8');

const readinessListener = loader.indexOf("showScheduleReadinessStatus('定时任务持久化尚未就绪");
const controllerAt = loader.indexOf("loadScript('./broadcast-send-controller.js'");
const runtimeAt = loader.indexOf("loadScript('./broadcast-runtime.js'");
assert.ok(readinessListener >= 0, 'future schedule fail-closed feedback must remain installed');
assert.ok(controllerAt > readinessListener, 'send controller must not bypass the earlier schedule readiness gate');
assert.ok(runtimeAt > controllerAt, 'send UX controller must install before the runtime fallback listener');

assert.match(controller, /event\.target\?\.closest\?\.\('#broadcast-send'\)/, 'controller must own only the canonical send button interaction');
assert.match(controller, /event\.stopImmediatePropagation\(\)/, 'controller must prevent the legacy runtime click listener from double-starting a job');
assert.match(controller, /GeekBroadcastRuntimeInstance/, 'controller must delegate business work to the canonical runtime instance');
assert.match(controller, /runtime\.startFromEditor\(\)/, 'controller must use the public runtime start contract');
assert.match(controller, /runtimePending/, 'controller must preserve the existing duplicate-click guard');
assert.match(controller, /send\.disabled = true/, 'controller must disable the send button while start validation is pending');
assert.match(controller, /send\.disabled = false/, 'controller must restore the send button after success or failure');

assert.match(controller, /broadcast-workbench-status/, 'feedback must reuse the existing Workbench status surface');
assert.match(controller, /setAttribute\('role', 'status'\)/, 'feedback must expose status semantics');
assert.match(controller, /setAttribute\('aria-live', 'polite'\)/, 'feedback must announce without stealing focus');
assert.match(controller, /setAttribute\('aria-atomic', 'true'\)/, 'feedback updates must be announced atomically');
assert.match(controller, /data-step=\\"audience\\"/, 'audience errors should move keyboard focus toward the actionable step');
assert.match(controller, /broadcast-message/, 'content errors should focus the composer');
assert.match(controller, /broadcast-schedule-time/, 'schedule errors should focus the time field');
assert.doesNotMatch(controller, /\balert\s*\(|window\.alert/, 'canonical send-start feedback must never open a system alert');
assert.doesNotMatch(controller, /window\.api|GeekBroadcastJobs|register\(|runJob\(|sendTarget\(/, 'send controller must not duplicate runtime, persistence, or transport ownership');

assert.match(runtime, /GeekBroadcastRuntimeInstance = Object\.freeze\(\{[\s\S]*?startFromEditor,/, 'runtime must keep exporting the canonical start contract');
assert.match(runtime, /void startFromEditor\(\)\.catch\(error => alert/, 'runtime private click listener remains only as compatibility fallback during staged ownership migration');

console.log('BROADCAST_SEND_FEEDBACK_CONTRACT_OK');
