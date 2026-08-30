/* 极客普通设置体验层：只编排既有 config/accounts API，不改变底层配置协议。 */
(() => {
  'use strict';

  const PROXY_GLOBAL_IDS = ['cfg-protocal','cfg-host','cfg-port','cfg-login','cfg-password'];
  const PROXY_ACCOUNT_IDS = ['acc-protocal','acc-host','acc-port','acc-huser','acc-hpwd'];
  const APPEARANCE_DEFAULTS = Object.freeze({ theme: 'dark', accent: 'green' });
  const ACCOUNT_DISPLAY_DEFAULTS = Object.freeze({ fontSize: 16, fontColor: '#18A058' });

  function create(deps = {}) {
    for (const name of ['getConfig','setConfig','getAccounts','updateAccount','applyTheme']) {
      if (typeof deps[name] !== 'function') throw new Error(`设置面板缺少依赖: ${name}`);
    }

    let bound = false;
    let config = {};
    let accounts = [];
    let previewSnapshot = null;
    let statusTimer = null;
    let returnFocus = null;
    let lockedAccountId = '';

    const el = id => document.getElementById(id);
    const checked = id => !!el(id)?.checked;
    const value = (id, fallback = '') => String(el(id)?.value ?? fallback);
    const setChecked = (id, next) => { const node = el(id); if (node) node.checked = !!next; };
    const setValue = (id, next) => { const node = el(id); if (node) node.value = String(next ?? ''); };
    const currentAccountId = () => lockedAccountId || value('acc-select');

    function overlayVisible(id) {
      const node = el(id);
      return !!node && !node.classList.contains('hidden');
    }

    function restoreFocus() {
      const target = returnFocus;
      returnFocus = null;
      if (target && target.isConnected !== false && typeof target.focus === 'function') target.focus();
    }

    function setStatus(text, kind = '') {
      const node = el('settings-status');
      if (!node) return;
      node.textContent = text;
      node.dataset.state = kind;
      if (statusTimer) clearTimeout(statusTimer);
      if (kind === 'ok') statusTimer = setTimeout(() => {
        if (node.dataset.state === 'ok') { node.textContent = ''; node.dataset.state = ''; }
      }, 2200);
    }

    function familyLabel(type) {
      if (typeof deps.familyLabel === 'function') return deps.familyLabel(type);
      if (String(type).startsWith('telegram')) return 'Telegram';
      if (String(type).startsWith('line')) return 'LINE';
      return 'WhatsApp';
    }

    function setProxyEnabled(ids, enabled) {
      for (const id of ids) {
        const node = el(id);
        if (node) node.disabled = !enabled;
      }
    }

    function refreshProxyUi() {
      const globalEnabled = checked('cfg-openProxy');
      setProxyEnabled(PROXY_GLOBAL_IDS, globalEnabled);
      const globalCard = el('settings-global-proxy-fields');
      globalCard?.classList.toggle('settings-fields-disabled', !globalEnabled);

      const accountEnabled = checked('acc-openProxy');
      setProxyEnabled(PROXY_ACCOUNT_IDS, accountEnabled);
      const accountCard = el('settings-account-proxy-fields');
      accountCard?.classList.toggle('settings-fields-disabled', !accountEnabled);

      const strategy = accountEnabled
        ? { state: 'account', title: '使用账号独立代理', detail: '保存后，这个账号将优先使用下面的独立代理。' }
        : globalEnabled
          ? { state: 'global', title: '跟随全局代理', detail: '当前账号未启用独立代理，将使用全局网络代理。' }
          : { state: 'direct', title: '当前为直连', detail: '账号和全局代理都未启用。' };
      const badge = el('settings-proxy-strategy');
      const detail = el('settings-proxy-strategy-detail');
      if (badge) { badge.textContent = strategy.title; badge.dataset.state = strategy.state; }
      if (detail) detail.textContent = strategy.detail;
    }

    function confirmReset(message) {
      const ask = typeof deps.confirm === 'function' ? deps.confirm : window.confirm.bind(window);
      return ask(message);
    }

    function appendResetButton(anchorId, id, label) {
      if (el(id)) return;
      const host = el(anchorId)?.closest('.settings-card');
      if (!host) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.id = id;
      button.className = 'btn-plain';
      button.textContent = label;
      host.appendChild(button);
    }

    function ensureResetButtons() {
      appendResetButton('cfg-theme', 'settings-reset-appearance', '恢复外观默认');
      appendResetButton('acc-fontSize', 'settings-reset-account-display', '恢复显示默认');
    }

    async function resetAppearance() {
      if (!confirmReset('仅恢复主题和强调色为默认值？代理、锁屏和其他设置不会改变。')) return false;
      setStatus('正在恢复外观…', 'working');
      try {
        await deps.setConfig({ ...APPEARANCE_DEFAULTS });
        config = { ...config, ...APPEARANCE_DEFAULTS };
        setValue('cfg-theme', APPEARANCE_DEFAULTS.theme);
        setValue('cfg-accent', APPEARANCE_DEFAULTS.accent);
        deps.applyTheme(APPEARANCE_DEFAULTS.theme, APPEARANCE_DEFAULTS.accent);
        previewSnapshot = { ...APPEARANCE_DEFAULTS };
        setStatus('外观已恢复默认 ✓', 'ok');
        return true;
      } catch (error) {
        setStatus(`恢复失败：${String(error?.message || error).slice(0, 120)}`, 'error');
        return false;
      }
    }

    async function resetAccountDisplay() {
      const accountId = currentAccountId();
      if (!accountId) return false;
      if (!confirmReset('仅恢复当前账号的字体大小和字体颜色？账号名称、代理和登录状态不会改变。')) return false;
      setStatus('正在恢复当前账号显示…', 'working');
      try {
        await deps.updateAccount(accountId, { ...ACCOUNT_DISPLAY_DEFAULTS });
        accounts = accounts.map(item => item.id === accountId ? { ...item, ...ACCOUNT_DISPLAY_DEFAULTS } : item);
        setValue('acc-fontSize', ACCOUNT_DISPLAY_DEFAULTS.fontSize);
        setValue('acc-fontColor', ACCOUNT_DISPLAY_DEFAULTS.fontColor);
        if (typeof deps.afterSave === 'function') await deps.afterSave();
        const refreshed = await deps.getAccounts();
        accounts = refreshed?.accounts || refreshed || accounts;
        fillAccountSelect(accountId);
        loadAccount();
        setStatus('当前账号显示已恢复默认 ✓', 'ok');
        return true;
      } catch (error) {
        setStatus(`恢复失败：${String(error?.message || error).slice(0, 120)}`, 'error');
        return false;
      }
    }

    function validateProxy(enabled, host, port, label) {
      if (!enabled) return null;
      const cleanHost = String(host || '').trim();
      const cleanPort = String(port || '').trim();
      if (!cleanHost) return `${label}已启用，请填写代理主机`;
      if (/\s|:\/\//.test(cleanHost) || cleanHost.length > 253) return `${label}主机格式不正确，请只填写主机名或 IP`;
      if (!/^\d+$/.test(cleanPort)) return `${label}端口必须是 1-65535 的整数`;
      const portNumber = Number(cleanPort);
      if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) return `${label}端口必须是 1-65535 的整数`;
      return null;
    }

    function validate() {
      const globalProxyError = validateProxy(checked('cfg-openProxy'), value('cfg-host'), value('cfg-port'), '全局代理');
      if (globalProxyError) return { ok: false, message: globalProxyError, focusId: !value('cfg-host').trim() ? 'cfg-host' : 'cfg-port' };

      const accountId = value('acc-select');
      if (!accountId) return { ok: true };
      const name = value('acc-name').trim();
      if (!name) return { ok: false, message: '账号显示名不能为空', focusId: 'acc-name', tab: 'account' };
      if (name.length > 80) return { ok: false, message: '账号显示名不能超过 80 个字符', focusId: 'acc-name', tab: 'account' };
      const fontSize = Number(value('acc-fontSize'));
      if (!Number.isInteger(fontSize) || fontSize < 10 || fontSize > 28) return { ok: false, message: '字体大小必须是 10-28 的整数', focusId: 'acc-fontSize', tab: 'account' };
      const accountProxyError = validateProxy(checked('acc-openProxy'), value('acc-host'), value('acc-port'), '账号代理');
      if (accountProxyError) return { ok: false, message: accountProxyError, focusId: !value('acc-host').trim() ? 'acc-host' : 'acc-port', tab: 'account' };
      return { ok: true };
    }

    function activateTab(name) {
      document.querySelectorAll('.settings-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name));
      el('settings-account-center')?.classList.toggle('hidden', name !== 'account-center');
      el('settings-global')?.classList.toggle('hidden', name !== 'global');
      el('settings-account')?.classList.toggle('hidden', name !== 'account');
      const saveButton = el('settings-save');
      if (saveButton) saveButton.classList.toggle('hidden', name === 'account-center');
      if (name === 'account-center' && typeof deps.loadAccountCenter === 'function') void deps.loadAccountCenter();
    }

    function fillGlobal() {
      setValue('cfg-theme', config.theme || 'dark');
      setValue('cfg-accent', config.accent || 'green');
      setChecked('cfg-autoLaunch', !!config.autoLaunch);
      setChecked('cfg-isStartupMinimize', !!config.isStartupMinimize);
      setChecked('cfg-messageSound', !!config.messageSound);
      setValue('cfg-lockPassword', config.lockPassword || '');
      setChecked('cfg-openProxy', !!config.openProxy);
      setValue('cfg-protocal', config.protocal || 'http');
      setValue('cfg-host', config.host || '');
      setValue('cfg-port', config.port || '');
      setValue('cfg-login', config.login || '');
      setValue('cfg-password', config.password || '');
      refreshProxyUi();
    }

    function fillAccountSelect(preferredId = '') {
      const target = preferredId || lockedAccountId || (typeof deps.getActiveId === 'function' ? deps.getActiveId() : '');
      setValue('acc-select', accounts.some(item => item.id === target) ? target : '');
    }

    function loadAccount() {
      const account = accounts.find(item => item.id === currentAccountId());
      if (!account) {
        el('settings-account-empty')?.classList.remove('hidden');
        el('settings-account-content')?.classList.add('hidden');
        return;
      }
      el('settings-account-empty')?.classList.add('hidden');
      el('settings-account-content')?.classList.remove('hidden');
      const targetLabel = el('acc-target-label');
      if (targetLabel) targetLabel.textContent = `${account.name || '未命名账号'} · ${familyLabel(account.type)}`;
      setValue('acc-name', account.name || '');
      setValue('acc-fontSize', account.fontSize || 16);
      setValue('acc-fontColor', account.fontColor || '#18A058');
      setChecked('acc-openProxy', !!account.openProxy);
      setValue('acc-protocal', account.protocal || 'http');
      setValue('acc-host', account.host || '');
      setValue('acc-port', account.port || '');
      setValue('acc-huser', account.huser || '');
      setValue('acc-hpwd', account.hpwd || '');
      refreshProxyUi();
    }

    async function load(preferredAccountId = '') {
      config = await deps.getConfig() || {};
      const result = await deps.getAccounts();
      accounts = result?.accounts || result || [];
      fillGlobal();
      fillAccountSelect(preferredAccountId);
      loadAccount();
      setStatus('');
    }

    async function open(preferredAccountId = '') {
      lockedAccountId = '';
      const active = document.activeElement;
      returnFocus = active && typeof active.focus === 'function' ? active : null;
      const before = await deps.getConfig() || {};
      previewSnapshot = { theme: before.theme || 'dark', accent: before.accent || 'green' };
      await load(preferredAccountId);
      activateTab('account-center');
      el('settings-overlay')?.classList.remove('hidden');
      el('settings-close')?.focus();
    }

    async function openAccount(accountId, options = {}) {
      const targetId = String(accountId || '');
      if (!targetId) return false;
      lockedAccountId = targetId;
      const active = document.activeElement;
      returnFocus = active && typeof active.focus === 'function' ? active : null;
      const before = await deps.getConfig() || {};
      previewSnapshot = { theme: before.theme || 'dark', accent: before.accent || 'green' };
      await load(targetId);
      if (!accounts.some(item => item.id === targetId)) { lockedAccountId = ''; return false; }
      setValue('acc-select', targetId);
      loadAccount();
      activateTab('account');
      el('settings-overlay')?.classList.remove('hidden');
      if (options.focus === 'proxy') el('acc-openProxy')?.focus();
      else el('acc-name')?.focus();
      return true;
    }

    function close({ restorePreview = false } = {}) {
      if (!overlayVisible('settings-overlay')) return;
      if (restorePreview && previewSnapshot) deps.applyTheme(previewSnapshot.theme, previewSnapshot.accent);
      previewSnapshot = null;
      el('settings-overlay')?.classList.add('hidden');
      setStatus('');
      restoreFocus();
    }

    function configPatch() {
      return {
        theme: value('cfg-theme', 'dark'),
        accent: value('cfg-accent', 'green'),
        autoLaunch: checked('cfg-autoLaunch'),
        isStartupMinimize: checked('cfg-isStartupMinimize'),
        messageSound: checked('cfg-messageSound'),
        lockPassword: value('cfg-lockPassword'),
        openProxy: checked('cfg-openProxy'),
        protocal: value('cfg-protocal', 'http'),
        host: value('cfg-host').trim(),
        port: value('cfg-port').trim(),
        login: value('cfg-login').trim(),
        password: value('cfg-password')
      };
    }

    function accountPatch() {
      return {
        name: value('acc-name').trim(),
        fontSize: Number(value('acc-fontSize')),
        fontColor: value('acc-fontColor', '#18A058'),
        openProxy: checked('acc-openProxy'),
        protocal: value('acc-protocal', 'http'),
        host: value('acc-host').trim(),
        port: value('acc-port').trim(),
        huser: value('acc-huser').trim(),
        hpwd: value('acc-hpwd')
      };
    }

    async function save() {
      const validation = validate();
      if (!validation.ok) {
        if (validation.tab) activateTab(validation.tab);
        setStatus(validation.message, 'error');
        el(validation.focusId)?.focus();
        return false;
      }
      const button = el('settings-save');
      if (button) button.disabled = true;
      setStatus('正在保存…', 'working');
      try {
        const nextConfig = configPatch();
const accountId = currentAccountId();
if (lockedAccountId) {
  await deps.updateAccount(accountId, accountPatch());
} else {
  await deps.setConfig(nextConfig);
  config = { ...config, ...nextConfig };
  deps.applyTheme(nextConfig.theme, nextConfig.accent);
}
        if (typeof deps.afterSave === 'function') await deps.afterSave();
        const refreshed = await deps.getAccounts();
        accounts = refreshed?.accounts || refreshed || accounts;
        fillAccountSelect(accountId);
        loadAccount();
        if (!lockedAccountId) previewSnapshot = { theme: nextConfig.theme, accent: nextConfig.accent };
        setStatus('已保存 ✓', 'ok');
        return true;
      } catch (error) {
        setStatus(`保存失败：${String(error?.message || error).slice(0, 120)}`, 'error');
        return false;
      } finally {
        if (button) button.disabled = false;
      }
    }

    function handleKeydown(event) {
      if (event.defaultPrevented || event.repeat) return;
      const settingsShortcut = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === ',';
      if (settingsShortcut) {
        if (overlayVisible('lock-overlay')) return;
        event.preventDefault();
        event.stopPropagation();
        if (overlayVisible('settings-overlay')) {
          el('settings-close')?.focus();
          return;
        }
        const preferredId = typeof deps.getActiveId === 'function' ? deps.getActiveId() : '';
        void open(preferredId);
        return;
      }
      if (event.key === 'Escape' && overlayVisible('settings-overlay')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close({ restorePreview: true });
      }
    }

    function bind() {
      if (bound) return;
      bound = true;
      el('settings-close')?.addEventListener('click', () => close({ restorePreview: true }));
      el('settings-cancel')?.addEventListener('click', () => close({ restorePreview: true }));
      el('settings-overlay')?.addEventListener('click', event => {
        if (event.target === el('settings-overlay')) close({ restorePreview: true });
      });
      document.querySelectorAll('.settings-tab').forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));
      ensureResetButtons();
      el('settings-reset-appearance')?.addEventListener('click', resetAppearance);
      el('settings-reset-account-display')?.addEventListener('click', resetAccountDisplay);
      el('acc-select')?.addEventListener('change', loadAccount);
      el('cfg-openProxy')?.addEventListener('change', refreshProxyUi);
      el('acc-openProxy')?.addEventListener('change', refreshProxyUi);
      for (const id of ['cfg-theme','cfg-accent']) el(id)?.addEventListener('change', () => deps.applyTheme(value('cfg-theme', 'dark'), value('cfg-accent', 'green')));
      el('settings-save')?.addEventListener('click', save);
      document.addEventListener('keydown', handleKeydown);
    }

    return Object.freeze({ bind, open, openAccount, close, load, loadAccount, save, validate, refreshProxyUi, resetAppearance, resetAccountDisplay });
  }

  window.GeekSettingsController = Object.freeze({ create });
})();
