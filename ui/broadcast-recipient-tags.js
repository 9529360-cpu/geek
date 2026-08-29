(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastRecipientTags = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  let installed = false;

  function activeAccountId(doc = document) {
    return String(doc.querySelector('.nav-account.active[data-id]')?.dataset.id || '');
  }

  function parsePresets(raw) {
    let value = raw;
    if (typeof raw === 'string') {
      try { value = JSON.parse(raw || '[]'); } catch (_) { value = []; }
    }
    if (!Array.isArray(value)) return [];
    return value.map(item => {
      if (!item || typeof item !== 'object') return null;
      const name = String(item.name || '').trim().slice(0, 80);
      const ids = [...new Set((Array.isArray(item.ids) ? item.ids : [])
        .map(id => String(id || '').trim())
        .filter(Boolean))];
      return name && ids.length ? { name, ids } : null;
    }).filter(Boolean);
  }

  function ensureSingleSurface(doc = document) {
    // Remove both experimental surfaces from prior candidates. The broadcast plugin's
    // own saved-list row is the one and only product entry for reusable recipient tags.
    doc.getElementById('broadcast-recipient-tags')?.remove();
    doc.getElementById('broadcast-native-label-helper')?.remove();
    doc.getElementById('broadcast-native-label-style')?.remove();

    const row = doc.querySelector('.bc-saved-row');
    const select = doc.getElementById('bc-saved-lists');
    const save = doc.getElementById('bc-save-list');
    const remove = doc.getElementById('bc-delete-list');
    if (!row || !select || !save || !remove) return null;

    row.style.display = 'flex';
    row.classList.add('bc-recipient-tag-row');
    select.style.display = '';
    save.style.display = '';
    remove.style.display = '';

    let title = row.querySelector('.bc-recipient-tag-title');
    if (!title) {
      title = doc.createElement('span');
      title.className = 'bc-recipient-tag-title';
      row.insertBefore(title, row.firstChild);
    }
    title.textContent = '群发名单标签';

    save.textContent = '＋ 保存当前名单';
    save.title = '把当前群发已选联系人和群组保存为当前账号可复用的群发名单标签';
    select.title = '选择已保存的群发名单标签；应用时会精确恢复该名单';
    remove.textContent = '删除标签';
    remove.title = '删除当前选择的群发名单标签';

    if (!doc.getElementById('broadcast-recipient-tag-style')) {
      const style = doc.createElement('style');
      style.id = 'broadcast-recipient-tag-style';
      style.textContent = `
        #broadcast-overlay .bc-recipient-tag-row{display:grid!important;grid-template-columns:auto minmax(160px,1fr) auto auto;align-items:center;gap:6px;margin-top:7px;padding:7px;border:1px solid var(--border-subtle);border-radius:5px;background:color-mix(in srgb,var(--accent) 3%,var(--bg-surface))}
        #broadcast-overlay .bc-recipient-tag-title{font-size:11.5px;font-weight:700;color:var(--text-primary);white-space:nowrap}
        #broadcast-overlay .bc-recipient-tag-row .bc-input{min-width:0;height:28px}
        #broadcast-overlay .bc-recipient-tag-row .bc-btn{height:28px;padding:2px 8px;white-space:nowrap}
        @media (max-width:640px){#broadcast-overlay .bc-recipient-tag-row{grid-template-columns:1fr 1fr}.bc-recipient-tag-title{grid-column:1/-1}.bc-recipient-tag-row .bc-saved-select{grid-column:1/-1}}
      `;
      doc.head.appendChild(style);
    }
    return { row, select, save, remove };
  }

  async function readPresets(doc = document) {
    const accountId = activeAccountId(doc);
    if (!accountId) return { accountId: '', presets: [] };
    const data = await window.api.accountData.getAll(accountId);
    if (activeAccountId(doc) !== accountId) return { accountId: '', presets: [] };
    return { accountId, presets: parsePresets(data?.savedLists) };
  }

  async function verifySavedPreset(doc = document, previousCount = -1) {
    const current = await readPresets(doc);
    if (!current.accountId) return false;
    const controls = ensureSingleSurface(doc);
    const options = controls ? [...controls.select.options].slice(1) : [];
    return current.presets.length > previousCount && options.length === current.presets.length;
  }

  function wrapExactApply(doc = document) {
    const controls = ensureSingleSurface(doc);
    if (!controls || controls.select.dataset.exactApplyWrapped === '1') return;
    const legacyApply = controls.select.onchange;
    if (typeof legacyApply !== 'function') return;
    controls.select.onchange = function () {
      const value = String(controls.select.value || '');
      if (value !== '') {
        const clear = doc.getElementById('broadcast-clear');
        if (clear && typeof clear.onclick === 'function') clear.onclick.call(clear);
        controls.select.value = value;
      }
      return legacyApply.call(controls.select);
    };
    controls.select.dataset.exactApplyWrapped = '1';
  }

  async function saveCurrent(doc = document) {
    const controls = ensureSingleSurface(doc);
    const closure = window.GeekBroadcastProductClosureInstance;
    if (!controls || typeof closure?.persistRecipientPreset !== 'function') {
      window.alert?.('群发名单标签功能尚未就绪，请重新打开群发窗口');
      return false;
    }
    const before = await readPresets(doc).catch(() => ({ accountId: '', presets: [] }));
    const saved = await closure.persistRecipientPreset(controls.save);
    if (!saved) return false;
    const verified = await verifySavedPreset(doc, before.presets.length).catch(() => false);
    if (!verified) {
      window.alert?.('群发名单标签已写入，但界面未同步完成；请重新打开群发窗口确认。');
      return false;
    }
    const status = doc.getElementById('broadcast-workbench-status')?.querySelector('span');
    if (status) status.textContent = '群发名单标签已保存，可在当前账号下直接复用';
    return true;
  }

  function install(doc = document) {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    ensureSingleSurface(doc);
    wrapExactApply(doc);

    doc.addEventListener('click', event => {
      const open = event.target?.closest?.('#bc-menu-send');
      const account = event.target?.closest?.('.nav-account[data-id]');
      if (open || account) setTimeout(() => {
        ensureSingleSurface(doc);
        wrapExactApply(doc);
      }, 0);
    });

    // Product closure owns durable save interception. This module only exposes the
    // existing plugin surface and verifies that durable state and legacy UI agree.
    window.GeekBroadcastRecipientTagsInstance = Object.freeze({
      ensureSingleSurface: () => ensureSingleSurface(doc),
      readPresets: () => readPresets(doc),
      saveCurrent: () => saveCurrent(doc),
      wrapExactApply: () => wrapExactApply(doc),
    });
  }

  return Object.freeze({ parsePresets, ensureSingleSurface, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastRecipientTags.install(), { once: true });
  else window.GeekBroadcastRecipientTags.install();
}
