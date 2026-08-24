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

  function targetContext(job) {
    const targets = Array.isArray(job?.targets) ? job.targets : [];
    const current = Math.max(0, Number(job?.current) || 0);
    const total = Math.max(0, Number(job?.total) || targets.length);
    const state = String(job?.state || '');
    const nameAt = index => String(targets[index]?.name || targets[index]?.id || '').trim();

    if (!total || !targets.length) return { label: '发送状态', value: state === 'scheduled' ? '等待计划时间' : '正在准备发送对象' };
    if (state === 'scheduled') return { label: '首个对象', value: nameAt(0) || '已固定发送对象' };
    if (state === 'queued') return { label: '队列状态', value: '等待当前账号上一任务完成' };
    if (state === 'paused') return { label: '暂停位置', value: nameAt(Math.min(current, targets.length - 1)) || `${current} / ${total}` };
    if (state === 'stopping') return { label: '停止位置', value: nameAt(Math.min(current, targets.length - 1)) || `${current} / ${total}` };
    if (TERMINAL.has(state)) {
      const last = current > 0 ? nameAt(Math.min(current - 1, targets.length - 1)) : '';
      return { label: '最后处理', value: last || '任务已结束' };
    }
    if (job?.nextSendAt && current < targets.length) return { label: '下一对象', value: nameAt(current) || `${current + 1} / ${total}` };
    return { label: '当前对象', value: nameAt(Math.min(current, targets.length - 1)) || `${Math.min(current + 1, total)} / ${total}` };
  }

  function injectStyles() {
    if (document.getElementById('broadcast-job-style')) return;
    const style = document.createElement('style');
    style.id = 'broadcast-job-style';
    style.textContent = `
      /* The editor is a workspace side sheet: existing broadcast DOM/logic stays intact,
         but the chat remains visible and pointer-accessible outside the sheet. */
      #broadcast-overlay{background:transparent!important;backdrop-filter:none!important;justify-content:flex-end!important;align-items:flex-start!important;padding:52px 12px 12px!important;pointer-events:none!important}
      #broadcast-overlay .bc-dialog{pointer-events:auto!important;width:min(520px,calc(100vw - 112px))!important;height:calc(100vh - 64px)!important;max-height:none!important;margin:0!important;border-radius:12px!important;box-shadow:0 18px 54px rgba(0,0,0,.38)!important}
      #broadcast-overlay .bc-body{max-height:none!important;flex:1 1 auto!important}
      #broadcast-overlay .bc-header{min-height:44px!important;padding:0 14px!important}
      #broadcast-overlay .bc-footer{flex-shrink:0}
      #broadcast-overlay .bc-header__heading small{display:block;margin-top:1px;color:var(--text-tertiary);font-size:10.5px;font-weight:400}
      #broadcast-overlay .bc-header__close{margin-left:auto}
      @media (max-width:860px){#broadcast-overlay{padding:46px 6px 6px!important}#broadcast-overlay .bc-dialog{width:min(520px,calc(100vw - 12px))!important;height:calc(100vh - 52px)!important}}

      #broadcast-job-bar{position:fixed;top:52px;right:18px;z-index:88;width:min(390px,calc(100vw - 36px));padding:12px 13px;border:1px solid var(--border-standard);border-radius:12px;background:color-mix(in srgb,var(--bg-surface) 95%,transparent);box-shadow:0 16px 42px rgba(0,0,0,.34);backdrop-filter:blur(18px);color:var(--text-primary);font:12px/1.4 var(--font-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif)}
      #broadcast-job-bar.hidden{display:none!important}.bc-job-head{display:flex;align-items:center;gap:8px}.bc-job-dot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft);flex:0 0 auto}
      #broadcast-job-bar[data-state="paused"] .bc-job-dot{background:#f6b94a;box-shadow:0 0 0 3px rgba(246,185,74,.14)}#broadcast-job-bar[data-state="failed"] .bc-job-dot{background:#ff7066;box-shadow:0 0 0 3px rgba(255,112,102,.14)}#broadcast-job-bar[data-state="completed"] .bc-job-dot{background:#50c878;box-shadow:0 0 0 3px rgba(80,200,120,.14)}
      .bc-job-title{font-size:12.5px;font-weight:650;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bc-job-close{border:0;background:transparent;color:var(--text-tertiary);font-size:17px;line-height:1;cursor:pointer;padding:2px 4px;border-radius:5px}.bc-job-close:hover{background:var(--bg-hover);color:var(--text-primary)}
      .bc-job-account{margin:4px 0 0 15px;color:var(--text-tertiary);font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bc-job-meta{margin:3px 0 0 15px;color:var(--text-secondary);font-size:11px}.bc-job-progress{height:5px;margin:9px 0 0 15px;border-radius:999px;background:var(--bg-elevated);overflow:hidden}.bc-job-progress>i{display:block;height:100%;width:0;background:var(--accent);transition:width .25s ease}
      .bc-job-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin:9px 0 0 15px}.bc-job-stat{min-width:0;padding:5px 6px;border:1px solid var(--border-subtle);border-radius:7px;background:var(--bg-elevated)}.bc-job-stat small{display:block;color:var(--text-tertiary);font-size:9.5px;white-space:nowrap}.bc-job-stat strong{display:block;margin-top:1px;color:var(--text-primary);font-size:11px;font-weight:650;overflow:hidden;text-overflow:ellipsis}
      .bc-job-activity{display:flex;align-items:center;gap:8px;margin:8px 0 0 15px;padding:7px 8px;border-radius:7px;background:color-mix(in srgb,var(--accent) 6%,var(--bg-elevated));min-width:0}.bc-job-activity-label{color:var(--text-tertiary);font-size:10px;white-space:nowrap}.bc-job-activity-value{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary);font-size:11px;font-weight:550}
      .bc-job-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:9px}.bc-job-actions button{height:28px;padding:3px 9px;border:1px solid var(--border-standard);border-radius:6px;background:var(--bg-elevated);color:var(--text-secondary);font-size:11px;cursor:pointer}.bc-job-actions button:hover{color:var(--text-primary);background:var(--bg-hover)}.bc-job-actions .danger{color:#ff7d74}.bc-job-actions [data-act="dismiss"]{background:var(--accent);border-color:var(--accent);color:#fff}.bc-job-actions [data-act="dismiss"]:hover{background:var(--accent-hover);color:#fff}
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

  function createStat(label, action) {
    const box = document.createElement('div');
    box.className = 'bc-job-stat';
    box.dataset.stat = action;
    const caption = document.createElement('small');
    caption.textContent = label;
    const value = document.createElement('strong');
    value.textContent = '0';
    box.append(caption, value);
    return box;
  }

  function ensureBar(runtime) {
    let bar = document.getElementById('broadcast-job-bar');
    if (bar) return bar;

    bar = document.createElement('aside');
    bar.id = 'broadcast-job-bar';
    bar.className = 'hidden';
    bar.setAttribute('aria-live', 'polite');
    bar.setAttribute('aria-label', '群发任务');

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
    close.title = '关闭任务';
    close.setAttribute('aria-label', '关闭群发任务');
    close.textContent = '×';
    head.append(dot, title, close);

    const account = document.createElement('div');
    account.className = 'bc-job-account';
    const meta = document.createElement('div');
    meta.className = 'bc-job-meta';
    const progress = document.createElement('div');
    progress.className = 'bc-job-progress';
    progress.appendChild(document.createElement('i'));

    const stats = document.createElement('div');
    stats.className = 'bc-job-stats';
    stats.append(createStat('进度', 'progress'), createStat('成功', 'ok'), createStat('失败', 'fail'), createStat('剩余', 'remaining'));

    const activity = document.createElement('div');
    activity.className = 'bc-job-activity';
    const activityLabel = document.createElement('span');
    activityLabel.className = 'bc-job-activity-label';
    const activityValue = document.createElement('span');
    activityValue.className = 'bc-job-activity-value';
    activity.append(activityLabel, activityValue);

    const failureBox = document.createElement('div');
    failureBox.className = 'bc-job-failures hidden';

    const actions = document.createElement('div');
    actions.className = 'bc-job-actions';
    const pause = createButton('pause', '暂停');
    const stop = createButton('stop', '停止后续发送', 'danger');
    const failures = createButton('failures', '查看失败', 'hidden');
    const dismiss = createButton('dismiss', '关闭', 'hidden');
    actions.append(pause, stop, failures, dismiss);
    bar.append(head, account, meta, progress, stats, activity, failureBox, actions);
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
      if (!job) return;
      const details = Array.isArray(job.failed)
        ? job.failed.map(item => item?.message || item?.reason || String(item || '')).filter(Boolean)
        : [];
      const expanded = bar.dataset.failureExpanded === job.id;
      if (expanded) {
        bar.dataset.failureExpanded = '';
        failureBox.classList.add('hidden');
        return;
      }
      setTextIfChanged(failureBox, details.length ? details.join('\n') : '没有可用的失败明细。');
      bar.dataset.failureExpanded = job.id;
      failureBox.classList.remove('hidden');
    };

    function dismissCurrent() {
      const job = currentJob(runtime);
      if (!job || !TERMINAL.has(job.state)) return;
      try { runtime.manager.dismiss(job.id); } catch (_) {}
      bar.dataset.failureExpanded = '';
      render(runtime);
    }

    close.onclick = dismissCurrent;
    dismiss.onclick = dismissCurrent;

    return bar;
  }

  function currentJob(runtime) {
    return runtime.manager?.getCurrent(activeAccountId()) || null;
  }

  function setTextIfChanged(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function setDataIfChanged(node, key, value) {
    if (!node) return;
    const next = String(value || '');
    if (node.dataset[key] !== next) node.dataset[key] = next;
  }

  function render(runtime) {
    const bar = ensureBar(runtime);
    const accountId = activeAccountId();
    const job = currentJob(runtime);
    const visible = visibleFor(job, accountId);
    bar.classList.toggle('hidden', !visible);
    if (!visible) return;

    const title = bar.querySelector('.bc-job-title');
    const account = bar.querySelector('.bc-job-account');
    const meta = bar.querySelector('.bc-job-meta');
    const fill = bar.querySelector('.bc-job-progress>i');
    const progressStat = bar.querySelector('[data-stat="progress"] strong');
    const okStat = bar.querySelector('[data-stat="ok"] strong');
    const failStat = bar.querySelector('[data-stat="fail"] strong');
    const remainingStat = bar.querySelector('[data-stat="remaining"] strong');
    const activityLabel = bar.querySelector('.bc-job-activity-label');
    const activityValue = bar.querySelector('.bc-job-activity-value');
    const pause = bar.querySelector('[data-act="pause"]');
    const stop = bar.querySelector('[data-act="stop"]');
    const failures = bar.querySelector('[data-act="failures"]');
    const dismiss = bar.querySelector('[data-act="dismiss"]');
    const close = bar.querySelector('.bc-job-close');
    const failureBox = bar.querySelector('.bc-job-failures');

    const current = Math.max(0, Number(job.current) || 0);
    const total = Math.max(0, Number(job.total) || 0);
    const ok = Math.max(0, Number(job.ok) || 0);
    const fail = Math.max(0, Number(job.fail) || 0);
    const remaining = Math.max(0, total - current);
    const percent = total ? Math.min(100, Math.round(current / total * 100)) : 0;
    fill.style.width = `${percent}%`;
    setDataIfChanged(bar, 'state', job.state);
    setTextIfChanged(account, job.accountName ? `发送账号 · ${job.accountName}` : '当前账号的群发任务');
    setTextIfChanged(progressStat, `${current}/${total}`);
    setTextIfChanged(okStat, String(ok));
    setTextIfChanged(failStat, String(fail));
    setTextIfChanged(remainingStat, String(remaining));
    const context = targetContext(job);
    setTextIfChanged(activityLabel, context.label);
    setTextIfChanged(activityValue, context.value);
    failureBox.classList.toggle('hidden', bar.dataset.failureExpanded !== job.id);

    if (job.state === 'completed') {
      setTextIfChanged(title, fail ? `群发完成 · ${percent}%` : '群发完成');
      setTextIfChanged(meta, fail ? `成功 ${ok} · 失败 ${fail} · 共 ${total}` : `全部发送成功 · ${total} 个对象`);
    } else if (job.state === 'failed') {
      setTextIfChanged(title, '群发异常结束');
      setTextIfChanged(meta, `成功 ${ok} · 失败 ${fail} · 可查看失败原因`);
    } else if (job.state === 'stopped') {
      setTextIfChanged(title, '群发已停止');
      setTextIfChanged(meta, `成功 ${ok} · 失败 ${fail} · 未发送 ${remaining}`);
    } else if (job.state === 'stopping') {
      setTextIfChanged(title, `正在停止 · ${current} / ${total}`);
      setTextIfChanged(meta, '当前发送步骤结束后不再继续');
    } else if (job.state === 'paused') {
      setTextIfChanged(title, `群发已暂停 · ${current} / ${total}`);
      setTextIfChanged(meta, `成功 ${ok} · 失败 ${fail} · 剩余 ${remaining}`);
    } else if (job.state === 'scheduled') {
      setTextIfChanged(title, `群发已定时 · ${total} 个聊天`);
      setTextIfChanged(meta, `${formatScheduledAt(job.scheduledAt)} · 已固定 ${total} 个发送对象`);
    } else if (job.state === 'queued') {
      setTextIfChanged(title, `群发排队中 · ${total} 个聊天`);
      setTextIfChanged(meta, '等待当前账号的上一任务完成');
    } else {
      const nextSeconds = job.nextSendAt ? Math.max(0, Math.ceil((job.nextSendAt - Date.now()) / 1000)) : null;
      setTextIfChanged(title, total ? `正在群发 · ${current} / ${total}` : '正在准备群发');
      setTextIfChanged(meta, nextSeconds != null
        ? `成功 ${ok} · 失败 ${fail} · 下一条 ${nextSeconds} 秒后`
        : `成功 ${ok} · 失败 ${fail} · 正在处理`);
    }

    const terminal = TERMINAL.has(job.state);
    const pending = PENDING.has(job.state);
    pause.classList.toggle('hidden', terminal || pending || job.state === 'stopping');
    setTextIfChanged(pause, job.state === 'paused' ? '继续发送' : '暂停');
    stop.classList.toggle('hidden', terminal);
    setTextIfChanged(stop, job.state === 'scheduled' ? '取消定时' : job.state === 'queued' ? '取消排队' : '停止后续发送');
    failures.classList.toggle('hidden', !(terminal && (fail > 0 || job.state === 'failed')));
    dismiss.classList.toggle('hidden', !terminal);
    close.style.visibility = terminal ? 'visible' : 'hidden';
    if (!terminal) bar.dataset.failureExpanded = '';
  }

  function applyCopyAndSemantics() {
    const overlay = document.getElementById('broadcast-overlay');
    const dialog = overlay?.querySelector('.bc-dialog');
    if (dialog) dialog.setAttribute('aria-modal', 'false');
    if (overlay) overlay.dataset.workspacePanel = '1';
    const headerHint = overlay?.querySelector('.bc-header__heading small');
    if (headerHint) setTextIfChanged(headerHint, '编辑群发 · 聊天页面保持可见');

    const message = document.getElementById('broadcast-message');
    if (message) message.placeholder = '输入要发送的消息，可用下方变量插入联系人名称或问候语';
    const addFile = document.getElementById('broadcast-add-file');
    const fileLabel = addFile?.closest('label');
    if (fileLabel) {
      fileLabel.classList.add('bc-action-trigger');
      const text = fileLabel.querySelector('.bc-switch-label');
      if (text) setTextIfChanged(text, '＋ 添加附件 · 最多10个，单个512 MiB');
    }
    const addVcard = document.getElementById('broadcast-add-vcard');
    const vcardLabel = addVcard?.closest('label');
    if (vcardLabel) {
      vcardLabel.classList.add('bc-action-trigger');
      const text = vcardLabel.querySelector('.bc-switch-label');
      if (text) setTextIfChanged(text, '＋ 添加电子名片');
    }
    const saveGroup = document.getElementById('broadcast-save-group');
    if (saveGroup) setTextIfChanged(saveGroup, '保存当前选择');
    const showAll = document.getElementById('broadcast-show-all-groups');
    if (showAll) setTextIfChanged(showAll, '清除集合筛选');
    document.querySelectorAll('input[name="bc-sendto"]').forEach(input => {
      const text = input.closest('label')?.querySelector('span');
      if (!text) return;
      if (input.value === 'exclude-contacts') setTextIfChanged(text, '排除指定联系人（过滤条件）');
      if (input.value === 'exclude-groups') setTextIfChanged(text, '排除指定群组（过滤条件）');
    });
  }

  function selectedCount() {
    const mode = document.querySelector('input[name="bc-sendto"]:checked')?.value || 'custom';
    if (mode === 'paste') return Number(document.getElementById('bc-paste-total')?.textContent) || 0;
    if (mode === 'excel') {
      const text = document.getElementById('bc-excel-meta')?.textContent || '';
      return Number((text.match(/已导入\s*(\d+)/) || [])[1]) || 0;
    }
    return document.querySelectorAll('#bc-selected-chips .bc-selected-chip').length;
  }

  function refreshSummary() {
    const send = document.getElementById('broadcast-send');
    const note = document.querySelector('#broadcast-overlay .bc-footer-note');
    if (!send || !note) return;
    const count = selectedCount();
    const files = document.querySelectorAll('#broadcast-files .bf-item').length;
    const lo = document.getElementById('broadcast-interval-min')?.value || '5';
    const hi = document.getElementById('broadcast-interval-max')?.value || Math.max(10, Number(lo) || 5);
    setTextIfChanged(send, count ? `发送给 ${count} 个聊天` : '请选择发送对象');
    setTextIfChanged(note, `${count ? `${count} 个对象 · ` : ''}${files ? `${files} 个附件 · ` : ''}间隔 ${lo}–${hi} 秒`);
  }

  function installAlertFilter() {
    if (window.__geekBroadcastAlertFilter) return;
    window.__geekBroadcastAlertFilter = true;
    const nativeAlert = window.alert.bind(window);
    window.alert = message => {
      const text = String(message || '');
      if (text.startsWith('已保存群组标签')) return;
      if (text.startsWith('群发完成：')) return;
      nativeAlert(message);
    };
  }

  function install() {
    if (typeof document === 'undefined' || window.__geekBroadcastJobInstalled) return;
    const manager = window.GeekBroadcastJobs;
    if (!manager) return;
    window.__geekBroadcastJobInstalled = true;

    injectStyles();
    applyCopyAndSemantics();
    installAlertFilter();

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

  return Object.freeze({ visibleFor, formatScheduledAt, targetContext, setTextIfChanged, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastJobController.install(), { once: true });
  else window.GeekBroadcastJobController.install();
}
