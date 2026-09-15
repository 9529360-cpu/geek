(function (root) {
  'use strict';

  const STORAGE_VERSION = 1;
  const MAX_NOTE_LENGTH = 2000;
  const MAX_ENTRIES = 2000;
  const FOLLOW_STATUSES = Object.freeze(['', 'new', 'following', 'quoting', 'won', 'paused', 'lost']);
  const FOLLOW_STATUS_LABELS = Object.freeze({ new: '新客户', following: '跟进中', quoting: '待报价', won: '已成交', paused: '暂缓', lost: '已流失' });
  const FAMILY_LABELS = Object.freeze({ whatsapp: 'WhatsApp', telegram: 'Telegram', line: 'LINE' });
  const EMPTY_PROFILE = Object.freeze({ name: '', country: '', source: '', followStatus: '', nextFollowUp: '', notes: '' });

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

  function cleanText(value, maxLength, fieldName) {
    const text = String(value || '').trim();
    if (text.length > maxLength) throw new Error(`${fieldName}不能超过 ${maxLength} 字`);
    return text;
  }

  function normalizeProfile(value) {
    const record = value && typeof value === 'object' ? value : {};
    // 兼容第一版仅含 text 的备注记录。
    const notes = typeof record.notes === 'string' ? record.notes : (typeof record.text === 'string' ? record.text : '');
    return {
      name: String(record.name || '').slice(0, 100),
      country: String(record.country || '').slice(0, 80),
      source: String(record.source || '').slice(0, 100),
      followStatus: FOLLOW_STATUSES.includes(record.followStatus) ? record.followStatus : '',
      nextFollowUp: typeof record.nextFollowUp === 'string' ? record.nextFollowUp.slice(0, 16) : '',
      notes: String(notes).slice(0, MAX_NOTE_LENGTH),
    };
  }

  function profileFor(raw, identity) {
    const record = identity && parseStore(raw).items[identity.key];
    return record ? normalizeProfile(record) : { ...EMPTY_PROFILE };
  }

  function hasProfile(profile) { return Object.values(normalizeProfile(profile)).some(Boolean); }

  function updateStore(raw, identity, input, now) {
    if (!identity) throw new Error('请先打开一个聊天');
    const value = input && typeof input === 'object' ? input : { notes: input };
    const profile = {
      name: cleanText(value.name, 100, '客户名称'),
      country: cleanText(value.country, 80, '国家/地区'),
      source: cleanText(value.source, 100, '来源渠道'),
      followStatus: FOLLOW_STATUSES.includes(value.followStatus) ? value.followStatus : '',
      nextFollowUp: cleanText(value.nextFollowUp, 16, '下次跟进时间'),
      notes: cleanText(value.notes, MAX_NOTE_LENGTH, '备注'),
    };
    if (profile.nextFollowUp && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(profile.nextFollowUp)) throw new Error('下次跟进时间格式无效');
    const store = parseStore(raw);
    if (!hasProfile(profile)) delete store.items[identity.key];
    else {
      if (!store.items[identity.key] && Object.keys(store.items).length >= MAX_ENTRIES) throw new Error('当前账号的客户资料数量已达上限');
      store.items[identity.key] = { ...profile, updatedAt: Number(now) || Date.now() };
    }
    return store;
  }

  function create(options) {
    const button = document.getElementById('btn-contact-notes');
    const popover = document.getElementById('contact-notes-popover');
    const close = document.getElementById('contact-notes-close');
    const chat = document.getElementById('contact-notes-chat');
    const fields = {
      name: document.getElementById('contact-notes-name'), country: document.getElementById('contact-notes-country'),
      source: document.getElementById('contact-notes-source'), followStatus: document.getElementById('contact-notes-follow-status'),
      nextFollowUp: document.getElementById('contact-notes-next-follow-up'), notes: document.getElementById('contact-notes-text'),
    };
    const count = document.getElementById('contact-notes-count');
    const save = document.getElementById('contact-notes-save');
    const remove = document.getElementById('contact-notes-delete');
    const status = document.getElementById('contact-notes-status');
    let identity = null;
    let contextToken = '';
    let contextGeneration = 0;

    function setStatus(message, state) { status.textContent = message || ''; status.dataset.state = state || 'idle'; }
    function updateCount() { count.textContent = `${fields.notes.value.length} / ${MAX_NOTE_LENGTH}`; }
    function readForm() { return Object.fromEntries(Object.entries(fields).map(([key, element]) => [key, element.value])); }
    function renderForm(profile) { for (const [key, element] of Object.entries(fields)) element.value = profile[key] || ''; updateCount(); }
    function setEnabled(enabled) { for (const element of Object.values(fields)) element.disabled = !enabled; save.disabled = !enabled; }
    function updateSummary(profile) {
      const details = [profile.name, FOLLOW_STATUS_LABELS[profile.followStatus]].filter(Boolean);
      chat.textContent = details.length ? `${details.join(' · ')}  —  ${FAMILY_LABELS[identity.family]} · ${identity.chatId}` : `${FAMILY_LABELS[identity.family]} · ${identity.chatId}`;
    }
    function isCurrentContext(token, generation) {
      return token === contextToken && generation === contextGeneration;
    }
    function focusInitialControl() {
      const firstEnabledField = Object.values(fields).find(element => !element.disabled);
      (firstEnabledField || close).focus({ preventScroll: true });
    }
    async function refresh() {
      const context = await options.getContext();
      identity = context && normalizeIdentity(context.family, context.chatId);
      const nextToken = context && identity ? `${context.accountId}\u001f${identity.key}` : '';
      if (!identity) {
        if (contextToken) contextGeneration += 1;
        contextToken = ''; chat.textContent = '请先打开一个聊天'; chat.dataset.state = 'idle';
        renderForm(EMPTY_PROFILE); setEnabled(false); remove.disabled = true; return;
      }
      const profile = profileFor(options.getStorage(), identity);
      if (nextToken !== contextToken) {
        contextToken = nextToken;
        contextGeneration += 1;
        renderForm(profile);
        setStatus('', 'idle');
      }
      updateSummary(profile); chat.dataset.state = 'ready'; setEnabled(true); remove.disabled = !hasProfile(profile);
    }
    async function saveProfile() {
      const ownerIdentity = identity;
      const ownerToken = contextToken;
      const ownerGeneration = contextGeneration;
      try {
        const store = updateStore(options.getStorage(), ownerIdentity, readForm());
        const raw = JSON.stringify(store);
        const ok = Object.keys(store.items).length ? await options.setStorage(raw) : await options.removeStorage();
        if (ok === false) throw new Error('账号数据保存失败');
        if (!isCurrentContext(ownerToken, ownerGeneration)) return true;
        const profile = profileFor(raw, ownerIdentity);
        renderForm(profile); updateSummary(profile); remove.disabled = !hasProfile(profile); setStatus('客户资料已保存', 'success');
        return true;
      } catch (error) {
        if (isCurrentContext(ownerToken, ownerGeneration)) setStatus(error.message || '保存失败', 'error');
        return false;
      }
    }
    async function deleteProfile() {
      if (!identity) return;
      const ownerToken = contextToken;
      const ownerGeneration = contextGeneration;
      renderForm(EMPTY_PROFILE);
      if (await saveProfile() && isCurrentContext(ownerToken, ownerGeneration)) setStatus('客户资料已删除', 'success');
    }
    function hide({ restoreFocus = true } = {}) {
      if (popover.classList.contains('hidden')) return;
      popover.classList.add('hidden');
      popover.setAttribute('aria-hidden', 'true');
      button.setAttribute('aria-expanded', 'false');
      if (restoreFocus) button.focus({ preventScroll: true });
    }
    function bind() {
      button.setAttribute('aria-controls', 'contact-notes-popover');
      button.setAttribute('aria-haspopup', 'dialog');
      popover.setAttribute('aria-hidden', 'true');
      button.addEventListener('click', async event => {
        event.stopPropagation();
        if (!popover.classList.contains('hidden')) return hide();
        popover.classList.remove('hidden');
        popover.setAttribute('aria-hidden', 'false');
        button.setAttribute('aria-expanded', 'true');
        await refresh();
        if (!popover.classList.contains('hidden')) focusInitialControl();
      });
      close.addEventListener('click', () => hide());
      popover.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        hide();
      });
      for (const element of Object.values(fields)) element.addEventListener('input', () => { updateCount(); setStatus('', 'idle'); });
      save.addEventListener('click', saveProfile); remove.addEventListener('click', deleteProfile);
      document.addEventListener('click', event => {
        if (!popover.contains(event.target) && !button.contains(event.target)) hide({ restoreFocus: false });
      });
      popover.addEventListener('click', event => event.stopPropagation());
      setInterval(() => { if (!popover.classList.contains('hidden')) void refresh(); }, 1000);
    }
    return Object.freeze({ bind, refresh });
  }

  root.GeekContactNotes = Object.freeze({ create, normalizeIdentity, parseStore, normalizeProfile, profileFor, hasProfile, updateStore, MAX_NOTE_LENGTH, MAX_ENTRIES, FOLLOW_STATUSES });
})(typeof window !== 'undefined' ? window : globalThis);
