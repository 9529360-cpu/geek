(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekBroadcastRecipientTags = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  let installed = false;
  let refreshSequence = 0;

  function activeAccountId(doc = document) {
    return String(doc.querySelector('.nav-account.active[data-id]')?.dataset.id || '');
  }

  function isGroupId(value) {
    return String(value || '').toLowerCase().endsWith('@g.us');
  }

  function selectedContactIds(doc = document) {
    return [...doc.querySelectorAll('#bc-selected-chips .bc-selected-chip button[data-id]')]
      .map(button => String(button.dataset.id || '').trim())
      .filter(id => id && !isGroupId(id));
  }

  function normalizeLabels(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => {
      if (!item || typeof item !== 'object') return null;
      const id = String(item.id || '').trim();
      const name = String(item.name || '').trim();
      if (!id || !name) return null;
      return {
        id,
        name,
        count: Math.max(0, Number(item.count) || 0),
        hexColor: String(item.hexColor || ''),
      };
    }).filter(Boolean);
  }

  function setStatus(doc, text, state = 'idle') {
    const status = doc.getElementById('broadcast-native-label-status');
    if (!status) return;
    status.textContent = String(text || '');
    status.dataset.state = state;
  }

  function makeOption(doc, value, text) {
    const option = doc.createElement('option');
    option.value = String(value || '');
    option.textContent = String(text || '');
    return option;
  }

  async function listAccounts() {
    const listed = await window.api.accounts.list();
    return listed?.accounts || listed || [];
  }

  function webviewForAccount(account, doc = document) {
    if (!account) return null;
    return [...doc.querySelectorAll('webview')].find(wv =>
      String(wv.partition || wv.getAttribute?.('partition') || '') === String(account.partition || '')
    ) || null;
  }

  async function activeWhatsAppContext(doc = document) {
    const accountId = activeAccountId(doc);
    if (!accountId) throw new Error('请先选择账号');
    const accounts = await listAccounts();
    const account = accounts.find(item => String(item.id) === accountId);
    if (!account) throw new Error('当前账号不存在');
    if (!(account.type === 'whatsapp' || account.type === 'whatsapp-pure')) {
      throw new Error('联系人标签目前仅支持 WhatsApp');
    }
    const wv = webviewForAccount(account, doc);
    if (!wv) throw new Error('WhatsApp 页面尚未就绪');
    return { accountId, account, wv };
  }

  function ensureControls(doc = document) {
    // PR #241 accidentally introduced a second, Geek-local recipient tag surface.
    // Native WhatsApp labels already have a product entry in this editor, so keep a
    // single surface and remove the duplicate if a hot-reloaded renderer still has it.
    doc.getElementById('broadcast-recipient-tags')?.remove();

    const body = doc.getElementById('bc-sendto-label');
    const select = doc.getElementById('bc-label-select');
    if (!body || !select) return null;

    const radio = doc.querySelector('input[name="bc-sendto"][value="label"]');
    const radioCopy = radio?.closest?.('.bc-radio')?.querySelector('span');
    if (radioCopy) radioCopy.textContent = 'WhatsApp 联系人标签';

    let helper = doc.getElementById('broadcast-native-label-helper');
    if (!helper) {
      helper = doc.createElement('div');
      helper.id = 'broadcast-native-label-helper';
      helper.className = 'bc-native-label-helper';

      const save = doc.createElement('button');
      save.type = 'button';
      save.id = 'broadcast-save-native-label';
      save.className = 'bc-btn bc-btn--small';
      save.textContent = '＋ 将当前已选联系人保存为标签';
      save.title = '把上方已经勾选的联系人写入 WhatsApp 原生标签，之后可直接按标签群发';

      const status = doc.createElement('span');
      status.id = 'broadcast-native-label-status';
      status.className = 'bc-native-label-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.textContent = '选择已有标签，或把当前已选联系人保存成新标签';

      helper.append(save, status);
      select.insertAdjacentElement('afterend', helper);
    }

    if (!doc.getElementById('broadcast-native-label-style')) {
      const style = doc.createElement('style');
      style.id = 'broadcast-native-label-style';
      style.textContent = `
        #bc-sendto-label .bc-native-label-helper{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:7px}
        #bc-sendto-label .bc-native-label-status{min-width:0;flex:1;color:var(--text-tertiary);font-size:10.5px;line-height:1.4}
        #bc-sendto-label .bc-native-label-status[data-state="ok"]{color:var(--accent)}
        #bc-sendto-label .bc-native-label-status[data-state="error"]{color:#d97706}
      `;
      doc.head.appendChild(style);
    }

    // Keep the pre-existing group collection control clearly distinct. It is not the
    // contact-label feature and must not be mistaken for a second recipient label UI.
    const groupSave = doc.getElementById('broadcast-save-group');
    if (groupSave) {
      groupSave.textContent = '保存群组集合';
      groupSave.title = '仅保存当前选择中的群组，用于群组筛选；联系人请使用“WhatsApp 联系人标签”';
    }
    const groupList = doc.getElementById('bc-group-tag-list');
    if (groupList) groupList.setAttribute('aria-label', '已保存的群组集合');

    return { body, select, save: doc.getElementById('broadcast-save-native-label') };
  }

  async function readNativeLabels(doc = document) {
    const ctx = await activeWhatsAppContext(doc);
    const result = await ctx.wv.executeJavaScript(`(async () => {
      try {
        const W = window.WAPLUS_WPP || window.WPP;
        if (!W || !W.labels || typeof W.labels.getAllLabels !== 'function') {
          return JSON.stringify({ ok: false, code: 'LABEL_API_UNAVAILABLE' });
        }
        if (W.profile && typeof W.profile.isBusiness === 'function') {
          const business = await W.profile.isBusiness();
          if (business === false) return JSON.stringify({ ok: false, code: 'BUSINESS_REQUIRED' });
        }
        const labels = await W.labels.getAllLabels();
        return JSON.stringify({
          ok: true,
          labels: (Array.isArray(labels) ? labels : []).map(label => ({
            id: String(label && label.id || ''),
            name: String(label && label.name || ''),
            count: Number(label && label.count || 0),
            hexColor: String(label && label.hexColor || ''),
          })),
        });
      } catch (error) {
        return JSON.stringify({ ok: false, code: 'READ_FAILED', error: String(error && error.message || error) });
      }
    })()`);
    let payload;
    try { payload = JSON.parse(String(result || '{}')); } catch (_) { payload = { ok: false, code: 'READ_FAILED' }; }
    return { ...payload, accountId: ctx.accountId, labels: normalizeLabels(payload?.labels) };
  }

  function labelErrorMessage(payload) {
    if (payload?.code === 'BUSINESS_REQUIRED') return '当前 WhatsApp 账号不支持商务标签';
    if (payload?.code === 'LABEL_API_UNAVAILABLE') return 'WhatsApp 标签能力尚未就绪，请稍后重试';
    if (payload?.error) return `读取 WhatsApp 标签失败：${payload.error}`;
    return '读取 WhatsApp 标签失败，请稍后重试';
  }

  async function refreshLabels(doc = document, preferredId = '') {
    const controls = ensureControls(doc);
    if (!controls) return [];
    const sequence = ++refreshSequence;
    const accountId = activeAccountId(doc);
    if (!accountId) {
      controls.select.replaceChildren(makeOption(doc, '', '请先选择账号'));
      return [];
    }

    setStatus(doc, '正在读取 WhatsApp 标签…');
    try {
      const payload = await readNativeLabels(doc);
      if (sequence !== refreshSequence || payload.accountId !== activeAccountId(doc)) return [];
      if (!payload.ok) {
        controls.select.replaceChildren(makeOption(doc, '', payload.code === 'BUSINESS_REQUIRED' ? '当前账号无商务标签' : '标签暂不可用'));
        setStatus(doc, labelErrorMessage(payload), 'error');
        return [];
      }

      const previous = String(preferredId || controls.select.value || '');
      controls.select.replaceChildren(makeOption(doc, '', payload.labels.length ? '选择 WhatsApp 标签…' : '暂无 WhatsApp 标签'));
      payload.labels.forEach(label => controls.select.appendChild(makeOption(doc, label.id, `${label.name}（${label.count}）`)));
      if (previous && payload.labels.some(label => label.id === previous)) controls.select.value = previous;
      setStatus(doc, payload.labels.length ? `已读取 ${payload.labels.length} 个 WhatsApp 标签` : '还没有标签，可把当前已选联系人保存为新标签', 'ok');
      return payload.labels;
    } catch (error) {
      if (sequence !== refreshSequence) return [];
      controls.select.replaceChildren(makeOption(doc, '', '标签暂不可用'));
      setStatus(doc, String(error?.message || error), 'error');
      return [];
    }
  }

  async function saveSelectedContacts(doc = document) {
    const controls = ensureControls(doc);
    if (!controls?.save || controls.save.dataset.pending === '1') return false;
    const ids = [...new Set(selectedContactIds(doc))];
    if (!ids.length) {
      window.alert?.('请先在上方选择至少一个联系人；群组集合请使用“保存群组集合”。');
      return false;
    }
    const name = String(window.prompt?.('保存为 WhatsApp 联系人标签：', '客户标签') || '').trim().slice(0, 80);
    if (!name) return false;

    controls.save.dataset.pending = '1';
    controls.save.disabled = true;
    controls.save.textContent = '正在保存…';
    setStatus(doc, `正在把 ${ids.length} 个联系人写入 WhatsApp 标签…`);
    try {
      const ctx = await activeWhatsAppContext(doc);
      const result = await ctx.wv.executeJavaScript(`(async () => {
        try {
          const W = window.WAPLUS_WPP || window.WPP;
          if (!W || !W.labels || typeof W.labels.getAllLabels !== 'function' || typeof W.labels.addNewLabel !== 'function' || typeof W.labels.addOrRemoveLabels !== 'function') {
            return JSON.stringify({ ok: false, code: 'LABEL_API_UNAVAILABLE' });
          }
          if (W.profile && typeof W.profile.isBusiness === 'function') {
            const business = await W.profile.isBusiness();
            if (business === false) return JSON.stringify({ ok: false, code: 'BUSINESS_REQUIRED' });
          }
          const wantedName = ${JSON.stringify(name)};
          const chatIds = ${JSON.stringify(ids)};
          let labels = await W.labels.getAllLabels();
          labels = Array.isArray(labels) ? labels : [];
          let label = labels.find(item => String(item && item.name || '').trim().toLocaleLowerCase() === wantedName.toLocaleLowerCase());
          let created = false;
          if (!label) {
            label = await W.labels.addNewLabel(wantedName);
            created = true;
          }
          const labelId = String(label && label.id || '');
          if (!labelId) return JSON.stringify({ ok: false, code: 'CREATE_FAILED' });
          await W.labels.addOrRemoveLabels(chatIds, { labelId, type: 'add' });
          const after = await W.labels.getAllLabels();
          const verified = (Array.isArray(after) ? after : []).find(item => String(item && item.id || '') === labelId);
          if (!verified) return JSON.stringify({ ok: false, code: 'VERIFY_FAILED' });
          return JSON.stringify({
            ok: true,
            created,
            selectedCount: chatIds.length,
            label: {
              id: labelId,
              name: String(verified.name || wantedName),
              count: Number(verified.count || 0),
              hexColor: String(verified.hexColor || ''),
            },
          });
        } catch (error) {
          return JSON.stringify({ ok: false, code: 'SAVE_FAILED', error: String(error && error.message || error) });
        }
      })()`);
      let payload;
      try { payload = JSON.parse(String(result || '{}')); } catch (_) { payload = { ok: false, code: 'SAVE_FAILED' }; }
      if (activeAccountId(doc) !== ctx.accountId) return false;
      if (!payload.ok) {
        const text = payload.code === 'BUSINESS_REQUIRED'
          ? '当前 WhatsApp 账号不支持商务标签'
          : payload.code === 'LABEL_API_UNAVAILABLE'
            ? 'WhatsApp 标签能力尚未就绪，请稍后重试'
            : `保存 WhatsApp 标签失败${payload.error ? `：${payload.error}` : '，请重试'}`;
        setStatus(doc, text, 'error');
        window.alert?.(text);
        return false;
      }

      const labelId = String(payload.label?.id || '');
      await refreshLabels(doc, labelId);
      if (labelId) controls.select.value = labelId;
      const success = `已保存到 WhatsApp 标签「${payload.label?.name || name}」· ${ids.length} 个联系人`;
      setStatus(doc, success, 'ok');
      window.alert?.(`${success}。下次可直接在“WhatsApp 联系人标签”中选择。`);
      return true;
    } catch (error) {
      const text = `保存 WhatsApp 标签失败：${String(error?.message || error)}`;
      setStatus(doc, text, 'error');
      window.alert?.(text);
      return false;
    } finally {
      controls.save.dataset.pending = '';
      controls.save.disabled = false;
      controls.save.textContent = '＋ 将当前已选联系人保存为标签';
    }
  }

  function install(doc = document) {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    const controls = ensureControls(doc);
    controls?.save?.addEventListener('click', () => void saveSelectedContacts(doc));

    doc.addEventListener('change', event => {
      const radio = event.target?.matches?.('input[name="bc-sendto"][value="label"]') ? event.target : null;
      if (radio?.checked) void refreshLabels(doc);
    });
    doc.addEventListener('click', event => {
      const open = event.target?.closest?.('#bc-menu-send');
      const account = event.target?.closest?.('.nav-account[data-id]');
      if (open || account) setTimeout(() => {
        ensureControls(doc);
        const labelMode = doc.querySelector('input[name="bc-sendto"][value="label"]')?.checked === true;
        if (labelMode) void refreshLabels(doc);
      }, 0);
    });

    window.GeekBroadcastRecipientTagsInstance = Object.freeze({
      refreshLabels: () => refreshLabels(doc),
      saveSelectedContacts: () => saveSelectedContacts(doc),
    });
  }

  return Object.freeze({ isGroupId, selectedContactIds, normalizeLabels, install });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekBroadcastRecipientTags.install(), { once: true });
  else window.GeekBroadcastRecipientTags.install();
}
