(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastProductClosure = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  let installed = false;
  let schedulePending = false;
  let managerUnsubscribe = null;

  function parseList(raw) {
    try {
      const value = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
      return Array.isArray(value) ? value : [];
    } catch (_) { return []; }
  }

  function activeAccountId(doc = document) {
    return String(doc.querySelector('.nav-account.active[data-id]')?.dataset.id || '');
  }

  function selectedRecipientIds(doc = document) {
    return [...doc.querySelectorAll('#bc-selected-chips .bc-selected-chip button[data-id]')]
      .map(button => String(button.dataset.id || '').trim())
      .filter(Boolean);
  }

  function appendRecipientPreset(value, preset) {
    const items = parseList(value).filter(item => item && typeof item === 'object');
    const name = String(preset?.name || '').trim().slice(0, 80);
    const ids = [...new Set((Array.isArray(preset?.ids) ? preset.ids : []).map(id => String(id || '').trim()).filter(Boolean))];
    if (!name || !ids.length) throw new TypeError('recipient preset requires name and ids');
    return [...items, { name, ids }];
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

  async function persistRecipientPreset(button, doc = document) {
    if (!button || button.dataset.durablePending === '1') return false;
    const accountId = activeAccountId(doc);
    const ids = selectedRecipientIds(doc);
    if (!accountId) { window.alert?.('请先选择账号'); return false; }
    if (!ids.length) { window.alert?.('请先勾选联系人或群组'); return false; }
    const name = String(window.prompt?.('保存为可复用标签：', '收件人标签') || '').trim().slice(0, 80);
    if (!name) return false;

    button.dataset.durablePending = '1';
    button.disabled = true;
    try {
      const data = await window.api.accountData.getAll(accountId);
      const next = appendRecipientPreset(data?.savedLists, { name, ids });
      await window.api.accountData.set(accountId, 'savedLists', JSON.stringify(next));
      if (activeAccountId(doc) !== accountId) return true;

      const originalPrompt = window.prompt;
      try {
        window.prompt = () => name;
        if (typeof button.onclick === 'function') button.onclick.call(button);
      } finally {
        window.prompt = originalPrompt;
      }
      window.alert?.(`已保存收件人标签「${name}」，下次进入群发可直接选择复用。`);
      return true;
    } catch (error) {
      window.alert?.(`保存收件人标签失败：${String(error?.message || error)}`);
      return false;
    } finally {
      button.dataset.durablePending = '';
      button.disabled = false;
    }
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
    ensureScheduleControls(doc);
    renderPendingSchedules(doc);

    doc.addEventListener('click', event => {
      const saveList = event.target?.closest?.('#bc-save-list');
      if (saveList && saveList.dataset.durableReplay !== '1') {
        event.preventDefault();
        event.stopImmediatePropagation();
        void persistRecipientPreset(saveList, doc);
        return;
      }
      const addSchedule = event.target?.closest?.('#broadcast-add-schedule');
      if (addSchedule) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void addCurrentScheduledMessage(doc);
        return;
      }
      const open = event.target?.closest?.('#bc-menu-send');
      if (open) setTimeout(() => {
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
      persistRecipientPreset: button => persistRecipientPreset(button, doc),
      addCurrentScheduledMessage: () => addCurrentScheduledMessage(doc),
      renderPendingSchedules: () => renderPendingSchedules(doc),
      dispose: () => { managerUnsubscribe?.(); managerUnsubscribe = null; },
    });
  }

  return Object.freeze({ parseList, selectedRecipientIds, appendRecipientPreset, formatScheduleTime, pendingJobsFor, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastProductClosure.install(), { once: true });
  else window.GeekBroadcastProductClosure.install();
}