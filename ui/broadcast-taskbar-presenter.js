(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastTaskbarPresenter = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function activeAccountId() {
    return document.querySelector('.nav-account.active[data-id]')?.dataset.id || '';
  }

  function formatSchedule(value) {
    const date = new Date(Number(value));
    if (!Number.isFinite(date.getTime())) return '计划时间待确认';
    return date.toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function render(manager) {
    const bar = document.getElementById('broadcast-job-bar');
    if (!bar) return;
    const job = manager.getCurrent(activeAccountId());
    if (!job || (job.state !== 'scheduled' && job.state !== 'queued')) return;
    const title = bar.querySelector('.bc-job-title');
    const meta = bar.querySelector('.bc-job-meta');
    const fill = bar.querySelector('.bc-job-progress>i');
    const pause = bar.querySelector('[data-act="pause"]');
    const stop = bar.querySelector('[data-act="stop"]');
    const failures = bar.querySelector('[data-act="failures"]');
    const close = bar.querySelector('.bc-job-close');
    if (fill) fill.style.width = '0%';
    if (failures) failures.classList.add('hidden');
    if (close) close.style.visibility = 'hidden';
    if (pause) pause.classList.add('hidden');
    if (stop) {
      stop.classList.remove('hidden');
      stop.textContent = job.state === 'queued' ? '取消排队' : '取消定时';
    }
    if (job.state === 'queued') {
      if (title) title.textContent = `群发排队中 · ${job.total} 个聊天`;
      if (meta) meta.textContent = '等待当前账号的上一任务完成';
    } else {
      if (title) title.textContent = `已定时 · ${formatSchedule(job.scheduledAt)}`;
      if (meta) meta.textContent = `已固定 ${job.total} 个发送对象`;
    }
  }

  function install() {
    if (typeof document === 'undefined' || window.__geekBroadcastTaskbarPresenterInstalled) return;
    const manager = window.GeekBroadcastJobs;
    if (!manager) return;
    window.__geekBroadcastTaskbarPresenterInstalled = true;
    manager.subscribe(() => queueMicrotask(() => render(manager)));
    const observer = new MutationObserver(() => queueMicrotask(() => render(manager)));
    observer.observe(document.getElementById('nav-accounts') || document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
    queueMicrotask(() => render(manager));
  }

  return Object.freeze({ formatSchedule, render, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastTaskbarPresenter.install(), { once: true });
  else window.GeekBroadcastTaskbarPresenter.install();
}
