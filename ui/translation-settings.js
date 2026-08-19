/* 极客翻译设置：只负责设置体验与既有 translationGlobal / translationChats 配置编排。 */
(() => {
  'use strict';

  const LANGUAGES = Object.freeze([
    ['en','英语'],['es','西班牙语'],['fr','法语'],['de','德语'],['it','意大利语'],['pt','葡萄牙语'],['zh','中文'],['ja','日语'],['ko','韩语'],['hi','印地语'],['ar','阿拉伯语'],['ru','俄语'],['id','印尼语'],['pl','波兰语'],['tr','土耳其语'],['vi','越南语'],['nl','荷兰语'],['sv','瑞典语'],['el','希腊语'],['th','泰语']
  ]);
  const DEFAULTS = Object.freeze({
    source: 'auto', server: 'default', send: false, sendFrom: 'auto', sendTo: 'en',
    includeZh: true, displayTranslation: true, manual: true, translationMode: 'auto',
    messageFrom: 'auto', messageTo: 'zh', group: false, fontSize: '13', fontColor: '#667eea'
  });

  function parseJson(value, fallback = {}) {
    try {
      const parsed = JSON.parse(value || JSON.stringify(fallback));
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function create(deps = {}) {
    const core = deps.core;
    if (!core || typeof core.normalizeConfig !== 'function') throw new Error('翻译设置缺少公共配置核心');
    for (const name of ['getActiveId', 'getStorage', 'setStorage', 'getCurrentChat', 'sync']) {
      if (typeof deps[name] !== 'function') throw new Error(`翻译设置缺少依赖: ${name}`);
    }

    let bound = false;
    let currentChatId = '';
    let healthCheckedAt = 0;
    let healthPromise = null;
    const statusTimers = new Map();

    const el = id => document.getElementById(id);
    const value = (id, fallback = '') => el(id)?.value || fallback;
    const checked = id => !!el(id)?.checked;
    const setValue = (id, next) => { const node = el(id); if (node) node.value = String(next ?? ''); };
    const setChecked = (id, next) => { const node = el(id); if (node) node.checked = !!next; };
    const languageName = code => LANGUAGES.find(([item]) => item === code)?.[1] || code || '自动检测';

    function setStatus(id, text, kind = '') {
      const node = el(id);
      if (!node) return;
      node.textContent = text;
      node.dataset.state = kind;
      const old = statusTimers.get(id);
      if (old) clearTimeout(old);
      if (kind === 'ok') {
        statusTimers.set(id, setTimeout(() => {
          if (node.dataset.state === 'ok') { node.textContent = ''; node.dataset.state = ''; }
        }, 1800));
      }
    }

    function populateLanguages() {
      const selects = [
        ['translation-send-from', true],
        ['translation-send-to', false],
        ['translation-message-from', true],
        ['translation-message-to', false],
        ['translation-target', false],
        ['translation-channel-message-to', false]
      ];
      for (const [id, allowAuto] of selects) {
        const select = el(id);
        if (!select || select.dataset.languagesReady === '1') continue;
        select.innerHTML = `${allowAuto ? '<option value="auto">自动检测</option>' : ''}${LANGUAGES.map(([code, name]) => `<option value="${code}">${name}</option>`).join('')}`;
        select.dataset.languagesReady = '1';
      }
    }

    function globalStore() { return parseJson(deps.getStorage('translationGlobal'), {}); }
    function chatStore() { return parseJson(deps.getStorage('translationChats'), {}); }
    function globalConfig() {
      const cfg = { ...DEFAULTS, ...globalStore() };
      if (cfg.source === 'local' || cfg.source === 'remote') cfg.source = 'auto';
      return cfg;
    }

    function syncDependencies(cfg = globalConfig()) {
      const sendOn = cfg.send === true;
      const receiveAuto = cfg.displayTranslation !== false && cfg.translationMode !== 'click';
      for (const id of ['translation-send-from', 'translation-send-to']) {
        const node = el(id); if (node) node.disabled = !sendOn;
      }
      const group = el('translation-group'); if (group) group.disabled = !receiveAuto;
    }

    function refreshGlobal() {
      populateLanguages();
      const cfg = globalConfig();
      setValue('translation-source', cfg.source || 'auto');
      setValue('translation-server', cfg.server || 'default');
      setChecked('translation-send', cfg.send === true);
      setValue('translation-send-from', cfg.sendFrom || 'auto');
      setValue('translation-send-to', cfg.sendTo || 'en');
      setChecked('translation-include-zh', cfg.includeZh !== false);
      setChecked('translation-display', cfg.displayTranslation !== false);
      setChecked('translation-manual', cfg.manual !== false);
      setChecked('translation-receive-auto', cfg.displayTranslation !== false && cfg.translationMode !== 'click');
      setValue('translation-message', cfg.translationMode || 'auto');
      setValue('translation-message-from', cfg.messageFrom || 'auto');
      setValue('translation-message-to', cfg.messageTo || 'zh');
      setChecked('translation-group', cfg.group === true);
      setValue('translation-font-size', cfg.fontSize || '13');
      setValue('translation-font-color', cfg.fontColor || '#667eea');
      syncDependencies(cfg);
    }

    function collectGlobal() {
      const receiveAuto = checked('translation-receive-auto');
      const display = receiveAuto ? true : checked('translation-display');
      return {
        source: value('translation-source', 'auto'),
        server: value('translation-server', 'default'),
        send: checked('translation-send'),
        sendFrom: value('translation-send-from', 'auto'),
        sendTo: value('translation-send-to', 'en'),
        includeZh: checked('translation-include-zh'),
        displayTranslation: display,
        manual: checked('translation-manual'),
        translationMode: receiveAuto ? 'auto' : 'click',
        messageFrom: value('translation-message-from', 'auto'),
        messageTo: value('translation-message-to', 'zh'),
        group: receiveAuto && checked('translation-group'),
        fontSize: value('translation-font-size', '13'),
        fontColor: value('translation-font-color', '#667eea')
      };
    }

    async function saveGlobal() {
      if (!deps.getActiveId()) return false;
      const cfg = collectGlobal();
      setValue('translation-message', cfg.translationMode);
      syncDependencies(cfg);
      const result = await deps.setStorage('translationGlobal', JSON.stringify(cfg));
      if (result === false) {
        refreshGlobal();
        setStatus('translation-global-status', '保存失败，请重试', 'error');
        return false;
      }
      deps.sync();
      setStatus('translation-global-status', '已保存 ✓', 'ok');
      await refreshChat();
      return true;
    }

    function setChatUi(effective, hasOverride) {
      setChecked('translation-chat-override', hasOverride);
      el('translation-chat-custom')?.classList.toggle('hidden', !hasOverride);
      setChecked('translation-channel-receive-auto', effective.displayTranslation !== false && effective.translationMode !== 'click');
      setValue('translation-channel-message-to', effective.messageTarget || 'zh');
      const sendOn = effective.enabled === true && effective.autoSend !== false;
      setChecked('translation-enabled', sendOn);
      setChecked('translation-auto-send', sendOn);
      setValue('translation-target', effective.target || 'en');
      setChecked('translation-message-action', effective.messageAction !== false);
    }

    async function refreshChat() {
      populateLanguages();
      currentChatId = String(await deps.getCurrentChat() || '');
      const store = chatStore();
      const hasOverride = !!currentChatId && Object.prototype.hasOwnProperty.call(store, currentChatId);
      const effective = core.normalizeConfig(globalConfig(), hasOverride ? store[currentChatId] : {});
      setChatUi(effective, hasOverride);
      const toggle = el('translation-chat-override');
      if (toggle) toggle.disabled = !currentChatId;
      const reset = el('translation-chat-reset');
      if (reset) reset.disabled = !currentChatId || !hasOverride;
      const mode = el('translation-chat-mode');
      if (mode) {
        mode.textContent = !currentChatId ? '未检测到聊天' : (hasOverride ? '单独设置' : '跟随全局');
        mode.dataset.state = !currentChatId ? 'idle' : (hasOverride ? 'custom' : 'global');
      }
      const hint = el('translation-chat-hint');
      if (hint) {
        hint.textContent = !currentChatId
          ? '请先在当前平台打开一个聊天'
          : hasOverride
            ? `当前聊天使用单独设置 · 收到消息${effective.translationMode === 'click' ? '按需翻译' : `自动翻成${languageName(effective.messageTarget)}`}`
            : '当前聊天跟随全局设置；以后修改全局设置会自动应用到这里';
      }
      return { chatId: currentChatId, hasOverride, effective };
    }

    async function persistChats(store, successText) {
      const result = await deps.setStorage('translationChats', JSON.stringify(store));
      if (result === false) {
        setStatus('translation-chat-status', '保存失败，请重试', 'error');
        await refreshChat();
        return false;
      }
      deps.sync();
      setStatus('translation-chat-status', successText || '已保存 ✓', 'ok');
      await refreshChat();
      return true;
    }

    async function setChatOverride(enabled) {
      const chatId = String(await deps.getCurrentChat() || '');
      if (!chatId) { await refreshChat(); return false; }
      currentChatId = chatId;
      const store = chatStore();
      if (!enabled) {
        delete store[chatId];
        return persistChats(store, '已恢复全局设置 ✓');
      }
      if (!Object.prototype.hasOwnProperty.call(store, chatId)) {
        const effective = core.normalizeConfig(globalConfig(), {});
        store[chatId] = {
          enabled: effective.enabled === true,
          autoSend: effective.autoSend !== false && effective.enabled === true,
          target: effective.target || 'en',
          messageAction: effective.messageAction !== false,
          displayTranslation: effective.displayTranslation !== false,
          translationMode: effective.translationMode || 'auto',
          messageTarget: effective.messageTarget || 'zh'
        };
      }
      return persistChats(store, '已启用当前聊天单独设置 ✓');
    }

    async function saveChatField(fieldId) {
      const chatId = String(await deps.getCurrentChat() || '');
      if (!chatId) { await refreshChat(); return false; }
      currentChatId = chatId;
      const store = chatStore();
      if (!Object.prototype.hasOwnProperty.call(store, chatId)) {
        setStatus('translation-chat-status', '请先开启“单独设置”', 'error');
        await refreshChat();
        return false;
      }
      const next = { ...(store[chatId] || {}) };
      if (fieldId === 'translation-channel-receive-auto') {
        next.displayTranslation = true;
        next.translationMode = checked(fieldId) ? 'auto' : 'click';
      } else if (fieldId === 'translation-channel-message-to') {
        next.messageTarget = value(fieldId, 'zh');
      } else if (fieldId === 'translation-enabled') {
        next.enabled = checked(fieldId);
        next.autoSend = checked(fieldId);
      } else if (fieldId === 'translation-target') {
        next.target = value(fieldId, 'en');
      } else if (fieldId === 'translation-message-action') {
        next.messageAction = checked(fieldId);
      }
      store[chatId] = next;
      return persistChats(store, '当前聊天已保存 ✓');
    }

    async function checkHealth(force = false) {
      const state = el('translation-service-state');
      const detail = el('translation-gateway-status');
      if (!state || typeof deps.health !== 'function') return;
      if (!force && Date.now() - healthCheckedAt < 60000) return;
      if (healthPromise) return healthPromise;
      state.textContent = '检测中…';
      state.dataset.state = 'checking';
      if (detail && force) detail.textContent = '正在检测翻译服务…';
      healthPromise = Promise.resolve()
        .then(() => deps.health())
        .then(result => {
          healthCheckedAt = Date.now();
          const ok = result?.ok === true;
          state.textContent = ok ? '服务正常' : '服务异常';
          state.dataset.state = ok ? 'ok' : 'error';
          if (detail) detail.textContent = ok ? `翻译服务正常${result.models ? ` · ${result.models} 条线路可用` : ''}` : '翻译服务暂不可用，可稍后重试';
        })
        .catch(() => {
          healthCheckedAt = Date.now();
          state.textContent = '服务异常';
          state.dataset.state = 'error';
          if (detail) detail.textContent = '翻译服务暂不可用，可稍后重试';
        })
        .finally(() => { healthPromise = null; });
      return healthPromise;
    }

    function activateTab(name) {
      document.querySelectorAll('[data-translation-tab]').forEach(node => node.classList.toggle('active', node.dataset.translationTab === name));
      document.querySelectorAll('.translation-tab-panel').forEach(node => node.classList.toggle('hidden', node.id !== `translation-tab-${name}`));
    }

    function bind() {
      if (bound) return;
      bound = true;
      populateLanguages();
      try { localStorage.removeItem('geekTranslationGateway'); } catch {}

      const popover = el('translation-popover');
      const button = el('btn-translation');
      button?.addEventListener('click', async () => {
        const open = popover?.classList.toggle('hidden') === false;
        button.setAttribute('aria-expanded', String(open));
        if (open) {
          refreshGlobal();
          await refreshChat();
          checkHealth(false);
        }
      });
      el('translation-close')?.addEventListener('click', () => {
        popover?.classList.add('hidden');
        button?.setAttribute('aria-expanded', 'false');
      });
      document.querySelectorAll('[data-translation-tab]').forEach(tab => tab.addEventListener('click', async () => {
        activateTab(tab.dataset.translationTab);
        if (tab.dataset.translationTab === 'channel') await refreshChat();
        if (tab.dataset.translationTab === 'advanced') checkHealth(false);
      }));

      const globalIds = [
        'translation-receive-auto','translation-message-to','translation-group','translation-send','translation-send-from','translation-send-to',
        'translation-server','translation-include-zh','translation-display','translation-manual','translation-message-from','translation-font-size','translation-font-color'
      ];
      for (const id of globalIds) {
        el(id)?.addEventListener('change', () => {
          if (id === 'translation-receive-auto' && checked(id)) setChecked('translation-display', true);
          saveGlobal();
        });
      }

      el('translation-chat-override')?.addEventListener('change', event => setChatOverride(!!event.target.checked));
      el('translation-chat-reset')?.addEventListener('click', () => setChatOverride(false));
      for (const id of ['translation-channel-receive-auto','translation-channel-message-to','translation-enabled','translation-target','translation-message-action']) {
        el(id)?.addEventListener('change', () => saveChatField(id));
      }
      el('translation-gateway-test')?.addEventListener('click', () => checkHealth(true));

      refreshGlobal();
      activateTab('global');
    }

    return Object.freeze({ bind, refreshGlobal, refreshChat, checkHealth });
  }

  window.GeekTranslationSettings = Object.freeze({ LANGUAGES, DEFAULTS, create });
})();
