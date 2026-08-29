(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastRecipientTags = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  let installed = false;

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

  function activeAccountId(doc = document) {
    return String(doc.querySelector('.nav-account.active[data-id]')?.dataset.id || '');
  }

  function presetKey(preset) {
    return `${String(preset?.name || '')}\u0000${(preset?.ids || []).join('\u0001')}`;
  }

  function setWorkbenchStatus(doc, text) {
    const status = doc.getElementById('broadcast-workbench-status')?.querySelector('span');
    if (status) status.textContent = text;
  }

  function ensureShell(doc = document) {
    const legacySave = doc.getElementById('bc-save-list');
    const legacyRow = legacySave?.closest?.('.bc-saved-row');
    if (!legacySave || !legacyRow) return null;

    let shell = doc.getElementById('broadcast-recipient-tags');
    if (!shell) {
      shell = doc.createElement('section');
      shell.id = 'broadcast-recipient-tags';
      shell.className = 'bc-original-saved-block';

      const title = doc.createElement('div');
      title.className = 'bc-original-saved-title';
      title.textContent = '收件人标签';

      const list = doc.createElement('div');
      list.className = 'bc-original-tag-list';
      list.setAttribute('role', 'list');
      list.setAttribute('aria-label', '已保存的收件人标签');

      const actions = doc.createElement('div');
      actions.className = 'bc-original-saved-actions';
      const save = doc.createElement('button');
      save.type = 'button';
      save.id = 'broadcast-save-recipient-tag';
      save.className = 'bc-btn bc-btn--small';
      save.textContent = '＋ 保存当前选择为标签';
      save.title = '把当前选择的联系人和群组保存成当前账号可复用的标签';
      actions.appendChild(save);

      shell.append(title, list, actions);
      legacyRow.parentElement?.insertBefore(shell, legacyRow);
    }

    // The legacy select/delete controls remain as the in-memory state bridge only.
    // Product users interact with the explicit tag chips instead of a hidden dropdown.
    legacyRow.style.display = 'none';
    return shell;
  }

  async function readCurrentPresets(doc = document) {
    const accountId = activeAccountId(doc);
    if (!accountId) return { accountId: '', presets: [] };
    const data = await window.api.accountData.getAll(accountId);
    if (activeAccountId(doc) !== accountId) return { accountId: '', presets: [] };
    return { accountId, presets: parsePresets(data?.savedLists) };
  }

  function applyPreset(index, preset, doc = document) {
    const clear = doc.getElementById('broadcast-clear');
    const select = doc.getElementById('bc-saved-lists');
    if (!select || typeof select.onchange !== 'function') {
      window.alert?.('收件人标签暂时无法应用，请重新打开群发窗口');
      return false;
    }

    // Saved tags are exact reusable recipient sets. Clear any manual selection first
    // so applying a tag cannot silently add stale recipients from the current draft.
    if (clear && typeof clear.onclick === 'function') clear.onclick.call(clear);
    select.value = String(index);
    select.onchange.call(select);
    setWorkbenchStatus(doc, `已应用收件人标签「${preset.name}」· ${preset.ids.length} 个对象`);

    doc.querySelectorAll('#broadcast-recipient-tags .bc-original-tag').forEach(node => node.classList.remove('active'));
    doc.querySelector(`#broadcast-recipient-tags .bc-original-tag[data-preset-index="${index}"]`)?.classList.add('active');
    return true;
  }

  async function deletePreset(index, preset, doc = document) {
    const accountId = activeAccountId(doc);
    if (!accountId) return false;
    if (!window.confirm?.(`删除收件人标签「${preset.name}」？`)) return false;

    try {
      const data = await window.api.accountData.getAll(accountId);
      if (activeAccountId(doc) !== accountId) return false;
      const current = parsePresets(data?.savedLists);
      const wanted = presetKey(preset);
      let actualIndex = current[index] && presetKey(current[index]) === wanted
        ? index
        : current.findIndex(item => presetKey(item) === wanted);
      if (actualIndex < 0) {
        await render(doc);
        return true;
      }
      const next = current.filter((_item, itemIndex) => itemIndex !== actualIndex);
      await window.api.accountData.set(accountId, 'savedLists', JSON.stringify(next));
      if (activeAccountId(doc) !== accountId) return true;

      // Keep app.js's established in-memory savedLists state aligned only after the
      // durable write succeeded. Its handler writes the same resulting list again.
      const select = doc.getElementById('bc-saved-lists');
      const legacyDelete = doc.getElementById('bc-delete-list');
      if (select && typeof legacyDelete?.onclick === 'function') {
        select.value = String(actualIndex);
        const originalConfirm = window.confirm;
        try {
          window.confirm = () => true;
          legacyDelete.onclick.call(legacyDelete);
        } finally {
          window.confirm = originalConfirm;
        }
      }

      setWorkbenchStatus(doc, `已删除收件人标签「${preset.name}」`);
      await render(doc, next);
      return true;
    } catch (error) {
      window.alert?.(`删除收件人标签失败：${String(error?.message || error)}`);
      return false;
    }
  }

  async function saveCurrent(doc = document) {
    const legacySave = doc.getElementById('bc-save-list');
    const closure = window.GeekBroadcastProductClosureInstance;
    if (!legacySave || typeof closure?.persistRecipientPreset !== 'function') {
      window.alert?.('收件人标签功能尚未就绪，请重新打开群发窗口');
      return false;
    }
    const saved = await closure.persistRecipientPreset(legacySave);
    if (saved) await render(doc);
    return saved;
  }

  async function render(doc = document, knownPresets = null) {
    const shell = ensureShell(doc);
    if (!shell) return [];
    const list = shell.querySelector('.bc-original-tag-list');
    if (!list) return [];

    let presets = knownPresets;
    if (!Array.isArray(presets)) {
      const current = await readCurrentPresets(doc).catch(error => {
        console.warn('收件人标签读取失败:', error?.message || error);
        return { accountId: '', presets: [] };
      });
      if (!current.accountId && activeAccountId(doc)) return [];
      presets = current.presets;
    }

    list.replaceChildren();
    if (!presets.length) {
      const empty = doc.createElement('span');
      empty.className = 'bc-original-empty';
      empty.textContent = '还没有标签。先选择联系人或群组，再保存当前选择。';
      list.appendChild(empty);
      return presets;
    }

    const fragment = doc.createDocumentFragment();
    presets.forEach((preset, index) => {
      const tag = doc.createElement('span');
      tag.className = 'bc-original-tag';
      tag.dataset.presetIndex = String(index);
      tag.setAttribute('role', 'listitem');

      const open = doc.createElement('button');
      open.type = 'button';
      open.className = 'bc-original-tag__open';
      open.title = `使用「${preset.name}」的 ${preset.ids.length} 个收件人`;
      const label = doc.createElement('span');
      label.textContent = preset.name;
      const count = doc.createElement('em');
      count.textContent = String(preset.ids.length);
      open.append(label, count);
      open.onclick = () => applyPreset(index, preset, doc);

      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'bc-original-tag__remove';
      remove.textContent = '×';
      remove.title = `删除标签「${preset.name}」`;
      remove.setAttribute('aria-label', `删除收件人标签 ${preset.name}`);
      remove.onclick = event => {
        event.stopPropagation();
        void deletePreset(index, preset, doc);
      };

      tag.append(open, remove);
      fragment.appendChild(tag);
    });
    list.appendChild(fragment);
    return presets;
  }

  function install(doc = document) {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    ensureShell(doc);
    void render(doc);

    doc.getElementById('broadcast-save-recipient-tag')?.addEventListener('click', () => {
      void saveCurrent(doc);
    });

    doc.addEventListener('click', event => {
      const open = event.target?.closest?.('#bc-menu-send');
      if (open) setTimeout(() => void render(doc), 0);
    });

    window.GeekBroadcastRecipientTagsInstance = Object.freeze({
      render: () => render(doc),
      saveCurrent: () => saveCurrent(doc),
      applyPreset: (index, preset) => applyPreset(index, preset, doc),
      deletePreset: (index, preset) => deletePreset(index, preset, doc),
    });
  }

  return Object.freeze({ parsePresets, presetKey, applyPreset, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastRecipientTags.install(), { once: true });
  else window.GeekBroadcastRecipientTags.install();
}
