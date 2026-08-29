(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastJobController = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TERMINAL = new Set(['completed', 'stopped', 'failed']);
  const PENDING = new Set(['scheduled', 'queued']);

  function visibleFor(job, activeAccountId) {
    return !!job && !job.dismissed && String(job.accountId) === String(activeAccountId || '');
  }

  function activeAccountId() {
    if (typeof document === 'undefined') return '';
    return document.querySelector('.nav-account.active[data-id]')?.dataset.id || '';
  }

  function formatScheduledAt(value) {
    const time = Number(value);
    if (!Number.isFinite(time) || time <= 0) return '等待执行';
    try { return new Date(time).toLocaleString(); }
    catch (_) { return '等待执行'; }
  }

  function failureRows(job) {
    return (Array.isArray(job?.failed) ? job.failed : []).map(item => ({
      name: String(item?.name || ''),
      targetId: String(item?.targetId || ''),
      reason: String(item?.reason || item?.message || item || 'SEND_FAILED'),
    })).filter(item => item.name || item.targetId || item.reason);
  }

  function csvCell(value) {
    return `"${String(value || '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  }

  function failureCsv(job) {
    const rows = failureRows(job);
    return '\uFEFF联系人,聊天ID,失败原因\n' + rows.map(row => [row.name, row.targetId, row.reason].map(csvCell).join(',')).join('\n');
  }

  function injectStyles() {
    if (document.getElementById('broadcast-job-style')) return;
    const style = document.createElement('style');
    style.id = 'broadcast-job-style';
    style.textContent = `
      #broadcast-job-bar{position:fixed;top:46px;right:18px;z-index:88;width:min(350px,calc(100vw - 36px));padding:11px 12px;border:1px solid var(--border-standard);border-radius:10px;background:color-mix(in srgb,var(--bg-surface) 94%,transparent);box-shadow:0 14px 38px rgba(0,0,0,.34);backdrop-filter:blur(18px);color:var(--text-primary);font:12px/1.4 var(--font-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif)}
      #broadcast-job-bar.hidden{display:none!important}.bc-job-head{display:flex;align-items:center;gap:8px}.bc-job-dot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
      .bc-job-title{font-size:12.5px;font-weight:650;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bc-job-close{border:0;background:transparent;color:var(--text-tertiary);font-size:17px;line-height:1;cursor:pointer;padding:2px 4px;border-radius:5px}.bc-job-close:hover{background:var(--bg-hover);color:var(--text-primary)}
      .bc-job-meta{margin:5px 0 0 15px;color:var(--text-tertiary);font-size:11px}.bc-job-progress{height:4px;margin:8px 0 0 15px;border-radius:999px;background:var(--bg-elevated);overflow:hidden}.bc-job-progress>i{display:block;height:100%;width:0;background:var(--accent);transition:width .25s ease}
      .bc-job-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:9px}.bc-job-actions button{height:27px;padding:3px 9px;border:1px solid var(--border-standard);border-radius:6px;background:var(--bg-elevated);color:var(--text-secondary);font-size:11px;cursor:pointer}.bc-job-actions button:hover{color:var(--text-primary);background:var(--bg-hover)}.bc-job-actions .danger{color:#ff7d74}
      .bc-job-failures{max-height:150px;overflow:auto;margin:8px 0 0 15px;padding:7px 8px;border-radius:6px;background:var(--bg-elevated);color:var(--text-secondary);font-size:10.5px;white-space:pre-wrap}
      #broadcast-overlay .bc-action-trigger{display:inline-flex;align-items:center;min-height:28px;padding:4px 9px;border:1px solid var(--border-standard);border-radius:6px;background:var(--bg-elevated);cursor:pointer;width:max-content}
      #broadcast-overlay .bc-action-trigger:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--border-standard));background:var(--accent-soft);color:var(--accent)}
      #broadcast-overlay .bc-action-trigger .bc-switch,#broadcast-overlay .bc-action-trigger input{display:none!important}#broadcast-overlay .bc-action-trigger .bc-switch-label{font-size:11px;font-weight:600}
    `;
    document.head.appendChild(style);
  }

  function createButton(action, text, className = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.act = action;
    if (className) button.className = className;
    button.textContent = text;
    return button;
  }

  function ensureBar(runtime) {
    let bar = document.getElementById('broadcast-job-bar');
    if (bar) return bar;

    bar = document.createElement('aside');
    bar.id = 'broadcast-job-bar';
    bar.className = 'hidden';
    bar.setAttribute('aria-live', 'polite');

    const head = document.createElement('div');
    head.className = 'bc-job-head';
    const dot = document.createElement('span');
    dot.className = 'bc-job-dot';
    const title = document.createElement('strong');
    title.className = 'bc-job-title';
    title.textContent = '正在群发';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'bc-job-close';
    close.title = '关闭';
    close.textContent = '×';
    head.append(dot, title, close);

    const meta = document.createElement('div');
    meta.className = 'bc-job-meta';
    const progress = document.createElement('div');
    progress.className = 'bc-job-progress';
    progress.appendChild(document.createElement('i'));
    const failureBox = document.createElement('div');
    failureBox.className = 'bc-job-failures hidden';

    const actions = document.createElement('div');
    actions.className = 'bc-job-actions';
    const pause = createButton('pause', '暂停');
    const stop = createButton('stop', '停止后续发送', 'danger');
    const failures = createButton('failures', '查看失败', 'hidden');
    const exportFailures = createButton('export-failures', '导出失败 CSV', 'hidden');
    actions.append(pause, stop, failures, exportFailures);
    bar.append(head, meta, progress, failureBox, actions);
    document.body.appendChild(bar);

    pause.onclick = async () => {
      const job = currentJob(runtime);
      if (!job || PENDING.has(job.state) || TERMINAL.has(job.state) || job.state === 'stopping') return;
      try { await runtime.manager.invoke(job.id, job.state === 'paused' ? 'resume' : 'pause'); }
      catch (_) {}
      render(runtime);
    };

    stop.onclick = async () => {
      const job = currentJob(runtime);
      if (!job || TERMINAL.has(job.state)) return;
      try { await runtime.manager.invoke(job.id, 'stop'); }
      catch (_) {}
      render(runtime);
    };

    failures.onclick = () => {
      const job = currentJob(runtime);
      const details = failureRows(job).map(item => [item.name || item.targetId || '任务', item.reason].join('：'));
      failureBox.textContent = details.length ? details.join('\n') : '没有可用的失败明细。';
      failureBox.classList.toggle('hidden');
    };

    exportFailures.onclick = async () => {
      const job = currentJob(runtime);
      if (!failureRows(job).length) return;
      exportFailures.disabled = true;
      try {
        const saved = await window.api.file.save({ defaultName: `群发失败名单-${String(job.id || '').slice(0, 24)}.csv`, content: failureCsv(job) });
        if (saved) window.alert(`已导出失败名单：${saved}`);
      } catch (error) {
        window.alert(`导出失败：${String(error?.message || error)}`);
      } finally {
        exportFailures.disabled = false;
      }
    };

    close.onclick = () => {
      const job = currentJob(runtime);
      if (!job || !TERMINAL.has(job.state)) return;
      try { runtime.manager.dismiss(job.id); } catch (_) {}
      render(runtime);
    };

    return bar;
  }

  function currentJob(runtime) {
    return runtime.manager?.getCurrent(activeAccountId()) || null;
  }

  function render(runtime) {
    const bar = ensureBar(runtime);
    const accountId = activeAccountId();
    const job = currentJob(runtime);
    const visible = visibleFor(job, accountId);
    bar.classList.toggle('hidden', !visible);
    if (!visible) return;

    const title = bar.querySelector('.bc-job-title');
    const meta = bar.querySelector('.bc-job-meta');
    const fill = bar.querySelector('.bc-job-progress>i');
    const pause = bar.querySelector('[data-act="pause"]');
    const stop = bar.querySelector('[data-act="stop"]');
    const failures = bar.querySelector('[data-act="failures"]');
    const exportFailures = bar.querySelector('[data-act="export-failures"]');
    const close = bar.querySelector('.bc-job-close');
    const failureBox = bar.querySelector('.bc-job-failures');

    const current = Math.max(0, Number(job.current) || 0);
    const total = Math.max(0, Number(job.total) || 0);
    const ok = Math.max(0, Number(job.ok) || 0);
    const fail = Math.max(0, Number(job.fail) || 0);
    fill.style.width = `${total ? Math.min(100, current / total * 100) : 0}%`;
    failureBox.classList.add('hidden');

    if (job.state === 'completed') {
      title.textContent = fail ? `群发完成 · 成功 ${ok} · 失败 ${fail}` : `群发完成 · ${ok || total} / ${total}`;
      meta.textContent = fail ? '部分消息未发送成功' : '全部发送成功';
    } else if (job.state === 'failed') {
      title.textContent = `群发异常结束 · 成功 ${ok} · 失败 ${fail}`;
      meta.textContent = '可查看失败明细后重新处理';
    } else if (job.state === 'stopped') {
      title.textContent = `群发已停止 · 成功 ${ok}`;
      meta.textContent = total ? `未发送 ${Math.max(0, total - current)} · 共 ${total}` : '已停止后续发送';
    } else if (job.state === 'stopping') {
      title.textContent = `正在停止 ${current} / ${total}`;
      meta.textContent = '当前步骤结束后不再继续发送';
    } else if (job.state === 'paused') {
      title.textContent = `群发已暂停 ${current} / ${total}`;
      meta.textContent = `成功 ${ok} · 失败 ${fail}`;
    } else if (job.state === 'scheduled') {
      title.textContent = `群发已定时 · ${total} 个聊天`;
      meta.textContent = `${formatScheduledAt(job.scheduledAt)} · 已固定 ${total} 个发送对象`;
    } else if (job.state === 'queued') {
      title.textContent = `群发排队中 · ${total} 个聊天`;
      meta.textContent = '等待当前账号的上一任务完成';
    } else {
      const nextSeconds = job.nextSendAt ? Math.max(0, Math.ceil((job.nextSendAt - Date.now()) / 1000)) : null;
      title.textContent = total ? `正在群发 ${current} / ${total}` : '正在准备群发';
      meta.textContent = nextSeconds != null ? `成功 ${ok} · 失败 ${fail} · 下一条 ${nextSeconds} 秒后` : `成功 ${ok} · 失败 ${fail}`;
    }

    const terminal = TERMINAL.has(job.state);
    const pending = PENDING.has(job.state);
    pause.classList.toggle('hidden', terminal || pending || job.state === 'stopping');
    pause.textContent = job.state === 'paused' ? '继续' : '暂停';
    stop.classList.toggle('hidden', terminal);
    stop.textContent = job.state === 'scheduled' ? '取消定时' : job.state === 'queued' ? '取消排队' : '停止后续发送';
    const hasFailures = failureRows(job).length > 0;
    failures.classList.toggle('hidden', !(terminal && hasFailures));
    exportFailures.classList.toggle('hidden', !(terminal && hasFailures));
    close.style.visibility = terminal ? 'visible' : 'hidden';
  }

  function applyCopyAndSemantics() {
    const message = document.getElementById('broadcast-message');
    if (message) message.placeholder = '输入要发送的消息，可用下方变量插入联系人名称或问候语';
    const addFile = document.getElementById('broadcast-add-file');
    const fileLabel = addFile?.closest('label');
    if (fileLabel) {
      fileLabel.classList.add('bc-action-trigger');
      const text = fileLabel.querySelector('.bc-switch-label');
      if (text) text.textContent = '＋ 添加附件 · 最多10个，单个512 MiB';
    }
    const addVcard = document.getElementById('broadcast-add-vcard');
    const vcardLabel = addVcard?.closest('label');
    if (vcardLabel) {
      vcardLabel.classList.add('bc-action-trigger');
      const text = vcardLabel.querySelector('.bc-switch-label');
      if (text) text.textContent = '＋ 添加电子名片';
    }
    const saveGroup = document.getElementById('broadcast-save-group');
    if (saveGroup) saveGroup.textContent = '保存当前选择';
    const showAll = document.getElementById('broadcast-show-all-groups');
    if (showAll) showAll.textContent = '清除集合筛选';
    document.querySelectorAll('input[name="bc-sendto"]').forEach(input => {
      const text = input.closest('label')?.querySelector('span');
      if (!text) return;
      if (input.value === 'exclude-contacts') text.textContent = '排除指定联系人（过滤条件）';
      if (input.value === 'exclude-groups') text.textContent = '排除指定群组（过滤条件）';
    });
  }

  function selectedCount() {
    const mode = document.querySelector('input[name="bc-sendto"]:checked')?.value || 'custom';
    if (mode === 'paste') return Number(document.getElementById('bc-paste-total')?.textContent) || 0;
    if (mode === 'excel') {
      const text = document.getElementById('bc-excel-meta')?.textContent || '';
      return Number((text.match(/已导入\s*(\d+)/) || [])[1]) || 0;
    }
    if (['all', 'all-contacts', 'all-groups', 'exclude-contacts', 'exclude-groups'].includes(mode)) {
      return Number(window.__geekBroadcastAudienceEstimate?.()) || 0;
    }
    return document.querySelectorAll('#bc-selected-chips .bc-selected-chip').length;
  }

  function sendSummaryText(mode, count, hasModeSelection = true) {
    if (mode === 'label') return hasModeSelection ? '发送到所选标签' : '请选择标签';
    if (mode === 'group-members') return hasModeSelection ? '发送给所选群成员' : '请选择群组';
    return count ? `发送给 ${count} 个聊天` : '请选择发送对象';
  }

  function setTextIfChanged(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function refreshSummary() {
    const send = document.getElementById('broadcast-send');
    const note = document.querySelector('#broadcast-overlay .bc-footer-note');
    if (!send || !note) return;
    const mode = document.querySelector('input[name="bc-sendto"]:checked')?.value || 'custom';
    const count = selectedCount();
    const files = document.querySelectorAll('#broadcast-files .bf-item').length;
    const lo = document.getElementById('broadcast-interval-min')?.value || '5';
    const hi = document.getElementById('broadcast-interval-max')?.value || Math.max(10, Number(lo) || 5);
    const hasModeSelection = mode === 'label'
      ? !!document.getElementById('bc-label-select')?.value
      : mode === 'group-members'
        ? !!document.getElementById('bc-group-members-select')?.selectedOptions?.length
        : true;
    setTextIfChanged(send, sendSummaryText(mode, count, hasModeSelection));
    setTextIfChanged(note, `${files ? `${files} 个附件 · ` : ''}间隔 ${lo}–${hi} 秒`);
  }

  function install() {
    if (typeof document === 'undefined' || window.__geekBroadcastJobInstalled) return;
    const manager = window.GeekBroadcastJobs;
    if (!manager) return;
    window.__geekBroadcastJobInstalled = true;

    injectStyles();
    applyCopyAndSemantics();

    const runtime = { manager, unsubscribe: null, clock: null, summaryObserver: null, accountObserver: null };
    ensureBar(runtime);
    runtime.unsubscribe = manager.subscribe(() => render(runtime));

    const summaryRoot = document.getElementById('broadcast-overlay');
    if (summaryRoot) {
      runtime.summaryObserver = new MutationObserver(refreshSummary);
      runtime.summaryObserver.observe(summaryRoot, { subtree: true, childList: true });
    }
    const accountRoot = document.getElementById('nav-accounts');
    if (accountRoot) {
      runtime.accountObserver = new MutationObserver(() => render(runtime));
      runtime.accountObserver.observe(accountRoot, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    }
    document.addEventListener('input', refreshSummary, true);
    document.addEventListener('change', refreshSummary, true);
    document.addEventListener('click', () => queueMicrotask(() => { refreshSummary(); render(runtime); }), true);

    runtime.clock = setInterval(() => {
      const job = currentJob(runtime);
      if (job?.nextSendAt) render(runtime);
    }, 1000);

    refreshSummary();
    render(runtime);
    window.__geekBroadcastJobRuntime = runtime;
  }

  return Object.freeze({ visibleFor, formatScheduledAt, failureRows, failureCsv, sendSummaryText, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastJobController.install(), { once: true });
  else window.GeekBroadcastJobController.install();
}
