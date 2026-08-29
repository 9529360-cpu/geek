(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastProductClosure = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  let installed = false;
  let schedulePending = false;
  let managerUnsubscribe = null;

  function activeAccountId(doc = document) {
    return String(doc.querySelector('.nav-account.active[data-id]')?.dataset.id || '');
  }

  function formatScheduleTime(value) {
    const time = new Date(Number(value));
    if (!Number.isFinite(time.getTime())) return '时间无效';
    return time.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function pendingJobsFor(manager, accountId) {
    if (!manager || !accountId || typeof manager.list !== 'function') return [];
    return manager.list(accountId)
      .filter(job => ['scheduled', 'queued'].includes(String(job?.state || '')))
      .sort((a, b) => Number(a.scheduledAt || a.createdAt || 0) - Number(b.scheduledAt || b.createdAt || 0));
  }

  function ensureRecipientTagNameInput(doc = document) {
    const row = doc.querySelector('.bc-recipient-tag-canonical-row') || doc.querySelector('.bc-inline-group-save');
    const save = doc.getElementById('broadcast-save-group');
    if (!row || !save) return null;

    let input = doc.getElementById('broadcast-recipient-tag-name');
    if (!input) {
      input = doc.createElement('input');
      input.id = 'broadcast-recipient-tag-name';
      input.className = 'bc-input bc-recipient-tag-name';
      input.type = 'text';
      input.maxLength = 80;
      input.autocomplete = 'off';
      input.placeholder = '标签名称';
      input.setAttribute('aria-label', '自定义群发标签名称');
      row.insertBefore(input, save);
    }

    if (!doc.getElementById('broadcast-recipient-tag-input-style')) {
      const style = doc.createElement('style');
      style.id = 'broadcast-recipient-tag-input-style';
      style.textContent = `
        #broadcast-overlay .bc-recipient-tag-canonical-row{grid-template-columns:auto minmax(120px,1fr) minmax(120px,180px) auto!important}
        #broadcast-overlay .bc-recipient-tag-name{display:block!important;min-width:120px;height:27px;padding:3px 8px;font-size:11px}
        @media (max-width:640px){#broadcast-overlay .bc-recipient-tag-canonical-row{grid-template-columns:1fr auto!important}#broadcast-overlay #broadcast-recipient-tag-label{grid-column:1/-1}#broadcast-overlay .bc-recipient-tag-list{grid-column:1/-1}#broadcast-overlay .bc-recipient-tag-name{min-width:0}}
      `;
      doc.head.appendChild(style);
    }
    return input;
  }

  function bindRecipientTagNameInput(doc = document) {
    const save = doc.getElementById('broadcast-save-group');
    const input = ensureRecipientTagNameInput(doc);
    if (!save || !input) return false;
    if (save.dataset.geekTagInputBound === '1') return true;
    const owner = save.onclick;
    if (typeof owner !== 'function') return false;

    save.dataset.geekTagInputBound = '1';
    save.onclick = () => {
      const name = String(input.value || '').trim().slice(0, 80);
      if (!name) {
        const status = doc.getElementById('broadcast-recipient-tag-status');
        if (status) {
          status.dataset.state = 'warn';
          status.textContent = '请先输入标签名称';
        }
        input.focus();
        return;
      }

      // Electron does not support browser prompt(). app.js still owns the private
      // broadcastSelected/savedLists state, so provide the already-collected name
      // synchronously only while that owner runs, then restore the global immediately.
      const originalPrompt = window.prompt;
      try {
        window.prompt = () => name;
        owner.call(save);
      } finally {
        window.prompt = originalPrompt;
      }
      input.value = '';
    };
    return true;
  }

  function ensureScheduleControls(doc = document) {
    const button = doc.getElementById('broadcast-add-schedule');
    const list = doc.getElementById('broadcast-schedule-list');
    if (button) {
      button.hidden = false;
      button.disabled = false;
      button.removeAttribute('aria-hidden');
      button.textContent = '＋ 保存此条定时任务';
      button.title = '保存当前消息为独立定时任务，并留在当前群发流程继续添加下一条';
    }
    if (list) {
      list.hidden = false;
      list.removeAttribute('aria-hidden');
    }
    if (!doc.getElementById('broadcast-product-closure-style')) {
      const style = doc.createElement('style');
      style.id = 'broadcast-product-closure-style';
      style.textContent = `
        #broadcast-add-schedule{display:inline-flex!important}
        #broadcast-schedule-list{display:block!important;max-height:230px;overflow:auto;margin-top:8px;padding-right:2px}
        .bc-safe-schedule-summary{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 2px;background:var(--bg-surface);color:var(--text-tertiary);font-size:10.5px}
        .bc-safe-schedule-summary strong{color:var(--text-primary);font-size:11px}
        .bc-safe-schedule-row{display:flex;align-items:center;gap:8px;padding:7px 9px;margin-top:6px;border:1px solid var(--border-standard);border-radius:8px;background:var(--bg-elevated);font-size:11px}
        .bc-safe-schedule-row span{flex:1;min-width:0}
        .bc-safe-schedule-row button{border:0;background:transparent;color:var(--text-tertiary);cursor:pointer}
        .bc-safe-schedule-status{margin-top:6px;font-size:11px;color:var(--text-tertiary)}
      `;
      doc.head.appendChild(style);
    }
  }

  function renderPendingSchedules(doc = document) {
    const list = doc.getElementById('broadcast-schedule-list');
    const manager = typeof window !== 'undefined' ? window.GeekBroadcastJobs : null;
    const accountId = activeAccountId(doc);
    if (!list || !manager || !accountId) return [];
    const jobs = pendingJobsFor(manager, accountId);
    list.replaceChildren();
    if (!jobs.length) {
      const empty = doc.createElement('div');
      empty.className = 'bc-safe-schedule-status';
      empty.textContent = '尚未添加定时任务；可连续保存多条不同时间的消息。';
      list.appendChild(empty);
      return jobs;
    }
    const summary = doc.createElement('div');
    summary.className = 'bc-safe-schedule-summary';
    const count = doc.createElement('strong');
    count.textContent = `待发送 ${jobs.length} 条`;
    const hint = doc.createElement('span');
    hint.textContent = '每条任务独立保存，可单独取消';
    summary.append(count, hint);
    list.appendChild(summary);
    const fragment = doc.createDocumentFragment();
    jobs.forEach(job => {
      const row = doc.createElement('div');
      row.className = 'bc-safe-schedule-row';
      row.dataset.jobId = String(job.id || '');
      const copy = doc.createElement('span');
      const state = job.state === 'queued' ? '等待当前任务结束' : '已定时';
      copy.textContent = `${formatScheduleTime(job.scheduledAt)} · ${Number(job.total) || (job.targets || []).length} 个对象 · ${state}`;
      const cancel = doc.createElement('button');
      cancel.type = 'button';
      cancel.textContent = '取消';
      cancel.title = '取消这条定时任务';
      cancel.onclick = () => {
        void manager.invoke(job.id, 'stop').catch(error => window.alert?.(String(error?.message || error))).finally(() => renderPendingSchedules(doc));
      };
      row.append(copy, cancel);
      fragment.appendChild(row);
    });
    list.appendChild(fragment);
    return jobs;
  }

  async function addCurrentScheduledMessage(doc = document) {
    if (schedulePending) return false;
    const accountId = activeAccountId(doc);
    const toggle = doc.getElementById('broadcast-schedule-toggle');
    const timeInput = doc.getElementById('broadcast-schedule-time');
    const button = doc.getElementById('broadcast-add-schedule');
    const scheduledAt = timeInput?.value ? new Date(timeInput.value).getTime() : NaN;
    if (!accountId) { window.alert?.('请先选择账号'); return false; }
    if (!toggle?.checked) { window.alert?.('请先开启“定时发送”'); return false; }
    if (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now()) { window.alert?.('请选择未来的发送时间'); return false; }

    const runtime = window.GeekBroadcastRuntimeInstance;
    const persistence = window.GeekBroadcastSchedulePersistenceInstance;
    if (!runtime || typeof runtime.startFromEditor !== 'function') { window.alert?.('群发运行时尚未就绪，请稍后重试'); return false; }
    if (!persistence || typeof persistence.awaitScheduledDurable !== 'function') { window.alert?.('定时任务持久化尚未就绪，请稍后重试'); return false; }

    schedulePending = true;
    if (button) {
      button.disabled = true;
      button.dataset.safePending = '1';
      button.textContent = '正在保存…';
    }
    try {
      const job = await runtime.startFromEditor();
      if (!job || job.state !== 'scheduled') throw new Error('未创建定时任务，请确认发送时间仍在未来');
      const durable = await persistence.awaitScheduledDurable(job.id);
      const latest = window.GeekBroadcastJobs?.get(job.id);
      if (!durable || latest?.state === 'failed') throw new Error('定时任务未能持久化，已停止；请重试');

      const overlay = doc.getElementById('broadcast-overlay');
      overlay?.classList.remove('hidden');
      runtime.renderDraftFiles?.(accountId);
      const message = doc.getElementById('broadcast-message');
      if (message) {
        message.value = '';
        message.focus();
      }
      renderPendingSchedules(doc);
      const status = doc.getElementById('broadcast-workbench-status')?.querySelector('span');
      if (status) status.textContent = '定时任务已保存，可修改时间和消息继续添加下一条';
      return true;
    } catch (error) {
      doc.getElementById('broadcast-overlay')?.classList.remove('hidden');
      window.alert?.(String(error?.message || error));
      renderPendingSchedules(doc);
      return false;
    } finally {
      schedulePending = false;
      if (button) {
        button.disabled = false;
        button.dataset.safePending = '';
        button.textContent = '＋ 保存此条定时任务';
      }
    }
  }

  function install(doc = document) {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    ensureRecipientTagNameInput(doc);
    bindRecipientTagNameInput(doc);
    ensureScheduleControls(doc);
    renderPendingSchedules(doc);

    doc.addEventListener('click', event => {
      const addSchedule = event.target?.closest?.('#broadcast-add-schedule');
      if (addSchedule) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void addCurrentScheduledMessage(doc);
        return;
      }
      const open = event.target?.closest?.('#bc-menu-send');
      if (open) setTimeout(() => {
        ensureRecipientTagNameInput(doc);
        bindRecipientTagNameInput(doc);
        ensureScheduleControls(doc);
        renderPendingSchedules(doc);
      }, 0);
    }, true);

    const manager = window.GeekBroadcastJobs;
    if (manager && typeof manager.subscribe === 'function') {
      managerUnsubscribe = manager.subscribe(event => {
        if (!event?.job || String(event.job.accountId) !== activeAccountId(doc)) return;
        if (['created', 'state', 'dismissed'].includes(event.type)) queueMicrotask(() => renderPendingSchedules(doc));
      });
    }

    window.GeekBroadcastProductClosureInstance = Object.freeze({
      ensureRecipientTagNameInput: () => ensureRecipientTagNameInput(doc),
      bindRecipientTagNameInput: () => bindRecipientTagNameInput(doc),
      addCurrentScheduledMessage: () => addCurrentScheduledMessage(doc),
      renderPendingSchedules: () => renderPendingSchedules(doc),
      dispose: () => { managerUnsubscribe?.(); managerUnsubscribe = null; },
    });
  }

  return Object.freeze({ activeAccountId, formatScheduleTime, pendingJobsFor, ensureRecipientTagNameInput, bindRecipientTagNameInput, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastProductClosure.install(), { once: true });
  else window.GeekBroadcastProductClosure.install();
}
