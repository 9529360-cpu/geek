/* 极客应用设置体验层：编排全局 config，并只读镜像 subscription 账户信息；实例设置由右键上下文独立拥有。 */
(() => {
  'use strict';
  const PROXY_GLOBAL_IDS = ['cfg-protocal','cfg-host','cfg-port','cfg-login','cfg-password'];
  const APPEARANCE_DEFAULTS = Object.freeze({ theme: 'dark', accent: 'green' });
  function create(deps = {}) {
    for (const name of ['getConfig','setConfig','getSubscriptionState','refreshSubscription','applyTheme']) if (typeof deps[name] !== 'function') throw new Error(`设置面板缺少依赖: ${name}`);
    let bound = false, config = {}, previewSnapshot = null, statusTimer = null, returnFocus = null;
    const el = id => document.getElementById(id);
    const checked = id => !!el(id)?.checked;
    const value = (id, fallback = '') => String(el(id)?.value ?? fallback);
    const setChecked = (id, next) => { const n = el(id); if (n) n.checked = !!next; };
    const setValue = (id, next) => { const n = el(id); if (n) n.value = String(next ?? ''); };
    const overlayVisible = id => !!el(id) && !el(id).classList.contains('hidden');
    function setStatus(text, kind = '') { const n = el('settings-status'); if (!n) return; n.textContent = text; n.dataset.state = kind; if (statusTimer) clearTimeout(statusTimer); if (kind === 'ok') statusTimer = setTimeout(() => { if (n.dataset.state === 'ok') { n.textContent = ''; n.dataset.state = ''; } }, 2200); }
    function restoreFocus() { const t = returnFocus; returnFocus = null; if (t && t.isConnected !== false && typeof t.focus === 'function') t.focus(); }
    function setProxyEnabled(enabled) { for (const id of PROXY_GLOBAL_IDS) { const n = el(id); if (n) n.disabled = !enabled; } el('settings-global-proxy-fields')?.classList.toggle('settings-fields-disabled', !enabled); }
    function refreshProxyUi() { setProxyEnabled(checked('cfg-openProxy')); }
    function fillGlobal() { setValue('cfg-theme', config.theme || 'dark'); setValue('cfg-accent', config.accent || 'green'); setChecked('cfg-autoLaunch', !!config.autoLaunch); setChecked('cfg-isStartupMinimize', !!config.isStartupMinimize); setChecked('cfg-messageSound', !!config.messageSound); setValue('cfg-lockPassword', config.lockPassword || ''); setChecked('cfg-openProxy', !!config.openProxy); setValue('cfg-protocal', config.protocal || 'http'); setValue('cfg-host', config.host || ''); setValue('cfg-port', config.port || ''); setValue('cfg-login', config.login || ''); setValue('cfg-password', config.password || ''); refreshProxyUi(); }
    function validateProxy() { if (!checked('cfg-openProxy')) return null; const host = value('cfg-host').trim(), port = value('cfg-port').trim(); if (!host) return { message: '全局代理已启用，请填写代理主机', focusId: 'cfg-host' }; if (/\s|:\/\//.test(host) || host.length > 253) return { message: '全局代理主机格式不正确，请只填写主机名或 IP', focusId: 'cfg-host' }; if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) return { message: '全局代理端口必须是 1-65535 的整数', focusId: 'cfg-port' }; return null; }
    function validate() { const e = validateProxy(); return e ? { ok: false, ...e } : { ok: true }; }
    function configPatch() { return { theme: value('cfg-theme','dark'), accent: value('cfg-accent','green'), autoLaunch: checked('cfg-autoLaunch'), isStartupMinimize: checked('cfg-isStartupMinimize'), messageSound: checked('cfg-messageSound'), lockPassword: value('cfg-lockPassword'), openProxy: checked('cfg-openProxy'), protocal: value('cfg-protocal','http'), host: value('cfg-host').trim(), port: value('cfg-port').trim(), login: value('cfg-login').trim(), password: value('cfg-password') }; }
    function renderPersonalCenter(emailText, quotaText) { const emailNode = el('settings-account-email'), quotaNode = el('settings-account-quota'); if (emailNode) emailNode.textContent = emailText; if (quotaNode) quotaNode.textContent = quotaText; }
    async function refreshPersonalCenter() {
      renderPersonalCenter('正在读取…', '正在读取…');
      try {
        const local = await deps.getSubscriptionState() || {};
        if (!local.loggedIn) { renderPersonalCenter('未登录', '字符余额未知'); return false; }
        const localEmail = String(local.email || '').trim();
        if (localEmail) renderPersonalCenter(localEmail, '正在读取…');
        const refreshed = await deps.refreshSubscription() || {};
        if (!refreshed.loggedIn) { renderPersonalCenter('未登录', '字符余额未知'); return false; }
        const email = String(refreshed.email || localEmail || '').trim();
        const remaining = refreshed.remaining_chars;
        if (refreshed.networkError || !Number.isSafeInteger(remaining) || remaining < 0) { renderPersonalCenter(email || '邮箱未知', '字符余额未知'); return false; }
        renderPersonalCenter(email || '邮箱未知', remaining.toLocaleString() + ' 字符');
        return true;
      } catch { renderPersonalCenter('账户信息暂不可用', '字符余额未知'); return false; }
    }
    async function load() { config = await deps.getConfig() || {}; fillGlobal(); setStatus(''); }
    async function open() { if (overlayVisible('settings-overlay')) { el('settings-close')?.focus(); return; } const active = document.activeElement; returnFocus = active && typeof active.focus === 'function' ? active : null; const before = await deps.getConfig() || {}; previewSnapshot = { theme: before.theme || 'dark', accent: before.accent || 'green' }; await load(); el('settings-overlay')?.classList.remove('hidden'); el('settings-close')?.focus(); void refreshPersonalCenter(); }
    function close({ restorePreview = false } = {}) { if (!overlayVisible('settings-overlay')) return; if (restorePreview && previewSnapshot) deps.applyTheme(previewSnapshot.theme, previewSnapshot.accent); previewSnapshot = null; el('settings-overlay')?.classList.add('hidden'); setStatus(''); restoreFocus(); }
    async function resetAppearance() { const ask = typeof deps.confirm === 'function' ? deps.confirm : window.confirm.bind(window); if (!ask('仅恢复主题和强调色为默认值？代理、锁屏和其他设置不会改变。')) return false; try { await deps.setConfig({ ...APPEARANCE_DEFAULTS }); config = { ...config, ...APPEARANCE_DEFAULTS }; fillGlobal(); deps.applyTheme(APPEARANCE_DEFAULTS.theme, APPEARANCE_DEFAULTS.accent); previewSnapshot = { ...APPEARANCE_DEFAULTS }; setStatus('外观已恢复默认 ✓','ok'); return true; } catch (e) { setStatus(`恢复失败：${String(e?.message || e).slice(0,120)}`,'error'); return false; } }
    async function save() { const v = validate(); if (!v.ok) { setStatus(v.message,'error'); el(v.focusId)?.focus(); return false; } const b = el('settings-save'); if (b) b.disabled = true; setStatus('正在保存…','working'); try { const next = configPatch(); await deps.setConfig(next); config = { ...config, ...next }; deps.applyTheme(next.theme,next.accent); previewSnapshot = { theme: next.theme, accent: next.accent }; if (typeof deps.afterSave === 'function') await deps.afterSave(); setStatus('已保存 ✓','ok'); return true; } catch (e) { setStatus(`保存失败：${String(e?.message || e).slice(0,120)}`,'error'); return false; } finally { if (b) b.disabled = false; } }
    function ensureResetButton() { if (el('settings-reset-appearance')) return; const host = el('cfg-theme')?.closest('.settings-card'); if (!host) return; const b = document.createElement('button'); b.type='button'; b.id='settings-reset-appearance'; b.className='btn-plain'; b.textContent='恢复外观默认'; host.appendChild(b); }
    function handleKeydown(event) { if (event.defaultPrevented || event.repeat) return; const shortcut = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === ','; if (shortcut) { if (overlayVisible('lock-overlay')) return; event.preventDefault(); event.stopPropagation(); if (overlayVisible('settings-overlay')) return void el('settings-close')?.focus(); void open(); return; } if (event.key === 'Escape' && overlayVisible('settings-overlay')) { event.preventDefault(); event.stopImmediatePropagation(); close({ restorePreview: true }); } }
    function bind() { if (bound) return; bound = true; el('settings-close')?.addEventListener('click', () => close({ restorePreview:true })); el('settings-cancel')?.addEventListener('click', () => close({ restorePreview:true })); el('settings-overlay')?.addEventListener('click', e => { if (e.target === el('settings-overlay')) close({ restorePreview:true }); }); ensureResetButton(); el('settings-reset-appearance')?.addEventListener('click', resetAppearance); el('cfg-openProxy')?.addEventListener('change', refreshProxyUi); for (const id of ['cfg-theme','cfg-accent']) el(id)?.addEventListener('change', () => deps.applyTheme(value('cfg-theme','dark'), value('cfg-accent','green'))); el('settings-save')?.addEventListener('click', save); document.addEventListener('keydown', handleKeydown); }
    return Object.freeze({ bind, open, close, load, save, validate, refreshProxyUi, refreshPersonalCenter, resetAppearance });
  }
  window.GeekSettingsController = Object.freeze({ create });
})();
