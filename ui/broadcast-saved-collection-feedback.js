(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastSavedCollectionFeedback = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  let installed = false;
  let feedbackTimer = null;

  function parseGroups(raw) {
    try {
      const groups = JSON.parse(String(raw || '[]'));
      return Array.isArray(groups) ? groups.filter(group => group && typeof group === 'object') : [];
    } catch (_) {
      return [];
    }
  }

  function snapshot(groups) {
    const map = new Map();
    for (const group of groups || []) {
      const id = String(group?.id || '');
      if (!id) continue;
      map.set(id, Number(group?.updatedAt) || 0);
    }
    return map;
  }

  function changedGroup(groups, before) {
    const candidates = (groups || []).filter(group => {
      const id = String(group?.id || '');
      if (!id) return false;
      const previous = before?.get(id);
      return previous === undefined || (Number(group?.updatedAt) || 0) > previous;
    });
    candidates.sort((a, b) => (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0));
    return candidates[0] || null;
  }

  function ensureFeedback() {
    let node = document.getElementById('bc-saved-collection-feedback');
    if (node) return node;
    const anchor = document.getElementById('broadcast-save-group');
    if (!anchor) return null;
    node = document.createElement('span');
    node.id = 'bc-saved-collection-feedback';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.style.cssText = 'display:none;margin-left:8px;font-size:10.5px;color:var(--text-secondary);white-space:nowrap';
    anchor.insertAdjacentElement('afterend', node);
    return node;
  }

  function showFeedback(text, isError = false) {
    const node = ensureFeedback();
    if (!node) return;
    node.textContent = String(text || '');
    node.style.color = isError ? 'var(--danger)' : 'var(--text-secondary)';
    node.style.display = text ? 'inline-flex' : 'none';
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      node.style.display = 'none';
      feedbackTimer = null;
    }, 3200);
  }

  function activeAccountId() {
    return document.querySelector('.nav-account.active[data-id]')?.dataset.id || '';
  }

  async function persistedGroups(accountId) {
    if (!accountId || !window.api?.accountData?.getAll) return [];
    const data = await window.api.accountData.getAll(accountId);
    return parseGroups(data?.broadcastGroups);
  }

  function selectPersistedGroup(group) {
    const select = document.getElementById('broadcast-saved-groups');
    if (!select || !group?.id) return false;
    const id = String(group.id);
    const option = [...select.options].find(item => String(item.value) === id);
    if (!option) return false;
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select.value === id;
  }

  async function settleSave(accountId, before) {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const groups = await persistedGroups(accountId);
        const changed = changedGroup(groups, before);
        if (changed) {
          // Legacy rendering inserts the new <option>; if it is one tick behind the durable write,
          // let it finish before selecting the just-persisted collection.
          for (let renderAttempt = 0; renderAttempt < 4; renderAttempt++) {
            if (selectPersistedGroup(changed)) break;
            await new Promise(resolve => setTimeout(resolve, 40));
          }
          const count = Array.isArray(changed.chatIds) ? changed.chatIds.length : 0;
          showFeedback(`已保存「${String(changed.name || '群组集合')}」 · ${count} 个群`);
          return changed;
        }
      } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 90));
    }
    return null;
  }

  function install() {
    if (installed || typeof document === 'undefined') return;
    installed = true;

    document.addEventListener('click', event => {
      const button = event.target?.closest?.('#broadcast-save-group');
      if (!button) return;
      const accountId = activeAccountId();
      if (!accountId) return;

      // Capture the durable baseline before the legacy onclick opens its naming prompt.
      // The post-click microtask waits for this promise, so cancelling the prompt cannot
      // turn an already-existing collection into a false "saved" result.
      const beforePromise = persistedGroups(accountId).then(snapshot).catch(() => null);
      queueMicrotask(() => {
        void beforePromise.then(before => {
          if (!before) return;
          return settleSave(accountId, before);
        });
      });
    }, true);

    ensureFeedback();
  }

  return Object.freeze({ parseGroups, snapshot, changedGroup, selectPersistedGroup, settleSave, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastSavedCollectionFeedback.install(), { once: true });
  else window.GeekBroadcastSavedCollectionFeedback.install();
}
