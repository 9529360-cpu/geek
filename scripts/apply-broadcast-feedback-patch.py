from pathlib import Path
import textwrap


def must_replace(text, old, new, label, count=1):
    if text.count(old) < count:
        raise SystemExit(f'{label}: expected text not found: {old[:120]!r}')
    return text.replace(old, new, count)


# 1) Schedule/product closure feedback only; preserve runtime and durability ownership.
p = Path('ui/broadcast-product-closure.js')
s = p.read_text()
anchor = "  function pendingJobsFor(manager, accountId) {\n"
helper = """  function setWorkbenchStatus(doc, text, state = 'ready') {
    const status = doc.getElementById('broadcast-workbench-status');
    if (!status) return false;
    status.dataset.state = state;
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    const span = status.querySelector('span');
    if (span) span.textContent = String(text || '');
    else status.textContent = String(text || '');
    return true;
  }

"""
if helper not in s:
    s = must_replace(s, anchor, helper + anchor, 'product helper')
s = must_replace(
    s,
    "void manager.invoke(job.id, 'stop').catch(error => window.alert?.(String(error?.message || error))).finally(() => renderPendingSchedules(doc));",
    "void manager.invoke(job.id, 'stop').catch(error => setWorkbenchStatus(doc, `取消定时任务失败：${String(error?.message || error)}`, 'error')).finally(() => renderPendingSchedules(doc));",
    'cancel feedback',
)
for old, new, label in [
    ("if (!accountId) { window.alert?.('请先选择账号'); return false; }", "if (!accountId) { setWorkbenchStatus(doc, '请先选择账号', 'error'); return false; }", 'schedule account'),
    ("if (!toggle?.checked) { window.alert?.('请先开启“定时发送”'); return false; }", "if (!toggle?.checked) { setWorkbenchStatus(doc, '请先开启“定时发送”', 'error'); toggle?.focus?.(); return false; }", 'schedule toggle'),
    ("if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) { window.alert?.('请选择未来的发送时间'); return false; }", "if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) { setWorkbenchStatus(doc, '请选择未来的发送时间', 'error'); timeInput?.focus?.(); return false; }", 'schedule time'),
    ("if (!runtime || typeof runtime.startFromEditor !== 'function') { window.alert?.('群发运行时尚未就绪，请稍后重试'); return false; }", "if (!runtime || typeof runtime.startFromEditor !== 'function') { setWorkbenchStatus(doc, '群发运行时尚未就绪，请稍后重试', 'error'); return false; }", 'runtime readiness'),
    ("if (!persistence || typeof persistence.awaitScheduledDurable !== 'function') { window.alert?.('定时任务持久化尚未就绪，请稍后重试'); return false; }", "if (!persistence || typeof persistence.awaitScheduledDurable !== 'function') { setWorkbenchStatus(doc, '定时任务持久化尚未就绪，请稍后重试', 'error'); return false; }", 'persistence readiness'),
    ("const status = doc.getElementById('broadcast-workbench-status')?.querySelector('span');\n      if (status) status.textContent = '定时任务已保存，可修改时间和消息继续添加下一条';", "setWorkbenchStatus(doc, '定时任务已保存，可继续添加下一条', 'ready');", 'schedule success'),
    ("window.alert?.(String(error?.message || error));", "setWorkbenchStatus(doc, `添加定时任务失败：${String(error?.message || error)}`, 'error');", 'schedule failure'),
]:
    s = must_replace(s, old, new, label)
p.write_text(s)


# 2) Recipient tags already own a local status surface; remove duplicate modal alerts.
p = Path('ui/broadcast-recipient-tags.js')
s = p.read_text()
for line in [
    "      window.alert?.('自定义标签删除未持久化，请重新打开群发后重试。');\n",
    "      window.alert?.('请先选择账号');\n",
    "      window.alert?.('群发标签保存功能尚未初始化完成，请关闭后重新打开群发。');\n",
    "      window.alert?.(`保存标签失败：${String(error?.message || error)}`);\n",
    "      window.alert?.('自定义标签未能持久化到当前账号，请重新打开群发后重试。');\n",
]:
    s = must_replace(s, line, '', 'recipient alert')
p.write_text(s)


# 3) Failure export feedback lives inside the existing per-account job bar.
p = Path('ui/broadcast-job-controller.js')
s = p.read_text()
s = must_replace(
    s,
    ".bc-job-meta{margin:5px 0 0 15px;color:var(--text-tertiary);font-size:11px}.bc-job-progress",
    ".bc-job-meta{margin:5px 0 0 15px;color:var(--text-tertiary);font-size:11px}.bc-job-feedback{min-height:15px;margin:4px 0 0 15px;color:var(--text-tertiary);font-size:10.5px}.bc-job-feedback[data-state=\"error\"]{color:#f56c6c}.bc-job-progress",
    'job feedback css',
)
s = must_replace(
    s,
    """    const meta = document.createElement('div');
    meta.className = 'bc-job-meta';
    const progress = document.createElement('div');""",
    """    const meta = document.createElement('div');
    meta.className = 'bc-job-meta';
    const feedback = document.createElement('div');
    feedback.className = 'bc-job-feedback';
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    feedback.setAttribute('aria-atomic', 'true');
    const progress = document.createElement('div');""",
    'job feedback node',
)
s = must_replace(s, "bar.append(head, meta, progress, failureBox, actions);", "bar.append(head, meta, feedback, progress, failureBox, actions);", 'job bar append')
s = must_replace(
    s,
    """      exportFailures.disabled = true;
      try {
        const saved = await window.api.file.save({ defaultName: `群发失败名单-${String(job.id || '').slice(0, 24)}.csv`, content: failureCsv(job) });
        if (saved) window.alert(`已导出失败名单：${saved}`);
      } catch (error) {
        window.alert(`导出失败：${String(error?.message || error)}`);
      } finally {
        exportFailures.disabled = false;
      }""",
    """      exportFailures.disabled = true;
      feedback.dataset.state = 'pending';
      feedback.textContent = '正在导出失败名单…';
      try {
        const saved = await window.api.file.save({ defaultName: `群发失败名单-${String(job.id || '').slice(0, 24)}.csv`, content: failureCsv(job) });
        feedback.dataset.state = saved ? 'ok' : 'idle';
        feedback.textContent = saved ? `已导出失败名单：${saved}` : '已取消导出失败名单';
      } catch (error) {
        feedback.dataset.state = 'error';
        feedback.textContent = `导出失败：${String(error?.message || error)}`;
      } finally {
        exportFailures.disabled = false;
      }""",
    'job export feedback',
)
s = must_replace(
    s,
    """    const meta = bar.querySelector('.bc-job-meta');
    const fill = bar.querySelector('.bc-job-progress>i');""",
    """    const meta = bar.querySelector('.bc-job-meta');
    const feedback = bar.querySelector('.bc-job-feedback');
    const fill = bar.querySelector('.bc-job-progress>i');""",
    'job render feedback',
)
s = must_replace(
    s,
    "    const current = Math.max(0, Number(job.current) || 0);",
    """    const jobKey = String(job.id || '');
    if (feedback.dataset.jobId !== jobKey) {
      feedback.dataset.jobId = jobKey;
      feedback.dataset.state = 'idle';
      feedback.textContent = '';
    }

    const current = Math.max(0, Number(job.current) || 0);""",
    'job feedback generation',
)
p.write_text(s)


# 4) Schedule safety gate still stops propagation first, then reports inline.
p = Path('ui/broadcast-safety.js')
s = p.read_text()
s = must_replace(
    s,
    """if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('click', event => {""",
    """if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  function showScheduleReadinessStatus(message) {
    const status = document.getElementById('broadcast-workbench-status') || document.getElementById('broadcast-meta');
    if (!status) return;
    status.dataset.state = 'error';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    const text = status.querySelector?.('span');
    if (text) text.textContent = message;
    else status.textContent = message;
  }

  document.addEventListener('click', event => {""",
    'safety status helper',
)
s = must_replace(
    s,
    "    window.alert?.('定时任务持久化尚未就绪，请稍后重试。');",
    "    showScheduleReadinessStatus('定时任务持久化尚未就绪，请稍后重试。');",
    'safety alert',
)
p.write_text(s)


# 5) app.js: remove the earlier overwritten CSV handler, keep the later CSV/TXT owner.
p = Path('ui/app.js')
s = p.read_text()
start_text = "  // CSV 导入联系人（每行：聊天名称或 ID，自动匹配勾选）\n  document.getElementById('broadcast-import-csv').onclick = async () => {"
start = s.find(start_text)
end = s.find("  function renderBroadcastFiles() {", start)
if start < 0 or end < 0:
    raise SystemExit('legacy duplicate CSV handler not found')
s = s[:start] + "  // CSV/TXT 导入由下方 #bc-excel-meta 流程唯一处理。\n" + s[end:]
s = must_replace(
    s,
    """  const excelMeta = document.getElementById('bc-excel-meta');
  const importCsvBtn = document.getElementById('broadcast-import-csv');""",
    """  const excelMeta = document.getElementById('bc-excel-meta');
  if (excelMeta) {
    excelMeta.setAttribute('role', 'status');
    excelMeta.setAttribute('aria-live', 'polite');
    excelMeta.setAttribute('aria-atomic', 'true');
  }
  const importCsvBtn = document.getElementById('broadcast-import-csv');""",
    'excel status semantics',
)
s = must_replace(
    s,
    """      const numbers = lines.map(row => String(row[col] ?? '').trim()).filter(Boolean);
      // 核验：WA 联系人集合存在 = 已注册（原版 verificacontatosaguarde 逻辑）
      window.__excelNumbers = numbers;""",
    """      const numbers = lines.map(row => String(row[col] ?? '').trim()).filter(Boolean);
      // 核验：WA 联系人集合存在 = 已注册（原版 verificacontatosaguarde 逻辑）
      window.__excelNumbers = numbers;
      if (!numbers.length) {
        if (excelMeta) excelMeta.textContent = '已导入 0 个号码（未匹配到可用号码）';
        return;
      }""",
    'excel zero result',
)
s = must_replace(
    s,
    """          if (txt.startsWith('OK:')) {
            const okN = parseInt(txt.split(':')[1]) || 0;
            if (excelMeta) excelMeta.textContent = `已导入 ${numbers.length} 个号码（前 ${chunk.length} 个核验：${okN} 个有效 WhatsApp）`;
          }""",
    """          if (txt.startsWith('OK:')) {
            const okN = parseInt(txt.split(':')[1]) || 0;
            if (excelMeta) excelMeta.textContent = okN
              ? `已导入 ${numbers.length} 个号码（前 ${chunk.length} 个核验：${okN} 个有效 WhatsApp）`
              : `已导入 ${numbers.length} 个号码（前 ${chunk.length} 个核验：未匹配到有效 WhatsApp）`;
          } else if (txt.startsWith('ERR:') && excelMeta) {
            excelMeta.textContent = `已导入 ${numbers.length} 个号码（WhatsApp 核验暂不可用，可继续使用导入号码）`;
          }""",
    'excel verification feedback',
)
p.write_text(s)


# 6) Focused source/architecture contract.
Path('test/broadcast-feedback-contract.cjs').write_text(textwrap.dedent(r"""
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

for (const source of [product, tags, jobs, safety, app]) {
  assert.doesNotMatch(source, /window\.alert\s*=/, 'no global alert monkey-patch is allowed');
}
console.log('BROADCAST_FEEDBACK_CONTRACT_OK');
""").lstrip())


# 7) Strengthen the existing schedule gate contract.
p = Path('test/broadcast-schedule-readiness-contract.cjs')
s = p.read_text()
anchor = "assert.match(safety, /GeekBroadcastSchedulePersistenceInstance/, 'gate must require the installed persistence instance before allowing a future schedule');\n"
addition = """assert.doesNotMatch(safety, /window\\.alert|\\balert\\s*\\(/, 'persistence-not-ready feedback must not open a system alert');
assert.match(safety, /broadcast-workbench-status/, 'blocked future schedules should report through the existing Workbench status');
assert.match(safety, /setAttribute\\('aria-live', 'polite'\\)/, 'gate feedback must be announced without stealing focus');
const preventIndex = safety.indexOf('event.preventDefault();');
const stopIndex = safety.indexOf('event.stopImmediatePropagation();');
assert.ok(preventIndex >= 0 && stopIndex > preventIndex, 'send must be blocked before the inline feedback path');
"""
s = must_replace(s, anchor, anchor + addition, 'schedule contract')
p.write_text(s)


# 8) Electron E2E: real capture gate remains fail-closed and no modal blocks the renderer.
p = Path('e2e/specs/broadcast-readiness.e2e.cjs')
s = p.read_text()
pos = s.rfind('\n});')
if pos < 0:
    raise SystemExit('broadcast E2E describe end missing')
test = r'''

  it('keeps future-schedule persistence errors inline and renderer responsive', async () => {
    await activateAccount(ACCOUNT_A);
    await openBroadcast();
    await browser.execute(() => {
      const original = window.GeekBroadcastScheduleRegistry;
      window.__geekE2EOriginalScheduleRegistry = original;
      window.GeekBroadcastScheduleRegistry = Object.assign({}, original || {}, { schedulePersistenceReady: () => false });
      const toggle = document.getElementById('broadcast-schedule-toggle');
      const time = document.getElementById('broadcast-schedule-time');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      const future = new Date(Date.now() + 10 * 60 * 1000);
      time.value = new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
      window.__geekE2ESendReached = false;
      document.getElementById('broadcast-send').addEventListener('click', () => { window.__geekE2ESendReached = true; }, { once: true });
    });

    await (await waitVisible('.bc-workbench-step[data-step="review"]')).click();
    await (await waitVisible('#broadcast-send')).click();

    const blocked = await browser.execute(() => ({
      reached: window.__geekE2ESendReached,
      status: document.getElementById('broadcast-workbench-status')?.textContent || '',
      role: document.getElementById('broadcast-workbench-status')?.getAttribute('role') || '',
    }));
    assert.equal(blocked.reached, false, 'blocked schedule must not reach the send handler');
    assert.match(blocked.status, /定时任务持久化尚未就绪/);
    assert.equal(blocked.role, 'status');

    await (await waitVisible('.bc-workbench-step[data-step="content"]')).click();
    const message = await waitVisible('#broadcast-message');
    await message.setValue('renderer still responsive after inline schedule error');
    assert.equal(await message.getValue(), 'renderer still responsive after inline schedule error');

    await browser.execute(() => {
      if (window.__geekE2EOriginalScheduleRegistry) window.GeekBroadcastScheduleRegistry = window.__geekE2EOriginalScheduleRegistry;
      delete window.__geekE2EOriginalScheduleRegistry;
    });
    await (await waitVisible('#broadcast-close')).click();
    await waitHidden('#broadcast-overlay');
  });
'''
s = s[:pos] + test + s[pos:]
p.write_text(s)
