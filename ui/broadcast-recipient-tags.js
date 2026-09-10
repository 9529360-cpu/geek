(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastRecipientTags = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  let installed = false;
  let ownerObserver = null;
  let savePending = false;

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

  function optionPresets(select) {
    if (!select) return [];
    return [...select.options].slice(1).map((option, index) => ({
      index,
      name: String(option.textContent || '').replace(/（\d+）\s*$/, '').trim(),
      count: Number((String(option.textContent || '').match(/（(\d+)）\s*$/) || [])[1] || 0),
    }));
  }

  function invokeOwnerHandler(button) {
    if (!button || typeof button.onclick !== 'function') return false;
    button.onclick.call(button);
    return true;
  }

  function setStatus(doc, text, state = 'idle') {
    const status = doc.getElementById('broadcast-recipient-tag-status');
    if (!status) return;
    status.dataset.state = state;
    status.textContent = text;
    if (typeof window !== 'undefined') {
      window.__geekBroadcastTagTrace = Object.freeze({
        stage: state,
        optionCount: optionPresets(doc.getElementById('bc-saved-lists')).length,
      });
    }
  }

  function ensureCanonicalSurface(doc = document) {
    // The row directly under the recipient picker is the product surface the user sees.
    // Retire the separate experimental/hidden surfaces instead of creating another tag concept.
    doc.getElementById('broadcast-recipient-tags')?.remove();
    doc.getElementById('broadcast-native-label-helper')?.remove();
    doc.getElementById('broadcast-native-label-style')?.remove();

    const row = doc.querySelector('.bc-inline-group-save');
    const publicSave = doc.getElementById('broadcast-save-group');
    const legacyGroupClear = doc.getElementById('broadcast-show-all-groups');
    const legacyGroupSelect = doc.getElementById('broadcast-saved-groups');
    const legacyGroupList = doc.getElementById('bc-group-tag-list');
    const legacyGroupDelete = doc.getElementById('broadcast-delete-group');

    const ownerRow = doc.querySelector('.bc-saved-row');
    const ownerSelect = doc.getElementById('bc-saved-lists');
    const ownerSave = doc.getElementById('bc-save-list');
    const ownerDelete = doc.getElementById('bc-delete-list');
    if (!row || !publicSave || !ownerRow || !ownerSelect || !ownerSave || !ownerDelete) return null;

    ownerRow.style.display = 'none';
    ownerRow.setAttribute('aria-hidden', 'true');
    [legacyGroupClear, legacyGroupSelect, legacyGroupList, legacyGroupDelete].forEach(node => {
      if (!node) return;
      node.style.display = 'none';
      node.setAttribute('aria-hidden', 'true');
    });

    row.classList.add('bc-recipient-tag-canonical-row');
    publicSave.style.display = '';
    publicSave.hidden = false;
    publicSave.removeAttribute('aria-hidden');
    publicSave.textContent = '＋ 保存为标签';
    publicSave.title = '把当前选择的联系人和群组保存为自定义群发标签';

    let label = row.querySelector('#broadcast-recipient-tag-label');
    if (!label) {
      label = doc.createElement('strong');
      label.id = 'broadcast-recipient-tag-label';
      label.textContent = '自定义标签';
      row.insertBefore(label, row.firstChild);
    }

    let list = row.querySelector('#broadcast-recipient-tag-list');
    if (!list) {
      list = doc.createElement('div');
      list.id = 'broadcast-recipient-tag-list';
      list.className = 'bc-original-tag-list bc-recipient-tag-list';
      row.insertBefore(list, publicSave);
    }

    let status = row.querySelector('#broadcast-recipient-tag-status');
    if (!status) {
      status = doc.createElement('span');
      status.id = 'broadcast-recipient-tag-status';
      status.className = 'bc-recipient-tag-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.textContent = '选择联系人或群组后，点“保存为标签”即可复用这批收件人';
      row.appendChild(status);
    }

    if (!doc.getElementById('broadcast-recipient-tag-style')) {
      const style = doc.createElement('style');
      style.id = 'broadcast-recipient-tag-style';
      style.textContent = `
        #broadcast-overlay .bc-saved-row{display:none!important}
        #broadcast-overlay .bc-recipient-tag-canonical-row{display:grid!important;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:6px;margin:4px 0 2px;padding:6px 7px;border-top:1px dashed var(--border-subtle);border-radius:5px;background:color-mix(in srgb,var(--accent) 3%,transparent)}
        #broadcast-overlay #broadcast-recipient-tag-label{font-size:11px;color:var(--text-secondary);white-space:nowrap}
        #broadcast-overlay #broadcast-save-group{display:inline-flex!important;align-items:center!important;height:27px;padding:2px 9px;font-size:11px;white-space:nowrap}
        #broadcast-overlay #broadcast-show-all-groups,#broadcast-overlay #broadcast-saved-groups,#broadcast-overlay #bc-group-tag-list,#broadcast-overlay #broadcast-delete-group{display:none!important}
        #broadcast-overlay .bc-recipient-tag-list{display:flex;min-width:0;align-items:center;gap:5px;overflow-x:auto;overflow-y:hidden;padding:1px 0}
        #broadcast-overlay .bc-recipient-tag-empty{font-size:10.5px;color:var(--text-tertiary);white-space:nowrap}
        #broadcast-overlay .bc-recipient-tag-status{grid-column:1/-1;min-height:15px;font-size:10px;color:var(--text-tertiary)}
        #broadcast-overlay .bc-recipient-tag-status[data-state="pending"]{color:var(--accent)}
        #broadcast-overlay .bc-recipient-tag-status[data-state="ok"]{color:var(--accent)}
        #broadcast-overlay .bc-recipient-tag-status[data-state="error"]{color:#f56c6c}
        #broadcast-overlay .bc-recipient-tag-status[data-state="warn"]{color:#d97706}
      `;
      doc.head.appendChild(style);
    }

    return {
      row,
      publicSave,
      list,
      status,
      ownerRow,
      ownerSelect,
      ownerSave,
      ownerDelete,
      legacyGroupClear,
    };
  }

  function renderTags(doc = document, activeIndex = -1) {
    const controls = ensureCanonicalSurface(doc);
    if (!controls) return [];
    const presets = optionPresets(controls.ownerSelect);
    controls.list.replaceChildren();
    if (!presets.length) {
      const empty = doc.createElement('span');
      empty.className = 'bc-recipient-tag-empty';
      empty.textContent = '暂无自定义标签';
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
      open.title = `直接恢复这批群发对象（${preset.count} 个联系人/群组）`;
      open.onclick = () => applyPreset(preset.index, doc);

      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'bc-original-tag__remove';
      remove.textContent = '×';
      remove.title = '删除这个自定义标签';
      remove.onclick = event => {
        event.stopPropagation();
        void deletePreset(preset.index, doc);
      };

      chip.append(open, remove);
      controls.list.appendChild(chip);
    });
    return presets;
  }

  async function durablePresetCount(accountId) {
    const data = await window.api.accountData.getAll(accountId);
    return parsePresets(data?.savedLists).length;
  }

  async function verifyDurableCount(accountId, expectedCount, doc = document) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (activeAccountId(doc) !== accountId) return { ok: false, switched: true };
      try {
        const count = await durablePresetCount(accountId);
        if (count === expectedCount) return { ok: true, count };
      } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    return { ok: false, switched: false };
  }

  function applyPreset(index, doc = document) {
    const controls = ensureCanonicalSurface(doc);
    if (!controls) return false;
    const option = controls.ownerSelect.options[index + 1];
    if (!option || typeof controls.ownerSelect.onchange !== 'function') {
      setStatus(doc, '标签恢复失败：群发编辑器尚未初始化完成', 'error');
      return false;
    }

    // Clear the old group-only filter first, then replace the real app.js selection.
    if (typeof controls.legacyGroupClear?.onclick === 'function') controls.legacyGroupClear.onclick.call(controls.legacyGroupClear);
    const clear = doc.getElementById('broadcast-clear');
    if (typeof clear?.onclick === 'function') clear.onclick.call(clear);
    controls.ownerSelect.value = String(index);
    controls.ownerSelect.onchange.call(controls.ownerSelect);

    const expected = optionPresets(controls.ownerSelect)[index]?.count || 0;
    const visible = doc.querySelectorAll('#bc-selected-chips .bc-selected-chip').length;
    renderTags(doc, index);
    if (visible < expected) {
      setStatus(doc, `已恢复标签；其中 ${expected - visible} 个对象当前不可用，已跳过`, 'warn');
    } else {
      setStatus(doc, `已恢复标签，共 ${visible} 个联系人/群组`, 'ok');
    }
    return true;
  }

  async function deletePreset(index, doc = document) {
    const controls = ensureCanonicalSurface(doc);
    if (!controls) return false;
    const option = controls.ownerSelect.options[index + 1];
    if (!option || typeof controls.ownerDelete.onclick !== 'function') {
      setStatus(doc, '标签删除失败：群发编辑器尚未初始化完成', 'error');
      return false;
    }
    const accountId = activeAccountId(doc);
    const before = optionPresets(controls.ownerSelect).length;
    controls.ownerSelect.value = String(index);
    invokeOwnerHandler(controls.ownerDelete);
    const after = optionPresets(controls.ownerSelect).length;
    renderTags(doc);
    if (after === before) return false; // owner confirm was cancelled or owner refused deletion.
    setStatus(doc, '标签已从界面删除，正在确认账号存储…', 'pending');
    const verified = await verifyDurableCount(accountId, after, doc);
    if (verified.switched) return true;
    if (!verified.ok) {
      setStatus(doc, '标签删除未能写入账号存储，请重新打开群发后重试', 'error');
      return false;
    }
    setStatus(doc, '标签已删除', 'ok');
    return true;
  }

  async function saveCurrent(doc = document) {
    if (savePending) return false;
    const controls = ensureCanonicalSurface(doc);
    if (!controls) return false;
    const accountId = activeAccountId(doc);
    if (!accountId) {
      setStatus(doc, '请先选择账号', 'error');
      return false;
    }
    if (typeof controls.ownerSave.onclick !== 'function') {
      setStatus(doc, '保存入口已触发，但群发编辑器 owner 尚未初始化', 'error');
      return false;
    }

    savePending = true;
    controls.publicSave.disabled = true;
    const before = optionPresets(controls.ownerSelect).length;
    setStatus(doc, '保存按钮已触发，请输入自定义标签名称', 'pending');
    try {
      // Direct function call: no synthetic click, no capture listener, no event replay.
      // app.js remains the single owner of broadcastSelected and savedLists.
      invokeOwnerHandler(controls.ownerSave);
    } catch (error) {
      setStatus(doc, `保存标签失败：${String(error?.message || error)}`, 'error');
      return false;
    } finally {
      controls.publicSave.disabled = false;
      savePending = false;
    }

    const after = optionPresets(controls.ownerSelect).length;
    renderTags(doc, after - 1);
    if (after === before) {
      setStatus(doc, '未保存：已取消名称输入，或当前没有可保存的联系人/群组', 'warn');
      return false;
    }

    setStatus(doc, '标签已出现在列表中，正在确认账号存储…', 'pending');
    const verified = await verifyDurableCount(accountId, after, doc);
    if (verified.switched) return true;
    if (!verified.ok) {
      setStatus(doc, '标签只出现在界面，账号存储未确认；请不要依赖该标签', 'error');
      return false;
    }
    setStatus(doc, `标签保存成功；当前共有 ${after} 个自定义标签`, 'ok');
    return true;
  }

  function observeOwner(doc = document) {
    const controls = ensureCanonicalSurface(doc);
    if (!controls || typeof MutationObserver === 'undefined') return;
    ownerObserver?.disconnect?.();
    ownerObserver = new MutationObserver(() => renderTags(doc));
    ownerObserver.observe(controls.ownerSelect, { childList: true, subtree: true, characterData: true });
  }

  function install(doc = document) {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    const controls = ensureCanonicalSurface(doc);
    if (!controls) return;

    // This is the one public save control already under the recipient picker.
    // No capture-phase interception and no stopImmediatePropagation are used.
    controls.publicSave.onclick = () => { void saveCurrent(doc); };
    renderTags(doc);
    observeOwner(doc);

    window.GeekBroadcastRecipientTagsInstance = Object.freeze({
      render: () => renderTags(doc),
      save: () => saveCurrent(doc),
      apply: index => applyPreset(index, doc),
      remove: index => deletePreset(index, doc),
      dispose: () => { ownerObserver?.disconnect?.(); ownerObserver = null; },
    });
  }

  return Object.freeze({ parsePresets, optionPresets, invokeOwnerHandler, ensureCanonicalSurface, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastRecipientTags.install(), { once: true });
  else window.GeekBroadcastRecipientTags.install();
}
