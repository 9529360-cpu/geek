(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastJobController = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TERMINAL = new Set(['completed', 'stopped', 'failed']);

  function createJob(accountId, seed = {}) {
    if (typeof window !== 'undefined' && window.GeekBroadcastJobManager?.createJob) {
      return window.GeekBroadcastJobManager.createJob({ accountId, ...seed });
    }
    if (!accountId) throw new TypeError('broadcast job requires accountId');
    return {
      id: seed.id || `bc-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      accountId: String(accountId),
      state: seed.state || 'starting',
      current: Number(seed.current) || 0,
      total: Number(seed.total) || 0,
      ok: Number(seed.ok) || 0,
      fail: Number(seed.fail) || 0,
      failed: Array.isArray(seed.failed) ? seed.failed.slice() : [],
      nextSendAt: seed.nextSendAt ?? null,
      createdAt: seed.createdAt || Date.now(),
      finishedAt: seed.finishedAt || null,
      dismissed: !!seed.dismissed,
    };
  }

  function visibleFor(job, activeAccountId) {
    return !!job && !job.dismissed && String(job.accountId) === String(activeAccountId || '');
  }

  function parseCompletion(text) {
    const value = String(text || '');
    const match = value.match(/完成：成功\s*(\d+)，失败\s*(\d+)/);
    if (!match) return null;
    return { ok: Number(match[1]), fail: Number(match[2]), stopped: value.includes('已停止') };
  }

  function parseProgress(text) {
    const value = String(text || '');
    const match = value.match(/(\d+)\s*\/\s*(\d+)/);
    return match ? { current: Number(match[1]), total: Number(match[2]) } : null;
  }

  function parseHistory(raw) {
    try {
      const value = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function historyEntryMatchesJob(entry, job) {
    if (!entry || !job) return false;
    const time = Number(entry.t) || 0;
    const start = Number(job.createdAt) || 0;
    return time >= Math.max(0, start - 2000)
      && Number(entry.total) === Number(job.total)
      && Number(entry.ok) === Number(job.ok)
      && Number(entry.fail) === Number(job.fail);
  }

  function reconcileHistoryOwner(job, snapshots, currentByAccount) {
    if (!job || !job.accountId) return [];
    const ownerId = String(job.accountId);
    const ownerCurrent = parseHistory(currentByAccount?.[ownerId]);
    if (ownerCurrent.some(entry => historyEntryMatchesJob(entry, job))) return [];
    const candidates = [];
    for (const [accountId, raw] of Object.entries(currentByAccount || {})) {
      if (String(accountId) === ownerId) continue;
      const before = parseHistory(snapshots?.[accountId]);
      const current = parseHistory(raw);
      const tail = current.slice(Math.min(before.length, current.length));
      tail.forEach((entry, index) => {
        if (historyEntryMatchesJob(entry, job)) candidates.push({ accountId: String(accountId), entry, absoluteIndex: before.length + index, current });
      });
    }
    if (candidates.length !== 1) return [];
    const hit = candidates[0];
    const sourceNext = hit.current.filter((_entry, index) => index !== hit.absoluteIndex);
    const ownerNext = [...ownerCurrent, hit.entry];
    if (ownerNext.length > 500) ownerNext.splice(0, ownerNext.length - 500);
    return [
      { accountId: hit.accountId, value: JSON.stringify(sourceNext) },
      { accountId: ownerId, value: JSON.stringify(ownerNext) },
    ];
  }

  function activeAccountId() {
    return document.querySelector('.nav-account.active[data-id]')?.dataset.id || '';
  }

  function injectStyles() {
    if (document.getElementById('broadcast-job-style')) return;
    const style = document.createElement('style');
    style.id = 'broadcast-job-style';
    style.textContent = `
      #broadcast-job-bar{position:fixed;top:46px;right:18px;z-index:88;width:min(340px,calc(100vw - 36px));padding:11px 12px;border:1px solid var(--border-standard);border-radius:10px;background:color-mix(in srgb,var(--bg-surface) 94%,transparent);box-shadow:0 14px 38px rgba(0,0,0,.34);backdrop-filter:blur(18px);color:var(--text-primary);font:12px/1.4 var(--font-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif)}
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

  function ensureBar(runtime) {
    let bar = document.getElementById('broadcast-job-bar');
    if (bar) return bar;
    bar = document.createElement('aside');
    bar.id = 'broadcast-job-bar';
    bar.className = 'hidden';
    bar.setAttribute('aria-live', 'polite');
    bar.innerHTML = `
      <div class="bc-job-head"><span class="bc-job-dot"></span><strong class="bc-job-title">正在群发</strong><button type="button" class="bc-job-close" title="关闭">×</button></div>
      <div class="bc-job-meta"></div><div class="bc-job-progress"><i></i></div>
      <div class="bc-job-failures hidden"></div>
      <div class="bc-job-actions"><button type="button" data-act="pause">暂停</button><button type="button" class="danger" data-act="stop">停止后续发送</button><button type="button" data-act="failures" class="hidden">查看失败</button></div>`;
    document.body.appendChild(bar);
    bar.querySelector('[data-act="pause"]').onclick = async () => {
      const job = currentJob(runtime);
      if (!job) return;
      const action = job.state === 'paused' ? 'resume' : 'pause';
      try { await runtime.manager?.invoke(job.id, action); }
      catch { document.getElementById('broadcast-pause')?.click(); }
      render(runtime);
    };
    bar.querySelector('[data-act="stop"]').onclick = async () => {
      const job = currentJob(runtime);
      if (!job) return;
      try { await runtime.manager?.invoke(job.id, 'stop'); }
      catch { document.getElementById('broadcast-stop')?.click(); }
      render(runtime);
    };
    bar.querySelector('[data-act="failures"]').onclick = () => {
      const job = currentJob(runtime);
      const box = bar.querySelector('.bc-job-failures');
      const details = Array.isArray(job?.failed) && job.failed.length
        ? job.failed.map(item => item.message || item.reason || String(item))
        : (Array.isArray(window.__lastFailDetail) ? window.__lastFailDetail : []);
      box.textContent = details.length ? details.join('\n') : '失败明细暂不可用，可使用失败名单导出。';
      box.classList.toggle('hidden');
    };
    bar.querySelector('.bc-job-close').onclick = () => {
      const job = currentJob(runtime);
      if (!job || !TERMINAL.has(job.state)) return;
      try { runtime.manager?.dismiss(job.id); } catch (_) {}
      render(runtime);
    };
    return bar;
  }

  function currentJob(runtime) {
    const accountId = activeAccountId();
    return runtime.manager?.getCurrent(accountId) || null;
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
    const close = bar.querySelector('.bc-job-close');
    const current = Math.max(0, job.current || 0), total = Math.max(0, job.total || 0);
    fill.style.width = `${total ? Math.min(100, current / total * 100) : 0}%`;
    const nextSeconds = job.nextSendAt ? Math.max(0, Math.ceil((job.nextSendAt - Date.now()) / 1000)) : null;
    if (job.state === 'completed') {
      title.textContent = job.fail ? `群发完成 · 成功 ${job.ok} · 失败 ${job.fail}` : `群发完成 · ${job.ok || total} / ${total}`;
      meta.textContent = job.fail ? '部分消息未发送成功' : '全部发送成功';
    } else if (job.state === 'failed') {
      title.textContent = `群发异常结束 · 成功 ${job.ok} · 失败 ${job.fail}`;
      meta.textContent = '可查看失败明细后重新处理';
    } else if (job.state === 'stopped') {
      title.textContent = `群发已停止 · 成功 ${job.ok}`;
      meta.textContent = total ? `未发送 ${Math.max(0, total - current)} · 共 ${total}` : '已停止后续发送';
    } else if (job.state === 'stopping') {
      title.textContent = `正在停止 ${current} / ${total}`;
      meta.textContent = '当前步骤结束后不再继续发送';
    } else if (job.state === 'paused') {
      title.textContent = `群发已暂停 ${current} / ${total}`;
      meta.textContent = `成功 ${job.ok} · 失败 ${job.fail}`;
    } else if (job.state === 'scheduled') {
      title.textContent = `群发已定时 · ${total} 个聊天`;
      meta.textContent = job.scheduledAt ? new Date(job.scheduledAt).toLocaleString() : '等待执行';
    } else {
      title.textContent = total ? `正在群发 ${current} / ${total}` : '正在准备群发';
      meta.textContent = nextSeconds != null ? `成功 ${job.ok} · 失败 ${job.fail} · 下一条 ${nextSeconds} 秒后` : `成功 ${job.ok} · 失败 ${job.fail}`;
    }
    const terminal = TERMINAL.has(job.state);
    pause.classList.toggle('hidden', terminal || job.state === 'stopping' || job.state === 'scheduled');
    stop.classList.toggle('hidden', terminal);
    pause.textContent = job.state === 'paused' ? '继续' : '暂停';
    failures.classList.toggle('hidden', !(terminal && job.fail > 0));
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
    return document.querySelectorAll('#bc-selected-chips .bc-selected-chip').length;
  }

  function refreshSummary() {
    const send = document.getElementById('broadcast-send');
    const note = document.querySelector('#broadcast-overlay .bc-footer-note');
    if (!send || !note) return;
    const count = selectedCount();
    const files = document.querySelectorAll('#broadcast-files .bf-item').length;
    const lo = document.getElementById('broadcast-interval-min')?.value || '5';
    const hi = document.getElementById('broadcast-interval-max')?.value || '10';
    send.textContent = count ? `发送给 ${count} 个聊天` : '请选择发送对象';
    note.textContent = `${files ? `${files} 个附件 · ` : ''}间隔 ${lo}–${hi} 秒`;
  }

  function installAlertFilter() {
    if (window.__geekBroadcastAlertFilter) return;
    window.__geekBroadcastAlertFilter = true;
    const nativeAlert = window.alert.bind(window);
    window.alert = message => {
      const text = String(message || '');
      if (text.startsWith('已保存群组标签') || text.startsWith('群发完成：')) return;
      nativeAlert(message);
    };
  }

  async function captureHistorySnapshots(runtime, accountId) {
    try {
      const listed = await window.api.accounts.list();
      const accounts = listed?.accounts || listed || [];
      const snapshots = {};
      for (const account of accounts) {
        const data = await window.api.accountData.getAll(account.id);
        snapshots[String(account.id)] = String(data?.sendHistory || '[]');
      }
      runtime.historySnapshots.set(String(accountId), snapshots);
    } catch {
      runtime.historySnapshots.set(String(accountId), {});
    }
  }

  async function repairHistoryOwner(runtime, job) {
    if (!job || runtime.historyReconciled.has(job.id)) return;
    runtime.historyReconciled.add(job.id);
    try {
      const listed = await window.api.accounts.list();
      const accounts = listed?.accounts || listed || [];
      const current = {};
      for (const account of accounts) {
        const data = await window.api.accountData.getAll(account.id);
        current[String(account.id)] = String(data?.sendHistory || '[]');
      }
      const patches = reconcileHistoryOwner(job, runtime.historySnapshots.get(job.accountId) || {}, current);
      for (const patch of patches) await window.api.accountData.set(patch.accountId, 'sendHistory', patch.value);
    } catch (_) {}
  }

  // Compatibility bridge for the legacy single-loop executor in app.js. It creates and
  // updates an account-owned Job, but the final executor must call GeekBroadcastJobs
  // directly so concurrent accounts never depend on shared DOM/global counters.
  function installLegacyBridge(runtime) {
    document.addEventListener('click', event => {
      const target = event.target.closest?.('#bc-menu-send,#broadcast-send');
      if (!target) return;
      const owner = activeAccountId();
      if (!owner) return;
      if (target.id === 'bc-menu-send') {
        if (runtime.manager.hasActive(owner)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          render(runtime);
        }
        return;
      }
      if (runtime.manager.hasActive(owner)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        render(runtime);
        return;
      }
      void captureHistorySnapshots(runtime, owner);
      setTimeout(() => {
        const sending = document.getElementById('broadcast-sending');
        const progressText = document.getElementById('broadcast-progress-text')?.textContent || '';
        const started = (sending && !sending.classList.contains('hidden')) || /发送中|已暂停/.test(progressText);
        if (!started || runtime.manager.hasActive(owner)) return;
        try {
          const job = runtime.manager.start({ accountId: owner, total: Number(document.getElementById('bc-total-count')?.textContent) || selectedCount() });
          runtime.legacyJobId = job.id;
          runtime.legacyOwner = owner;
          document.getElementById('broadcast-overlay')?.classList.add('hidden');
          render(runtime);
        } catch (_) {}
      }, 120);
    }, true);

    runtime.legacyMonitor = setInterval(() => {
      const job = runtime.legacyJobId ? runtime.manager.get(runtime.legacyJobId) : null;
      if (!job || TERMINAL.has(job.state)) return;
      const progressText = document.getElementById('broadcast-progress-text')?.textContent || '';
      const largeText = document.getElementById('bc-progress-lg-text')?.textContent || '';
      const completion = parseCompletion(progressText);
      const progress = parseProgress(largeText);
      const patch = {};
      if (progress) { patch.current = progress.current; patch.total = progress.total; }
      patch.ok = Number(document.getElementById('bc-sent-count')?.textContent) || job.ok || 0;
      const countdown = document.getElementById('bc-countdown')?.textContent || '';
      const seconds = countdown.match(/00:(\d+)s/);
      patch.nextSendAt = seconds ? Date.now() + Number(seconds[1]) * 1000 : null;
      runtime.manager.update(job.id, patch);
      const pauseText = document.getElementById('broadcast-pause')?.textContent || '';
      const latest = runtime.manager.get(job.id);
      if (pauseText.includes('继续') && latest.state === 'running') runtime.manager.transition(job.id, 'paused');
      else if (!pauseText.includes('继续') && latest.state === 'paused') runtime.manager.transition(job.id, 'running');
      if (completion) {
        const finalPatch = { current: latest.total || latest.current, ok: completion.ok, fail: completion.fail, failed: (window.__lastFailDetail || []).map(message => ({ message })) };
        if (completion.stopped) runtime.manager.markStopped(job.id, finalPatch);
        else runtime.manager.complete(job.id, finalPatch);
        void repairHistoryOwner(runtime, runtime.manager.get(job.id));
      }
      render(runtime);
    }, 250);
  }

  function install() {
    if (typeof document === 'undefined' || window.__geekBroadcastJobInstalled) return;
    const manager = window.GeekBroadcastJobs;
    if (!manager) return;
    window.__geekBroadcastJobInstalled = true;
    injectStyles();
    applyCopyAndSemantics();
    installAlertFilter();
    const runtime = {
      manager,
      legacyJobId: '',
      legacyOwner: '',
      legacyMonitor: null,
      historySnapshots: new Map(),
      historyReconciled: new Set(),
    };
    ensureBar(runtime);
    manager.subscribe(() => render(runtime));
    installLegacyBridge(runtime);
    const observer = new MutationObserver(() => { refreshSummary(); render(runtime); });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    document.addEventListener('input', refreshSummary, true);
    document.addEventListener('change', refreshSummary, true);
    refreshSummary();
    window.__geekBroadcastJobRuntime = runtime;
  }

  return Object.freeze({ createJob, visibleFor, parseCompletion, parseProgress, reconcileHistoryOwner, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastJobController.install(), { once: true });
  else window.GeekBroadcastJobController.install();
}
