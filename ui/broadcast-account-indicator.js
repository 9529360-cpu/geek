(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastAccountIndicator = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function labelFor(job) {
    if (!job) return '';
    if (job.state === 'running' || job.state === 'starting') return '群发中';
    if (job.state === 'paused') return '已暂停';
    if (job.state === 'stopping') return '停止中';
    if (job.state === 'queued') return '排队中';
    if (job.state === 'scheduled') return '已定时';
    if (job.state === 'failed' || (job.state === 'completed' && job.fail > 0)) return '有失败';
    if (job.state === 'completed') return '已完成';
    if (job.state === 'stopped') return '已停止';
    return '';
  }

  function render(manager, rootNode = document) {
    rootNode.querySelectorAll('.nav-account[data-id]').forEach(item => {
      const accountId = item.dataset.id;
      const job = manager.getCurrent(accountId);
      let badge = item.querySelector('.bc-account-job-state');
      const label = labelFor(job);
      if (!label || job?.dismissed) {
        badge?.remove();
        item.removeAttribute('data-broadcast-state');
        return;
      }
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'bc-account-job-state';
        const main = item.querySelector('.nav-account-main') || item;
        main.appendChild(badge);
      }
      item.dataset.broadcastState = job.state;
      badge.dataset.state = job.state;
      badge.textContent = label;
      badge.title = job.total ? `${label} · ${job.current || 0}/${job.total}` : label;
    });
  }

  function install() {
    if (typeof document === 'undefined' || window.__geekBroadcastAccountIndicatorInstalled) return;
    const manager = window.GeekBroadcastJobs;
    if (!manager) return;
    window.__geekBroadcastAccountIndicatorInstalled = true;
    const style = document.createElement('style');
    style.id = 'broadcast-account-indicator-style';
    style.textContent = `
      .bc-account-job-state{margin-left:auto;flex:0 0 auto;font-size:9.5px;line-height:17px;padding:0 5px;border-radius:999px;color:var(--text-tertiary);background:var(--bg-elevated);border:1px solid var(--border-standard)}
      .bc-account-job-state[data-state="running"],.bc-account-job-state[data-state="starting"]{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 35%,var(--border-standard));background:var(--accent-soft)}
      .bc-account-job-state[data-state="paused"],.bc-account-job-state[data-state="queued"],.bc-account-job-state[data-state="scheduled"]{color:#d6a84a}
      .bc-account-job-state[data-state="failed"]{color:#ff7d74}.nav-account[data-broadcast-state="completed"] .bc-account-job-state{opacity:.72}
    `;
    document.head.appendChild(style);
    const rerender = () => render(manager, document);
    manager.subscribe(rerender);
    const observer = new MutationObserver(rerender);
    const sidebar = document.getElementById('nav-accounts') || document.body;
    observer.observe(sidebar, { childList: true, subtree: true });
    rerender();
  }

  return Object.freeze({ labelFor, render, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastAccountIndicator.install(), { once: true });
  else window.GeekBroadcastAccountIndicator.install();
}
