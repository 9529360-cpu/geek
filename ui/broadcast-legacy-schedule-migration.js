(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastLegacyScheduleMigration = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const OLD_KEY = 'scheduleTasks';
  const NEW_KEY = 'broadcastJobSchedules';
  const BACKUP_KEY = 'broadcastLegacyScheduleBackup';
  const REVIEW_KEY = 'broadcastLegacyScheduleNeedsReview';
  const MARKER_KEY = 'broadcastScheduleMigrationV2';
  let installed = false;

  function parseArray(raw) {
    try {
      const value = JSON.parse(raw || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) { return []; }
  }

  function futureTime(task) {
    const value = new Date(task?.time || task?.scheduledAt || '').getTime();
    return Number.isFinite(value) && value > Date.now() ? value : null;
  }

  function usesRecipientNameVariables(message) {
    return /%(?:nc|nr)\b/i.test(String(message || ''));
  }

  function reviewRecord(needsReview, legacyId, task, reason) {
    if (needsReview.some(item => item.id === legacyId)) return;
    needsReview.push({
      id: legacyId,
      time: task.time || '',
      message: String(task.message || ''),
      groupId: String(task.groupId || ''),
      reason,
    });
  }

  function migrateRecords(account, data) {
    const legacy = parseArray(data?.[OLD_KEY]);
    const existing = parseArray(data?.[NEW_KEY]);
    const groups = parseArray(data?.broadcastGroups);
    const migrated = existing.slice();
    const needsReview = parseArray(data?.[REVIEW_KEY]);
    const knownIds = new Set(migrated.map(item => item.id));

    for (const task of legacy) {
      const scheduledAt = futureTime(task);
      if (!scheduledAt || !task?.message) continue;
      const legacyId = String(task.id || `legacy-${scheduledAt}-${Math.random().toString(16).slice(2)}`);
      const id = `migrated-${legacyId}`;
      if (knownIds.has(id)) continue;
      const group = task.groupId ? groups.find(item => String(item.id) === String(task.groupId)) : null;
      const ids = Array.isArray(group?.chatIds) ? group.chatIds.map(String).filter(Boolean) : [];
      if (!ids.length) {
        reviewRecord(needsReview, legacyId, task, task.groupId ? '群组集合已不存在' : '旧任务未持久化收件人，需要重新确认');
        continue;
      }
      if (usesRecipientNameVariables(task.message)) {
        reviewRecord(needsReview, legacyId, task, '旧群组集合只保存了聊天 ID，但消息使用了联系人名称变量，请重新确认收件人与消息');
        continue;
      }
      migrated.push({
        id,
        accountId: String(account.id),
        accountName: String(account.name || ''),
        partition: String(account.partition || ''),
        platformFamily: '',
        targets: ids.map(chatId => ({ id: chatId, name: '' })),
        message: String(task.message || ''),
        vcards: [],
        tagAll: false,
        intervalMin: 5,
        intervalMax: 10,
        scheduledAt,
        createdAt: Date.now(),
        migratedFromLegacy: true,
      });
      knownIds.add(id);
    }
    return { legacy, migrated, needsReview };
  }

  async function migrateAccount(account) {
    const data = await window.api.accountData.getAll(account.id);
    const result = migrateRecords(account, data || {});
    if (!result.legacy.length) return { changed: false, review: result.needsReview.length };
    const backup = { migratedAt: Date.now(), source: OLD_KEY, tasks: result.legacy };
    await window.api.accountData.set(account.id, BACKUP_KEY, JSON.stringify(backup));
    await window.api.accountData.set(account.id, NEW_KEY, JSON.stringify(result.migrated));
    await window.api.accountData.set(account.id, REVIEW_KEY, JSON.stringify(result.needsReview));
    await window.api.accountData.set(account.id, OLD_KEY, '[]');
    await window.api.accountData.set(account.id, MARKER_KEY, String(Date.now()));
    return { changed: true, review: result.needsReview.length };
  }

  async function migrateAll() {
    const listed = await window.api.accounts.list();
    const accounts = listed?.accounts || listed || [];
    let changed = false;
    let review = 0;
    for (const account of accounts) {
      try {
        const result = await migrateAccount(account);
        changed = changed || result.changed;
        review += result.review;
      } catch (_) {}
    }
    if (changed) {
      setTimeout(() => document.querySelector('.nav-account.active .nav-account-main')?.click(), 0);
      setTimeout(() => window.GeekBroadcastSchedulePersistenceInstance?.restore?.(), 50);
    }
    return { changed, review };
  }

  async function renderReviewNotice(accountId) {
    const footer = document.querySelector('#broadcast-overlay .bc-footer-note');
    if (!footer || !accountId) return;
    try {
      const data = await window.api.accountData.getAll(accountId);
      const review = parseArray(data?.[REVIEW_KEY]);
      let notice = document.getElementById('bc-legacy-schedule-review');
      if (!review.length) { notice?.remove(); return; }
      if (!notice) {
        notice = document.createElement('div');
        notice.id = 'bc-legacy-schedule-review';
        notice.style.cssText = 'margin-top:6px;font-size:10.5px;color:#d6a84a;';
        footer.parentElement?.insertBefore(notice, footer);
      }
      notice.textContent = `有 ${review.length} 条旧定时任务需要重新确认，旧执行已停止且备份已保留。请重新选择收件人并创建新的定时发送。`;
    } catch (_) {}
  }

  function install() {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    const style = document.createElement('style');
    style.id = 'broadcast-legacy-schedule-migration-style';
    style.textContent = '#broadcast-add-schedule,#broadcast-schedule-list{display:none!important}';
    document.head.appendChild(style);
    document.addEventListener('click', event => {
      const addLegacy = event.target?.closest?.('#broadcast-add-schedule');
      if (addLegacy) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      const open = event.target?.closest?.('#bc-menu-send');
      if (open) setTimeout(() => void renderReviewNotice(document.querySelector('.nav-account.active[data-id]')?.dataset.id || ''), 0);
    }, true);
    setTimeout(() => void migrateAll(), 0);
    window.GeekBroadcastLegacyScheduleMigrationInstance = Object.freeze({ migrateAll, migrateAccount, renderReviewNotice });
  }

  return Object.freeze({ OLD_KEY, NEW_KEY, BACKUP_KEY, REVIEW_KEY, MARKER_KEY, migrateRecords, usesRecipientNameVariables, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastLegacyScheduleMigration.install(), { once: true });
  else window.GeekBroadcastLegacyScheduleMigration.install();
}
