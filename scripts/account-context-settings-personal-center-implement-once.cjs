'use strict';
const fs = require('node:fs');
function replaceOnce(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`missing anchor: ${label}`);
  return text.replace(from, to);
}

let html = fs.readFileSync('ui/index.html', 'utf8');
html = replaceOnce(
  html,
  '<div id="settings-overlay" class="overlay hidden">\n  <div class="settings-panel settings-panel--humanized" role="dialog" aria-modal="true" aria-label="设置">\n    <div class="settings-header">\n      <div class="settings-head-copy"><span>设置</span><small>按使用场景调整，保存前可直接预览外观</small></div>',
  '<div id="settings-overlay" class="overlay hidden">\n  <div class="settings-panel settings-panel--humanized" role="dialog" aria-modal="true" aria-label="应用设置">\n    <div class="settings-header">\n      <div class="settings-head-copy"><span>应用设置</span><small>管理极客账户信息与应用级偏好</small></div>',
  'settings header'
);
const settingsBody = '    <div id="settings-global" class="settings-body settings-body--cards">\n';
const personalCard = `    <div id="settings-global" class="settings-body settings-body--cards">\n      <section id="settings-personal-center" class="settings-card">\n        <div class="settings-card-title">个人中心</div>\n        <div class="settings-card-sub">只读显示当前极客账户信息；账户状态仍由现有订阅服务统一管理。</div>\n        <div class="row-item"><span>邮箱</span><strong id="settings-account-email">正在读取…</strong></div>\n        <div class="row-item"><span>剩余字符</span><strong id="settings-account-quota">正在读取…</strong></div>\n      </section>\n\n`;
html = replaceOnce(html, settingsBody, personalCard, 'settings body');
fs.writeFileSync('ui/index.html', html, 'utf8');

let app = fs.readFileSync('ui/app.js', 'utf8');
const depsAnchor = `  const settingsController = window.GeekSettingsController.create({\n    getConfig: () => window.api.config.get(),\n    setConfig: patch => window.api.config.set(patch),\n    applyTheme,\n    afterSave: async () => { await loadAccounts(); },\n  });`;
const depsNext = `  const settingsController = window.GeekSettingsController.create({\n    getConfig: () => window.api.config.get(),\n    setConfig: patch => window.api.config.set(patch),\n    getSubscriptionState: () => window.api.subscription.getState(),\n    refreshSubscription: () => window.api.subscription.refresh(),\n    applyTheme,\n    afterSave: async () => { await loadAccounts(); },\n  });`;
app = replaceOnce(app, depsAnchor, depsNext, 'settings controller deps');
fs.writeFileSync('ui/app.js', app, 'utf8');

let controller = fs.readFileSync('ui/settings-controller.js', 'utf8');
controller = replaceOnce(
  controller,
  '/* 极客普通设置体验层：只编排全局 config API；实例设置由右键上下文独立拥有。 */',
  '/* 极客应用设置体验层：编排全局 config，并只读镜像 subscription 账户信息；实例设置由右键上下文独立拥有。 */',
  'controller comment'
);
controller = replaceOnce(
  controller,
  "    for (const name of ['getConfig','setConfig','applyTheme']) if (typeof deps[name] !== 'function') throw new Error(`设置面板缺少依赖: ${name}`);",
  "    for (const name of ['getConfig','setConfig','getSubscriptionState','refreshSubscription','applyTheme']) if (typeof deps[name] !== 'function') throw new Error(`设置面板缺少依赖: ${name}`);",
  'controller deps'
);
const loadAnchor = `    async function load() { config = await deps.getConfig() || {}; fillGlobal(); setStatus(''); }\n    async function open() { if (overlayVisible('settings-overlay')) { el('settings-close')?.focus(); return; } const active = document.activeElement; returnFocus = active && typeof active.focus === 'function' ? active : null; const before = await deps.getConfig() || {}; previewSnapshot = { theme: before.theme || 'dark', accent: before.accent || 'green' }; await load(); el('settings-overlay')?.classList.remove('hidden'); el('settings-close')?.focus(); }`;
const loadNext = `    function renderPersonalCenter(emailText, quotaText) { const emailNode = el('settings-account-email'), quotaNode = el('settings-account-quota'); if (emailNode) emailNode.textContent = emailText; if (quotaNode) quotaNode.textContent = quotaText; }\n    async function refreshPersonalCenter() {\n      renderPersonalCenter('正在读取…', '正在读取…');\n      try {\n        const local = await deps.getSubscriptionState() || {};\n        if (!local.loggedIn) { renderPersonalCenter('未登录', '字符余额未知'); return false; }\n        const localEmail = String(local.email || '').trim();\n        if (localEmail) renderPersonalCenter(localEmail, '正在读取…');\n        const refreshed = await deps.refreshSubscription() || {};\n        if (!refreshed.loggedIn) { renderPersonalCenter('未登录', '字符余额未知'); return false; }\n        const email = String(refreshed.email || localEmail || '').trim();\n        const remaining = refreshed.remaining_chars;\n        if (refreshed.networkError || !Number.isSafeInteger(remaining) || remaining < 0) { renderPersonalCenter(email || '邮箱未知', '字符余额未知'); return false; }\n        renderPersonalCenter(email || '邮箱未知', remaining.toLocaleString() + ' 字符');\n        return true;\n      } catch { renderPersonalCenter('账户信息暂不可用', '字符余额未知'); return false; }\n    }\n    async function load() { config = await deps.getConfig() || {}; fillGlobal(); setStatus(''); }\n    async function open() { if (overlayVisible('settings-overlay')) { el('settings-close')?.focus(); return; } const active = document.activeElement; returnFocus = active && typeof active.focus === 'function' ? active : null; const before = await deps.getConfig() || {}; previewSnapshot = { theme: before.theme || 'dark', accent: before.accent || 'green' }; await load(); el('settings-overlay')?.classList.remove('hidden'); el('settings-close')?.focus(); void refreshPersonalCenter(); }`;
controller = replaceOnce(controller, loadAnchor, loadNext, 'load/open');
controller = replaceOnce(
  controller,
  '    return Object.freeze({ bind, open, close, load, save, validate, refreshProxyUi, resetAppearance });',
  '    return Object.freeze({ bind, open, close, load, save, validate, refreshProxyUi, refreshPersonalCenter, resetAppearance });',
  'controller exports'
);
fs.writeFileSync('ui/settings-controller.js', controller, 'utf8');

let v2 = fs.readFileSync('test/account-context-v2-contract.cjs', 'utf8');
v2 = v2.replace('// Personal center has one owner: the existing subscription home, not ordinary Settings.', '// Subscription state has one owner. The existing subscription home remains canonical; application Settings may expose a read-only mirror.');
fs.writeFileSync('test/account-context-v2-contract.cjs', v2, 'utf8');

fs.unlinkSync('scripts/account-context-settings-personal-center-implement-once.cjs');
fs.unlinkSync('.github/workflows/account-context-settings-personal-center-implement-once.yml');
