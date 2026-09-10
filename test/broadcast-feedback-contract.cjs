'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const product = read('ui/broadcast-product-closure.js');
const tags = read('ui/broadcast-recipient-tags.js');
const jobs = read('ui/broadcast-job-controller.js');
const safety = read('ui/broadcast-safety.js');
const app = read('ui/app.js');
const feedbackE2E = read('e2e/specs/broadcast-feedback.e2e.cjs');

assert.doesNotMatch(product, /window\.alert|\balert\s*\(/, 'product closure feedback must stay inline');
assert.match(product, /setWorkbenchStatus\(doc, '请先选择账号'/);
assert.match(product, /setWorkbenchStatus\(doc, '定时任务已保存，可继续添加下一条'/);
assert.match(product, /awaitScheduledDurable\(job\.id\)/, 'schedule durability verification must remain');
assert.match(product, /runtime\.startFromEditor\(\)/, 'canonical runtime must remain the scheduling owner');

assert.doesNotMatch(tags, /window\.alert|\balert\s*\(/, 'recipient tag duplicate alerts must be removed');
assert.match(tags, /broadcast-recipient-tag-status/);
assert.match(tags, /verifyDurableCount\(accountId, after, doc\)/, 'tag save/delete must still verify account-scoped durability');
assert.match(tags, /ownerDelete/, 'destructive delete must still route through the owner confirmation path');

assert.doesNotMatch(jobs, /window\.alert|\balert\s*\(/, 'job export feedback must stay in the job bar');
assert.match(jobs, /bc-job-feedback/);
assert.match(jobs, /setAttribute\('role', 'status'\)/);
assert.match(jobs, /'\\uFEFF联系人,聊天ID,失败原因\\n'/, 'failure CSV BOM/header must remain');
assert.match(jobs, /replace\(\/"\/g, '""'\)/, 'CSV quote escaping must remain');
assert.match(jobs, /window\.api\.file\.save/, 'failure export save API must remain');

const prevent = safety.indexOf('event.preventDefault();');
const stop = safety.indexOf('event.stopImmediatePropagation();');
const feedback = safety.indexOf("showScheduleReadinessStatus('定时任务持久化尚未就绪");
assert.ok(prevent >= 0 && stop > prevent && feedback > stop, 'future schedule must fail closed before presenting feedback');
assert.doesNotMatch(safety, /window\.alert|\balert\s*\(/, 'schedule readiness feedback must not use modal alert');
assert.match(safety, /broadcast-workbench-status/);
assert.match(safety, /aria-live', 'polite'/);

assert.doesNotMatch(app, /CSV 导入成功：匹配|CSV 未匹配到聊天/, 'dead duplicate CSV alert owner must be removed');
const csvStart = app.indexOf("const excelMeta = document.getElementById('bc-excel-meta')");
const csvEnd = app.indexOf("document.getElementById('btn-broadcast').onclick", csvStart);
assert.ok(csvStart >= 0 && csvEnd > csvStart, 'canonical CSV/TXT import block must exist');
const csv = app.slice(csvStart, csvEnd);
assert.doesNotMatch(csv, /\balert\s*\(/, 'canonical CSV/TXT feedback must be inline');
assert.match(csv, /setAttribute\('role', 'status'\)/);
assert.match(csv, /setAttribute\('aria-live', 'polite'\)/);
assert.match(csv, /已导入 \$\{numbers\.length\} 个号码/, 'audience count copy must preserve 已导入 N 个 parsing');
assert.match(csv, /已导入 0 个号码（未匹配到可用号码）/, 'zero-match import must remain explicit and non-blocking');
assert.match(csv, /导入失败: /, 'import failures must remain visible inline');

assert.match(feedbackE2E, /schedulePersistenceReady:\s*\(\) => false/, 'E2E must force the persistence-not-ready branch');
assert.match(feedbackE2E, /waitVisible\('#broadcast-send'\)\)\.click\(\)/, 'E2E must click the real send control');
assert.match(feedbackE2E, /blocked\.reached, false/, 'E2E must prove downstream send handlers were not reached');
assert.match(feedbackE2E, /renderer still responsive after inline schedule error/, 'E2E must prove renderer responsiveness after feedback');
assert.doesNotMatch(feedbackE2E, /sendDirect|sendText|broadcast-send-message/, 'feedback E2E must not invoke transport send APIs');

for (const source of [product, tags, jobs, safety, app]) {
  assert.doesNotMatch(source, /window\.alert\s*=/, 'no global alert monkey-patch is allowed');
}
console.log('BROADCAST_FEEDBACK_CONTRACT_OK');
