(function (root) {
  'use strict';

  const STORAGE_VERSION = 1;
  const MAX_NOTE_LENGTH = 2000;
  const MAX_ENTRIES = 2000;
  const FAMILY_LABELS = Object.freeze({ whatsapp: 'WhatsApp', telegram: 'Telegram', line: 'LINE' });

  function normalizeIdentity(family, chatId) {
    const platform = String(family || '').trim().toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(FAMILY_LABELS, platform)) return null;
    let id = String(chatId || '').trim();
    if (platform === 'telegram') id = id.replace(/^#/, '').split('?')[0].replace(/^\/+/, '');
    if (!id || id.length > 512) return null;
    return { family: platform, chatId: id, key: `${platform}:${encodeURIComponent(id)}` };
  }

  function parseStore(raw) {
    try {
      const parsed = JSON.parse(String(raw || ''));
      if (!parsed || parsed.version !== STORAGE_VERSION || !parsed.items || typeof parsed.items !== 'object' || Array.isArray(parsed.items)) throw new Error('invalid');
      return { version: STORAGE_VERSION, items: { ...parsed.items } };
    } catch { return { version: STORAGE_VERSION, items: {} }; }
  }

  function noteFor(raw, identity) {
    const record = identity && parseStore(raw).items[identity.key];
    return record && typeof record.text === 'string' ? record.text.slice(0, MAX_NOTE_LENGTH) : '';
  }

  function updateStore(raw, identity, text, now) {
    if (!identity) throw new Error('请先打开一个聊天');
    const value = String(text || '').trim();
    if (value.length > MAX_NOTE_LENGTH) throw new Error(`备注不能超过 ${MAX_NOTE_LENGTH} 字`);
    const store = parseStore(raw);
    if (!value) delete store.items[identity.key];
    else {
      if (!store.items[identity.key] && Object.keys(store.items).length >= MAX_ENTRIES) throw new Error('当前账号的备注数量已达上限');
      store.items[identity.key] = { text: value, updatedAt: Number(now) || Date.now() };
    }
    return store;
  }

  function create(options) {
    const button = document.getElementById('btn-contact-notes');
    const popover = document.getElementById('contact-notes-popover');
    const close = document.getElementById('contact-notes-close');
    const chat = document.getElementById('contact-notes-chat');
    const textarea = document.getElementById('contact-notes-text');
    const count = document.getElementById('contact-notes-count');
    const save = document.getElementById('contact-notes-save');
    const remove = document.getElementById('contact-notes-delete');
    const status = document.getElementById('contact-notes-status');
    let identity = null;
    let contextToken = '';

    function setStatus(message, state) {
      status.textContent = message || '';
      status.dataset.state = state || 'idle';
    }
    function updateCount() { count.textContent = `${textarea.value.length} / ${MAX_NOTE_LENGTH}`; }
    async function refresh() {
      const context = await options.getContext();
      identity = context && normalizeIdentity(context.family, context.chatId);
      const nextToken = context && identity ? `${context.accountId}\u001f${identity.key}` : '';
      if (!identity) {
        contextToken = '';
        chat.textContent = '请先打开一个聊天'; chat.dataset.state = 'idle';
        textarea.value = ''; textarea.disabled = true; save.disabled = true; remove.disabled = true;
        updateCount(); return;
      }
      if (nextToken !== contextToken) {
        contextToken = nextToken;
        textarea.value = noteFor(options.getStorage(), identity);
        setStatus('', 'idle');
      }
      chat.textContent = `${FAMILY_LABELS[identity.family]} · ${identity.chatId}`;
      chat.dataset.state = 'ready'; textarea.disabled = false; save.disabled = false;
      remove.disabled = !noteFor(options.getStorage(), identity); updateCount();
    }
    async function saveNote() {
      try {
        const store = updateStore(options.getStorage(), identity, textarea.value);
        const raw = JSON.stringify(store);
        const ok = Object.keys(store.items).length ? await options.setStorage(raw) : await options.removeStorage();
        if (ok === false) throw new Error('账号数据保存失败');
        textarea.value = noteFor(raw, identity); remove.disabled = !textarea.value; updateCount(); setStatus('已保存', 'success');
      } catch (error) { setStatus(error.message || '保存失败', 'error'); }
    }
    async function deleteNote() {
      if (!identity) return;
      textarea.value = ''; await saveNote(); setStatus('备注已删除', 'success');
    }
    function hide() { popover.classList.add('hidden'); button.setAttribute('aria-expanded', 'false'); }
    function bind() {
      button.addEventListener('click', async event => {
        event.stopPropagation();
        const opening = popover.classList.contains('hidden');
        if (!opening) return hide();
        popover.classList.remove('hidden'); button.setAttribute('aria-expanded', 'true'); await refresh(); textarea.focus();
      });
      close.addEventListener('click', hide);
      textarea.addEventListener('input', () => { updateCount(); setStatus('', 'idle'); });
      save.addEventListener('click', saveNote);
      remove.addEventListener('click', deleteNote);
      document.addEventListener('click', event => { if (!popover.contains(event.target) && event.target !== button) hide(); });
      popover.addEventListener('click', event => event.stopPropagation());
      setInterval(() => { if (!popover.classList.contains('hidden')) void refresh(); }, 1000);
    }
    return Object.freeze({ bind, refresh });
  }

  root.GeekContactNotes = Object.freeze({ create, normalizeIdentity, parseStore, noteFor, updateStore, MAX_NOTE_LENGTH, MAX_ENTRIES });
})(typeof window !== 'undefined' ? window : globalThis);
