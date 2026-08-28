(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastAudienceUx = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  let installed = false;

  function relabelRecipientPresets(doc = document) {
    const saveList = doc.getElementById('bc-save-list');
    if (saveList) {
      saveList.textContent = '保存收件人名单';
      saveList.title = '保存当前选择的联系人和群组，方便下次直接复用';
    }
    const savedLists = doc.getElementById('bc-saved-lists');
    if (savedLists) savedLists.title = '已保存的收件人名单（支持联系人和群组）';
    const deleteList = doc.getElementById('bc-delete-list');
    if (deleteList) deleteList.title = '删除当前收件人名单';

    const saveGroup = doc.getElementById('broadcast-save-group');
    if (saveGroup) {
      saveGroup.textContent = '保存群组集合';
      saveGroup.title = '仅保存当前选择中的群组；保存联系人请使用“保存收件人名单”';
    }
    const savedGroups = doc.getElementById('broadcast-saved-groups');
    if (savedGroups) savedGroups.title = '群组集合只用于群组筛选，不保存联系人';
    return { hasRecipientPreset: !!saveList, hasGroupPreset: !!saveGroup };
  }

  function retireLegacyScheduler(doc = document) {
    const addLegacy = doc.getElementById('broadcast-add-schedule');
    const legacyList = doc.getElementById('broadcast-schedule-list');
    if (addLegacy) {
      addLegacy.hidden = true;
      addLegacy.setAttribute('aria-hidden', 'true');
      addLegacy.disabled = true;
      addLegacy.title = '旧版多消息定时已停用，请使用当前群发的“定时发送”创建账号级任务';
    }
    if (legacyList) {
      legacyList.hidden = true;
      legacyList.setAttribute('aria-hidden', 'true');
      legacyList.replaceChildren();
    }

    const toggle = doc.getElementById('broadcast-schedule-toggle');
    if (toggle) {
      const label = toggle.closest('label');
      const text = label?.querySelector('.bc-switch-label, span');
      if (text) text.textContent = '定时发送';
      label?.setAttribute('title', '创建账号级定时任务；受众、内容和附件在创建时固定，重启后可恢复');
    }
    const time = doc.getElementById('broadcast-schedule-time');
    if (time) time.title = '计划发送时间；任务创建后由当前账号独立管理';
    return { legacyRetired: !!(addLegacy || legacyList), canonicalSchedule: !!toggle };
  }

  function install() {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    const apply = () => {
      relabelRecipientPresets(document);
      retireLegacyScheduler(document);
    };
    apply();
    const overlay = document.getElementById('broadcast-overlay');
    if (overlay) {
      const observer = new MutationObserver(apply);
      observer.observe(overlay, { childList: true, subtree: true });
    }
  }

  return Object.freeze({ install, relabelRecipientPresets, retireLegacyScheduler });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastAudienceUx.install(), { once: true });
  else window.GeekBroadcastAudienceUx.install();
}
