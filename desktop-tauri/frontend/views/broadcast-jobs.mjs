import { currentJob, terminal, pending, jobSummary, jobLabel, resultRows, formatTime } from '../models/broadcast.mjs';
import { errorMessage } from '../models/broadcast-status.mjs';
import { element, button, wire, hidden, statusNode, unavailable } from './broadcast-elements.mjs';

export function createBroadcastJobs({ document, window, onControl, onOpen, onClose, onViewAccount, requestLayout }) {
  const $ = (id) => document.getElementById(id);
  let jobs = [];
  let activeId = null;
  let scope = 'current';
  let blocked = false;
  let pendingControls = new Set();
  let detailsId = null;
  let centerSignature = '';
  let layoutSignature = 'false:0';
  let layoutEpoch = 0;
  let disposed = false;
  const taskButton = button(document, '', onOpen, 'bc-task-center-button');
  taskButton.id = 'broadcast-task-center-button';
  taskButton.setAttribute('aria-label', '打开群发指挥台');
  const taskCount = element(document, 'span', 'bc-task-center-count', '0');
  taskCount.setAttribute('aria-hidden', 'true');
  taskButton.append(element(document, 'span', '', '任务'), taskCount);
  $('btn-broadcast').after(taskButton);

  const bar = element(document, 'aside', 'hidden');
  bar.id = 'broadcast-job-bar';
  bar.setAttribute('aria-label', '当前账号群发任务');
  const head = element(document, 'div', 'bc-job-head');
  const title = element(document, 'strong', 'bc-job-title');
  title.setAttribute('aria-live', 'polite');
  const close = button(document, '×', () => controlCurrent('dismiss'), 'bc-job-close');
  close.setAttribute('aria-label', '关闭已结束的群发任务');
  head.append(element(document, 'span', 'bc-job-dot'), title, close);
  const meta = element(document, 'div', 'bc-job-meta');
  const issue = element(document, 'div', 'bc-job-hard-failure');
  const feedback = statusNode(document, 'broadcast-job-feedback', 'bc-job-feedback');
  const progress = element(document, 'div', 'bc-job-progress');
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-label', '当前账号群发进度');
  const fill = element(document, 'i'); progress.append(fill);
  const failureBox = element(document, 'div', 'bc-job-failures hidden');
  const actions = element(document, 'div', 'bc-job-actions');
  const resumable = (job) => Boolean(job && (job.state === 'paused' || job.storageBlocked || job.reviewRequired));
  const pause = button(document, '暂停', () => controlCurrent(resumable(currentJob(jobs, activeId)) ? 'resume' : 'pause'), '');
  pause.dataset.act = 'pause';
  const stop = button(document, '停止后续发送', () => controlCurrent('stop'), ''); stop.dataset.act = 'stop';
  const failures = button(document, '查看发送明细', () => {
    const job = currentJob(jobs, activeId);
    detailsId = detailsId === job?.id ? null : job?.id; renderBar();
  }, ''); failures.dataset.act = 'failures';
  const exportFailures = button(document, '导出失败 CSV · 尚未迁移', () => {}, '');
  unavailable(exportFailures, '失败名单文件导出尚未迁移');
  actions.append(pause, stop, failures, exportFailures);
  bar.append(head, meta, issue, feedback, progress, failureBox, actions);
  document.body.append(bar);

  const overlay = element(document, 'div', 'bc-task-center-overlay hidden');
  overlay.id = 'broadcast-task-center-overlay';
  const dialog = element(document, 'section', 'bc-task-center');
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', '群发指挥台');
  const centerHead = element(document, 'header', 'bc-task-center-head');
  const heading = element(document, 'div', 'bc-task-center-title');
  const subtitle = element(document, 'small');
  heading.append(element(document, 'strong', '', '群发指挥台'), subtitle);
  const centerClose = button(document, '×', onClose, ''); centerClose.id = 'broadcast-task-center-close';
  centerClose.setAttribute('aria-label', '关闭群发指挥台'); centerHead.append(heading, centerClose);
  const toolbar = element(document, 'div', 'bc-task-center-toolbar');
  const scopes = element(document, 'div', 'bc-task-scope'); scopes.setAttribute('role', 'group'); scopes.setAttribute('aria-label', '任务范围');
  const scopeButtons = new Map();
  for (const [value, label] of [['current', '当前账号'], ['all', '全部账号']]) {
    const node = button(document, label, () => { scope = value; centerSignature = ''; renderCenter(); }, '');
    node.dataset.scope = value; scopeButtons.set(value, node); scopes.append(node);
  }
  toolbar.append(scopes, element(document, 'span', 'bc-task-center-hint', '任务归属不会随页面切换改变'));
  const summary = element(document, 'div', 'bc-task-summary');
  const metrics = new Map();
  for (const [key, label] of [['active', '活动任务'], ['running', '执行中'], ['pending', '排队 / 定时'], ['issues', '有异常']]) {
    const item = element(document, 'div', 'bc-task-summary-item');
    if (key === 'issues') item.dataset.tone = 'issue';
    const value = element(document, 'strong', '', '0'); value.dataset.summary = key;
    item.append(element(document, 'small', '', label), value); metrics.set(key, value); summary.append(item);
  }
  const centerFeedback = statusNode(document, 'broadcast-task-feedback', 'bc-task-feedback');
  const body = element(document, 'div', 'bc-task-center-body');
  dialog.append(centerHead, toolbar, summary, centerFeedback, body); overlay.append(dialog); document.body.append(overlay);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) onClose(); });

  function controlCurrent(action) {
    const job = currentJob(jobs, activeId);
    if (job) onControl(job.id, action);
  }

  function notifyLayout() {
    const visible = !bar.classList.contains('hidden');
    const signature = `${visible}:${visible ? Math.ceil(bar.getBoundingClientRect().height) : 0}`;
    if (signature === layoutSignature || disposed) return;
    layoutSignature = signature;
    const epoch = ++layoutEpoch;
    if (visible) bar.classList.add('bc-layout-pending');
    Promise.resolve().then(requestLayout).then(() => {
      if (!disposed && epoch === layoutEpoch) bar.classList.remove('bc-layout-pending');
    }).catch(() => {
      taskButton.title = '任务条布局尚未就绪，请打开群发指挥台';
    });
  }
  const Resize = window.ResizeObserver;
  const observer = typeof Resize === 'function' ? new Resize(notifyLayout) : null;
  observer?.observe(bar);

  function outcomeText(status) {
    return { confirmed: '已确认发送', notSubmitted: '未提交', uncertain: '结果不确定' }[status] || '结果未知';
  }

  function resultList(job, all = false) {
    const list = element(document, 'div', 'bc-task-results');
    const rows = all && job.results?.length ? job.results.map((result) => ({ name: job.targets?.[result.index]?.name || `对象 ${result.index + 1}`,
      status: result.outcome?.status, code: result.outcome?.code })) : resultRows(job);
    for (const row of rows) {
      const line = element(document, 'div', 'bc-task-result'); line.dataset.outcome = row.status;
      line.textContent = `${row.name} · ${outcomeText(row.status)}${row.code ? `：${errorMessage(row.code)}` : ''}`;
      list.append(line);
    }
    return list;
  }

  function renderBar() {
    const job = currentJob(jobs, activeId);
    hidden(bar, !job);
    if (!job) { notifyLayout(); return; }
    bar.dataset.jobId = job.id;
    title.textContent = `${jobLabel(job)} · ${job.current || 0}/${job.total || 0}`;
    const seconds = job.state === 'running' && job.nextSendAt ? Math.max(0, Math.ceil((job.nextSendAt - Date.now()) / 1000)) : null;
    meta.textContent = `成功 ${job.ok || 0} · 未提交 ${job.fail || 0} · 未确认 ${job.uncertain || 0}`
      + (seconds !== null ? ` · 下一条 ${seconds} 秒后` : job.state === 'scheduled' ? ` · ${formatTime(job.scheduledAt)}` : '');
    issue.textContent = job.storageBlocked
      ? '任务检查点未能保存，已停止自动执行。请检查本地存储后恢复；结果不确定的对象将跳过。'
      : job.reviewRequired
      ? '上次执行已中断。结果不确定的对象不会重发；请先核对，再继续剩余未发送对象。'
      : job.state === 'stopping' ? '当前步骤结束后不再继续发送。'
        : job.state === 'queued' ? '等待当前账号的上一任务结束。' : job.lastIssue ? errorMessage(job.lastIssue) : '';
    hidden(issue, !issue.textContent);
    const total = Math.max(0, Number(job.total) || 0);
    const current = Math.max(0, Number(job.current) || 0);
    fill.style.width = `${total ? Math.min(100, current / total * 100) : 0}%`;
    progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', String(total));
    progress.setAttribute('aria-valuenow', String(current));
    const finished = terminal.has(job.state);
    const pendingControl = pendingControls.has(job.id);
    hidden(pause, !['running', 'paused'].includes(job.state) && !resumable(job));
    pause.textContent = job.storageBlocked ? '恢复任务' : resumable(job) ? (job.reviewRequired ? '继续剩余未发送对象' : '继续') : '暂停';
    hidden(stop, finished);
    stop.textContent = job.state === 'scheduled' ? '取消定时' : job.state === 'queued' ? '取消排队' : '停止后续发送';
    hidden(close, !finished);
    hidden(failures, !job.results?.length && !job.lastIssue);
    hidden(exportFailures, !finished || !resultRows(job).length);
    wire(pause, blocked || pendingControl); wire(stop, blocked || pendingControl || job.state === 'stopping');
    wire(close, blocked || pendingControl); wire(failures, blocked);
    hidden(failureBox, detailsId !== job.id);
    if (detailsId === job.id) failureBox.replaceChildren(resultList(job, true));
    notifyLayout();
  }

  function jobRow(job) {
    const row = element(document, 'article', 'bc-task-row'); row.dataset.jobId = job.id; row.dataset.state = job.state;
    const rowHead = element(document, 'div', 'bc-task-row-head');
    rowHead.append(element(document, 'strong', '', jobLabel(job)));
    if (scope === 'all') rowHead.append(element(document, 'span', 'bc-task-account-name', `${job.accountName || '未命名账号'} · WhatsApp`));
    const rowMeta = element(document, 'div', 'bc-task-row-meta',
      `${job.current || 0}/${job.total || 0} · 成功 ${job.ok || 0} · 未提交 ${job.fail || 0} · 未确认 ${job.uncertain || 0}`
      + (job.scheduledAt ? ` · ${formatTime(job.scheduledAt)}` : ''));
    row.append(rowHead, rowMeta);
    const rowProgress = element(document, 'progress', 'bc-task-progress');
    rowProgress.max = Math.max(1, job.total || 0); rowProgress.value = job.current || 0;
    rowProgress.setAttribute('aria-label', `${jobLabel(job)}进度`); row.append(rowProgress);
    if (job.storageBlocked || job.reviewRequired || job.lastIssue) row.append(element(document, 'div', 'bc-task-row-error', job.storageBlocked
      ? '任务检查点未能保存，已停止自动执行。请检查本地存储后恢复，结果不确定的对象会跳过。'
      : job.reviewRequired ? '执行已中断，未自动继续。结果不确定的对象会跳过；请先在平台核对。' : errorMessage(job.lastIssue)));
    if (job.results?.length) {
      const details = element(document, 'details');
      details.append(element(document, 'summary', '', '查看发送明细'), resultList(job, true)); row.append(details);
    }
    const rowActions = element(document, 'div', 'bc-task-actions');
    const add = (action, label) => {
      const node = button(document, label, () => onControl(job.id, action), '');
      node.dataset.jobId = job.id; node.dataset.action = action;
      wire(node, blocked || pendingControls.has(job.id)); rowActions.append(node);
    };
    if (scope === 'all') {
      const view = button(document, activeId === job.accountId ? '正在查看此账号' : '查看账号', () => onViewAccount(job.accountId), 'bc-task-view-account');
      wire(view, blocked || activeId === job.accountId); rowActions.append(view);
    }
    if (job.state === 'running' && !resumable(job)) add('pause', '暂停');
    if (resumable(job)) add('resume', job.storageBlocked ? '恢复任务' : job.reviewRequired ? '继续剩余未发送对象' : '继续');
    if (!terminal.has(job.state) && job.state !== 'stopping') add('stop', pending.has(job.state) ? '取消任务' : '停止后续发送');
    if (terminal.has(job.state)) add('dismiss', '关闭记录');
    row.append(rowActions); return row;
  }

  function renderCenter() {
    const scoped = jobs.filter((job) => !job.dismissed && (scope === 'all' || job.accountId === activeId));
    const counts = jobSummary(scoped);
    for (const [key, node] of metrics) node.textContent = String(counts[key]);
    for (const [value, node] of scopeButtons) { node.setAttribute('aria-pressed', String(value === scope)); wire(node, blocked); }
    subtitle.textContent = scope === 'all' ? `${new Set(scoped.map((job) => job.accountId)).size} 个账号有任务`
      : scoped[0]?.accountName || '当前账号的群发任务';
    wire(centerClose, blocked);
    if (overlay.classList.contains('hidden')) return;
    const signature = JSON.stringify([scope, activeId, scoped, blocked, [...pendingControls]]);
    if (signature === centerSignature) return;
    centerSignature = signature;
    const focused = document.activeElement?.dataset;
    const focusedJob = focused?.jobId; const focusedAction = focused?.action;
    body.replaceChildren();
    for (const job of scoped.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 40)) body.append(jobRow(job));
    if (!scoped.length) body.append(element(document, 'div', 'bc-task-empty', scope === 'all' ? '暂无群发任务' : '当前账号暂无群发任务'));
    if (scoped.length > 40) body.append(element(document, 'div', 'bc-task-scope-note', '仅显示最近 40 个任务'));
    if (focusedJob) [...body.querySelectorAll('button')].find((node) => node.dataset.jobId === focusedJob && node.dataset.action === focusedAction)?.focus();
  }

  return {
    render(next, currentAccountId, shellBusy, controls, apiAvailable) {
      jobs = next; activeId = currentAccountId; blocked = shellBusy || !apiAvailable; pendingControls = controls;
      const counts = jobSummary(jobs);
      taskButton.dataset.activeCount = String(counts.active); taskCount.textContent = counts.active > 99 ? '99+' : String(counts.active);
      wire(taskButton, blocked); renderBar(); renderCenter();
      for (const account of document.querySelectorAll('.nav-account')) {
        const job = currentJob(jobs, account.dataset.id);
        let badge = account.querySelector('.bc-account-job-state');
        if (!job) { badge?.remove(); continue; }
        if (!badge) { badge = element(document, 'span', 'bc-account-job-state'); (account.querySelector('.nav-account-main') || account).append(badge); }
        badge.textContent = job.storageBlocked ? '存储故障' : job.reviewRequired ? '待核对' : jobLabel(job);
        badge.dataset.state = job.storageBlocked ? 'failed' : job.state;
        badge.title = `${jobLabel(job)} · ${job.current || 0}/${job.total || 0}`;
        badge.setAttribute('aria-label', `群发：${badge.title}`);
      }
    },
    opened() { centerSignature = ''; renderCenter(); },
    feedback(message = '') { feedback.textContent = message; centerFeedback.textContent = message; notifyLayout(); },
    dispose() { disposed = true; layoutEpoch += 1; observer?.disconnect(); },
  };
}
