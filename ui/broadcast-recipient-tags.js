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

  function ensureSurface(doc = document) {
    doc.getElementById('broadcast-recipient-tags')?.remove();
    doc.getElementById('broadcast-native-label-helper')?.remove();
    doc.getElementById('broadcast-native-label-style')?.remove();

    const row = doc.querySelector('.bc-saved-row');
    const select = doc.getElementById('bc-saved-lists');
    const save = doc.getElementById('bc-save-list');
    const remove = doc.getElementById('bc-delete-list');
    if (!row || !select || !save || !remove) return null;

    row.style.display = 'grid';
    row.classList.add('bc-recipient-tag-row');
    select.style.display = 'none';
    remove.style.display = 'none';
    save.style.display = '';
    save.textContent = '＋ 保存当前名单';
    save.title = '把当前选择的联系人和群组保存为一个自定义群发标签';

    let head = row.querySelector('.bc-recipient-tag-head');
    if (!head) {
      head = doc.createElement('div');
      head.className = 'bc-recipient-tag-head';
      const title = doc.createElement('strong');
      title.textContent = '群发名单标签';
      const hint = doc.createElement('span');
      hint.textContent = '选择联系人/群组后保存；下次点标签直接恢复这批收件人';
      head.append(title, hint);
      row.insertBefore(head, row.firstChild);
    }

    let list = row.querySelector('#broadcast-recipient-tag-list');
    if (!list) {
      list = doc.createElement('div');
      list.id = 'broadcast-recipient-tag-list';
      list.className = 'bc-original-tag-list bc-recipient-tag-list';
      row.insertBefore(list, save);
    }

    if (!doc.getElementById('broadcast-recipient-tag-style')) {
      const style = doc.createElement('style');
      style.id = 'broadcast-recipient-tag-style';
      style.textContent = `
        #broadcast-overlay .bc-recipient-tag-row{display:grid!important;grid-template-columns:1fr auto;gap:7px;margin-top:7px;padding:8px;border:1px solid var(--border-subtle);border-radius:5px;background:color-mix(in srgb,var(--accent) 3%,var(--bg-surface))}
        #broadcast-overlay .bc-recipient-tag-head{grid-column:1/-1;display:flex;align-items:baseline;gap:8px;min-width:0}
        #broadcast-overlay .bc-recipient-tag-head strong{font-size:12px;color:var(--text-primary);white-space:nowrap}
        #broadcast-overlay .bc-recipient-tag-head span{font-size:10.5px;color:var(--text-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        #broadcast-overlay .bc-recipient-tag-list{min-height:27px;align-content:center}
        #broadcast-overlay .bc-recipient-tag-empty{font-size:11px;color:var(--text-tertiary)}
        #broadcast-overlay .bc-recipient-tag-row>#bc-save-list{height:27px;padding:2px 9px;align-self:start;white-space:nowrap}
      `;
      doc.head.appendChild(style);
    }
    return { row, select, save, remove, list };
  }

  function optionPresets(select) {
    if (!select) return [];
    return [...select.options].slice(1).map((option, index) => ({
      index,
      name: String(option.textContent || '').replace(/（\d+）\s*$/, '').trim(),
      count: Number((String(option.textContent || '').match(/（(\d+)）\s*$/) || [])[1] || 0),
    }));
  }

  async function durablePresets(doc = document) {
    const accountId = activeAccountId(doc);
    if (!accountId) return [];
    try {
      const data = await window.api.accountData.getAll(accountId);
      if (activeAccountId(doc) !== accountId) return [];
      return parsePresets(data?.savedLists);
    } catch (_) {
      return [];
    }
  }

  function applyPreset(index, doc = document) {
    const controls = ensureSurface(doc);
    if (!controls) return false;
    const option = controls.select.options[index + 1];
    if (!option || typeof controls.select.onchange !== 'function') return false;
    const clear = doc.getElementById('broadcast-clear');
    if (clear && typeof clear.onclick === 'function') clear.onclick.call(clear);
    controls.select.value = String(index);
    controls.select.onchange.call(controls.select);
    renderTags(doc, index);
    return true;
  }

  function deletePreset(index, doc = document) {
    const controls = ensureSurface(doc);
    if (!controls) return false;
    const option = controls.select.options[index + 1];
    if (!option || typeof controls.remove.onclick !== 'function') return false;
    controls.select.value = String(index);
    controls.remove.onclick.call(controls.remove);
    setTimeout(() => renderTags(doc), 0);
    return true;
  }

  function renderTags(doc = document, activeIndex = -1) {
    const controls = ensureSurface(doc);
    if (!controls) return [];
    const presets = optionPresets(controls.select);
    controls.list.replaceChildren();
    if (!presets.length) {
      const empty = doc.createElement('span');
      empty.className = 'bc-recipient-tag-empty';
      empty.textContent = '暂无标签。先勾选联系人或群组，再点“保存当前名单”。';
      controls.list.appendChild(empty);
      return presets;
    }
    presets.forEach(preset => {
      const chip = doc.createElement('span');
      chip.className = 'bc-original-tag' + (preset.index === activeIndex ? ' active' : '');
      const open = doc.createElement('button');
      open.type = 'button';
      open.className = 'bc-original-tag__open';
      open.textContent = preset.name || `标签${preset.index + 1}`;
      const count = doc.createElement('em');
      count.textContent = String(preset.count);
      open.appendChild(count);
      open.title = `恢复这个群发名单（${preset.count} 个收件人）`;
      open.onclick = () => applyPreset(preset.index, doc);
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'bc-original-tag__remove';
      remove.textContent = '×';
      remove.title = '删除这个群发名单标签';
      remove.onclick = event => { event.stopPropagation(); deletePreset(preset.index, doc); };
      chip.append(open, remove);
      controls.list.appendChild(chip);
    });
    return presets;
  }

  async function verifyAndRender(doc = document) {
    const controls = ensureSurface(doc);
    if (!controls) return [];
    const durable = await durablePresets(doc);
    const ui = optionPresets(controls.select);
    if (durable.length !== ui.length) {
      // app.js owns the canonical in-memory list and select rendering. Do not invent a
      // second state store here; surface the mismatch so it cannot look silently saved.
      const empty = doc.createElement('span');
      controls.list.replaceChildren(empty);
      empty.className = 'bc-recipient-tag-empty';
      empty.textContent = '标签数据正在同步，请重新打开群发窗口。';
      return [];
    }
    return renderTags(doc);
  }

  function runOwnerSave(button, doc = document) {
    if (!button || button.dataset.ownerSavePending === '1') return false;
    if (typeof button.onclick !== 'function') {
      window.alert?.('群发编辑器尚未初始化完成，请重新打开群发窗口');
      return false;
    }
    button.dataset.ownerSavePending = '1';
    try {
      // app.js is the state owner: it reads broadcastSelected, asks for the custom name,
      // updates its private savedLists model, persists through accountStorageSetItem,
      // and re-renders the canonical hidden select. We call that owner directly once.
      button.onclick.call(button);
    } finally {
      button.dataset.ownerSavePending = '';
    }
    setTimeout(() => { void verifyAndRender(doc); }, 0);
    return true;
  }

  function install(doc = document) {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    ensureSurface(doc);
    renderTags(doc);

    // This listener is intentionally capture-phase and this module is loaded before
    // broadcast-product-closure. It gives the save click to the real app.js owner and
    // prevents the old cross-module persist/replay interception from running.
    doc.addEventListener('click', event => {
      const save = event.target?.closest?.('#bc-save-list');
      if (save) {
        event.preventDefault();
        event.stopImmediatePropagation();
        runOwnerSave(save, doc);
        return;
      }
      const open = event.target?.closest?.('#bc-menu-send');
      const account = event.target?.closest?.('.nav-account[data-id]');
      if (open || account) setTimeout(() => {
        ensureSurface(doc);
        void verifyAndRender(doc);
      }, 0);
    }, true);

    window.GeekBroadcastRecipientTagsInstance = Object.freeze({
      render: () => renderTags(doc),
      verifyAndRender: () => verifyAndRender(doc),
      apply: index => applyPreset(index, doc),
      remove: index => deletePreset(index, doc),
    });
  }

  return Object.freeze({ parsePresets, optionPresets, ensureSurface, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastRecipientTags.install(), { once: true });
  else window.GeekBroadcastRecipientTags.install();
}
