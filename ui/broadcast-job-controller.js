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

  function injectStyles() {
    if (document.getElementById('broadcast-job-style')) return;
    const style = document.createElement('style');
    style.id = 'broadcast-job-style';
    style.textContent = `
      #broadcast-job-bar{position:fixed;top:46px;right:18px;z-index:88;width:min(350px,calc(100vw - 36px));padding:11px 12px;border:1px solid var(--border-standard);border-radius:10px;background:color-mix(in srgb,var(--bg-surface) 94%,transparent);box-shadow:0 14px 38px rgba(0,0,0,.34);backdrop-filter:blur(18px);color:var(--text-primary);font:12px/1.4 var(--font-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif)}
      #broadcast-job-bar.hidden{display:none!important}
      .bc-job-head{display:flex;align-items:center;gap:8px}
      .bc-job-dot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft);flex:0 0 auto}
      .bc-job-title{font-size:12.5px;font-weight:650;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .bc-job-close{border:0;background:transparent;color:var(--text-tertiary);font-size:17px;line-height:1;cursor:pointer;padding:2px 4px;border-radius:5px}
      .bc-job-close:hover{background:var(--bg-hover);color:var(--text-primary)}
      .bc-job-meta{margin:5px 0 0 15px;color:var(--text-tertiary);font-size:11px}
      .bc-job-progress{height:4px;margin:8px 0 0 15px;border-radius:999px;background:var(--bg-elevated);overflow:hidden}
      .bc-job-progress>i{display:block;height:100%;width:0;background:var(--accent);transition:width .25s ease}
      .bc-job-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:9px}
      .bc-job-actions button{height:27px;padding:3px 9px;border:1px solid var(--border-standard);border-radius:6px;background:var(--bg-elevated);color:var(--text-secondary);font-size:11px;cursor:pointer}
      .bc-job-actions button:hover{color:var(--text-primary);background:var(--bg-hover)}
      .bc-job-actions .danger{color:#ff7d74}
      .bc-job-actions [data-act="dismiss"]{background:var(--accent);border-color:var(--accent);color:#fff}
      .bc-job-failures{max-height:150px;overflow:auto;margin:8px 0 0 15px;padding:7px 8px;border-radius:6px;background:var(--bg-elevated);color:var(--text-secondary);font-size:10.5px;white-space:pre-wrap}
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

  function currentJob(runtime) {
    return runtime.manager?.getCurrent(activeAccountId()) || null;
  }

  function dismissCurrent(runtime) {
    const job = currentJob(runtime);
    if (!job || !TERMINAL.has(job.state)) return;
    try { runtime.manager.dismiss(job.id); } catch (_) {}
    render(runtime);
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
    close.title = '关闭';
    close.textContent = '×';
    close.onclick = () => dismissCurrent(runtime);
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
    const dismiss = createButton('dismiss', '关闭', 'hidden');
    dismiss.onclick = () => dismissCurrent(runtime);
    actions.append(pause, stop, failures, dismiss);
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
      const details = Array.isArray(job?.failed)
        ? job.failed.map(item => item?.message || item?.reason || String(item || '')).filter(Boolean)
        : [];
      failureBox.textContent = details.length ? details.join('\n') : '没有可用的失败明细。';
      failureBox.classList.toggle('hidden');
    };

    return bar;
  }

  function render(runtime) {
    const bar = ensureBar(runtime);
    const job = currentJob(runtime);
    const visible = visibleFor(job, activeAccountId());
    bar.classList.toggle('hidden', !visible);
    if (!visible) return;

    const title = bar.querySelector('.bc-job-title');
    const meta = bar.querySelector('.bc-job-meta');
    const fill = bar.querySelector('.bc-job-progress>i');
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
    failures.classList.toggle('hidden', !(terminal && fail > 0));
    dismiss.classList.toggle('hidden', !terminal);
    close.style.visibility = terminal ? 'visible' : 'hidden';
  }

  function closeEditorForNewJob(runtime) {
    const job = currentJob(runtime);
    const jobId = job?.id || '';
    if (jobId && jobId !== runtime.lastJobId) {
      const overlay = document.getElementById('broadcast-overlay');
      if (overlay && !overlay.classList.contains('hidden')) overlay.classList.add('hidden');
    }
    runtime.lastJobId = jobId;
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
    installAlertFilter();

    const runtime = { manager, unsubscribe: null, clock: null, accountObserver: null, lastJobId: '' };
    ensureBar(runtime);
    runtime.lastJobId = currentJob(runtime)?.id || '';
    runtime.unsubscribe = manager.subscribe(() => {
      closeEditorForNewJob(runtime);
      render(runtime);
    });

    const accountRoot = document.getElementById('nav-accounts');
    if (accountRoot) {
      runtime.accountObserver = new MutationObserver(() => render(runtime));
      runtime.accountObserver.observe(accountRoot, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    }
    document.addEventListener('click', () => queueMicrotask(() => render(runtime)), true);

    runtime.clock = setInterval(() => {
      const job = currentJob(runtime);
      if (job?.nextSendAt) render(runtime);
    }, 1000);

    render(runtime);
    window.__geekBroadcastJobRuntime = runtime;
  }

  return Object.freeze({ visibleFor, formatScheduledAt, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastJobController.install(), { once: true });
  else window.GeekBroadcastJobController.install();
}
