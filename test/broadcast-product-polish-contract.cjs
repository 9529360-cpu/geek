'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerPath = path.join(__dirname, '../ui/broadcast-job-controller.js');
const source = fs.readFileSync(controllerPath, 'utf8');
const api = require(controllerPath);

const baseJob = {
  accountId: 'a',
  accountName: '工作号 A',
  state: 'running',
  current: 0,
  total: 3,
  ok: 0,
  fail: 0,
  targets: [
    { id: '1', name: '客户一' },
    { id: '2', name: '客户二' },
    { id: '3', name: '客户三' },
  ],
};

assert.deepEqual(api.targetContext(baseJob), { label: '当前对象', value: '客户一' });
assert.deepEqual(api.targetContext({ ...baseJob, current: 1, ok: 1, nextSendAt: Date.now() + 5000 }), { label: '下一对象', value: '客户二' });
assert.deepEqual(api.targetContext({ ...baseJob, state: 'paused', current: 1 }), { label: '暂停位置', value: '客户二' });
assert.deepEqual(api.targetContext({ ...baseJob, state: 'completed', current: 3, ok: 3 }), { label: '最后处理', value: '客户三' });
assert.deepEqual(api.targetContext({ ...baseJob, state: 'scheduled', current: 0 }), { label: '首个对象', value: '客户一' });

// Editing must preserve the chat workspace instead of recreating the old dark modal wall.
assert.match(source, /#broadcast-overlay\{background:transparent!important;backdrop-filter:none!important;/, 'broadcast editor must remove the full-screen dark backdrop');
assert.match(source, /pointer-events:none!important/, 'space outside the editor sheet must pass pointer input through to the workspace');
assert.match(source, /#broadcast-overlay \.bc-dialog\{pointer-events:auto!important;/, 'the editor sheet itself must remain interactive');
assert.match(source, /dialog\.setAttribute\('aria-modal', 'false'\)/, 'workspace-side editor must not claim modal semantics');
assert.match(source, /编辑群发 · 聊天页面保持可见/, 'editor copy must communicate workspace coexistence');

// Runtime feedback must retain the useful information density of the formal sending page.
assert.match(source, /bc-job-stats/, 'task panel must expose structured progress stats');
assert.match(source, /createStat\('进度', 'progress'\)/, 'task panel must show progress');
assert.match(source, /createStat\('成功', 'ok'\)/, 'task panel must show success count');
assert.match(source, /createStat\('失败', 'fail'\)/, 'task panel must show failure count');
assert.match(source, /createStat\('剩余', 'remaining'\)/, 'task panel must show remaining count');
assert.match(source, /targetContext\(job\)/, 'current/next target context must be derived from Job data');
assert.match(source, /job\.targets/, 'task context must use the frozen Job target snapshot');
assert.match(source, /job\?\.nextSendAt/, 'task context must distinguish active sending from interval waiting');
assert.match(source, /发送账号 · \$\{job\.accountName\}/, 'task panel must identify the sending account when available');

// Terminal UX must end with explicit, stable in-app actions rather than tiny/ephemeral feedback.
assert.match(source, /createButton\('dismiss', '关闭', 'hidden'\)/, 'terminal task must expose an explicit close button');
assert.match(source, /dismiss\.classList\.toggle\('hidden', !terminal\)/, 'explicit close must appear only after the job ends');
assert.match(source, /bar\.dataset\.failureExpanded === job\.id/, 'failure expansion must be tracked per job');
assert.match(source, /failureBox\.classList\.toggle\('hidden', bar\.dataset\.failureExpanded !== job\.id\)/, 'normal rerenders must preserve an expanded failure panel');

// Do not regress to the old sending-page-as-state model.
assert.doesNotMatch(source, /getElementById\('bc-preview-name'\)/, 'task panel must not scrape the legacy current-target preview');
assert.doesNotMatch(source, /getElementById\('bc-countdown'\)/, 'task panel must not scrape the legacy countdown');
assert.doesNotMatch(source, /getElementById\('bc-sent-count'\)/, 'task panel must not scrape the legacy sent count');
assert.doesNotMatch(source, /broadcast-progress-text/, 'task panel must not scrape legacy progress text');

console.log('BROADCAST_PRODUCT_POLISH_CONTRACT_OK');
