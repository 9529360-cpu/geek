'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`${label}: anchor missing`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`${label}: anchor not unique`);
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

const settingsPath = path.join(root, 'ui', 'settings-controller.js');
let settings = fs.readFileSync(settingsPath, 'utf8');
settings = replaceOnce(settings,
  "  const PROXY_ACCOUNT_IDS = ['acc-host','acc-port','acc-huser','acc-hpwd'];\n",
  "  const PROXY_ACCOUNT_IDS = ['acc-host','acc-port','acc-huser','acc-hpwd'];\n  const APPEARANCE_DEFAULTS = Object.freeze({ theme: 'dark', accent: 'green' });\n  const ACCOUNT_DISPLAY_DEFAULTS = Object.freeze({ fontSize: 16, fontColor: '#18A058' });\n",
  'settings defaults');

const settingsInsertAnchor = `    function validateProxy(enabled, host, port, label) {\n`;
const settingsResetFns = `    function confirmReset(message) {\n      const ask = typeof deps.confirm === 'function' ? deps.confirm : window.confirm.bind(window);\n      return ask(message);\n    }\n\n    function appendResetButton(anchorId, id, label) {\n      if (el(id)) return;\n      const host = el(anchorId)?.closest('.settings-card');\n      if (!host) return;\n      const button = document.createElement('button');\n      button.type = 'button';\n      button.id = id;\n      button.className = 'btn-plain';\n      button.textContent = label;\n      host.appendChild(button);\n    }\n\n    function ensureResetButtons() {\n      appendResetButton('cfg-theme', 'settings-reset-appearance', '恢复外观默认');\n      appendResetButton('acc-fontSize', 'settings-reset-account-display', '恢复显示默认');\n    }\n\n    async function resetAppearance() {\n      if (!confirmReset('仅恢复主题和强调色为默认值？代理、锁屏和其他设置不会改变。')) return false;\n      setStatus('正在恢复外观…', 'working');\n      try {\n        await deps.setConfig({ ...APPEARANCE_DEFAULTS });\n        config = { ...config, ...APPEARANCE_DEFAULTS };\n        setValue('cfg-theme', APPEARANCE_DEFAULTS.theme);\n        setValue('cfg-accent', APPEARANCE_DEFAULTS.accent);\n        deps.applyTheme(APPEARANCE_DEFAULTS.theme, APPEARANCE_DEFAULTS.accent);\n        previewSnapshot = { ...APPEARANCE_DEFAULTS };\n        setStatus('外观已恢复默认 ✓', 'ok');\n        return true;\n      } catch (error) {\n        setStatus(\`恢复失败：\${String(error?.message || error).slice(0, 120)}\`, 'error');\n        return false;\n      }\n    }\n\n    async function resetAccountDisplay() {\n      const accountId = value('acc-select');\n      if (!accountId) return false;\n      if (!confirmReset('仅恢复当前账号的字体大小和字体颜色？账号名称、代理和登录状态不会改变。')) return false;\n      setStatus('正在恢复当前账号显示…', 'working');\n      try {\n        await deps.updateAccount(accountId, { ...ACCOUNT_DISPLAY_DEFAULTS });\n        accounts = accounts.map(item => item.id === accountId ? { ...item, ...ACCOUNT_DISPLAY_DEFAULTS } : item);\n        setValue('acc-fontSize', ACCOUNT_DISPLAY_DEFAULTS.fontSize);\n        setValue('acc-fontColor', ACCOUNT_DISPLAY_DEFAULTS.fontColor);\n        if (typeof deps.afterSave === 'function') await deps.afterSave();\n        const refreshed = await deps.getAccounts();\n        accounts = refreshed?.accounts || refreshed || accounts;\n        fillAccountSelect(accountId);\n        loadAccount();\n        setStatus('当前账号显示已恢复默认 ✓', 'ok');\n        return true;\n      } catch (error) {\n        setStatus(\`恢复失败：\${String(error?.message || error).slice(0, 120)}\`, 'error');\n        return false;\n      }\n    }\n\n`;
settings = replaceOnce(settings, settingsInsertAnchor, settingsResetFns + settingsInsertAnchor, 'settings reset functions');
settings = replaceOnce(settings,
  `      document.querySelectorAll('.settings-tab').forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));\n`,
  `      document.querySelectorAll('.settings-tab').forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));\n      ensureResetButtons();\n      el('settings-reset-appearance')?.addEventListener('click', resetAppearance);\n      el('settings-reset-account-display')?.addEventListener('click', resetAccountDisplay);\n`,
  'settings reset binding');
settings = replaceOnce(settings,
  `    return Object.freeze({ bind, open, close, load, loadAccount, save, validate, refreshProxyUi });\n`,
  `    return Object.freeze({ bind, open, close, load, loadAccount, save, validate, refreshProxyUi, resetAppearance, resetAccountDisplay });\n`,
  'settings reset exports');
fs.writeFileSync(settingsPath, settings);

const translationPath = path.join(root, 'ui', 'translation-settings.js');
let translation = fs.readFileSync(translationPath, 'utf8');
const translationAnchor = `    async function checkHealth(force = false) {\n`;
const translationResetFns = `    function ensureGlobalResetButton() {\n      if (el('translation-reset-global')) return;\n      const host = el('translation-server')?.closest('.translation-advanced-body');\n      if (!host) return;\n      const button = document.createElement('button');\n      button.type = 'button';\n      button.id = 'translation-reset-global';\n      button.className = 'translation-save translation-save--secondary translation-reset';\n      button.textContent = '恢复翻译推荐设置';\n      host.appendChild(button);\n    }\n\n    async function resetGlobalDefaults() {\n      if (!deps.getActiveId()) return false;\n      const ask = typeof deps.confirm === 'function' ? deps.confirm : window.confirm.bind(window);\n      if (!ask('恢复全局翻译推荐设置？当前聊天的单独设置会保留。')) return false;\n      setStatus('translation-global-status', '正在恢复…', 'working');\n      const result = await deps.setStorage('translationGlobal', JSON.stringify(DEFAULTS));\n      if (result === false) {\n        setStatus('translation-global-status', '恢复失败，请重试', 'error');\n        refreshGlobal();\n        return false;\n      }\n      deps.sync();\n      refreshGlobal();\n      await refreshChat();\n      setStatus('translation-global-status', '翻译设置已恢复默认 ✓', 'ok');\n      return true;\n    }\n\n`;
translation = replaceOnce(translation, translationAnchor, translationResetFns + translationAnchor, 'translation reset functions');
translation = replaceOnce(translation,
  `      ensureAppearancePreview();\n      refreshAppearancePreview();\n`,
  `      ensureAppearancePreview();\n      refreshAppearancePreview();\n      ensureGlobalResetButton();\n`,
  'translation reset button');
translation = replaceOnce(translation,
  `      el('translation-gateway-test')?.addEventListener('click', () => checkHealth(true));\n`,
  `      el('translation-gateway-test')?.addEventListener('click', () => checkHealth(true));\n      el('translation-reset-global')?.addEventListener('click', resetGlobalDefaults);\n`,
  'translation reset binding');
translation = replaceOnce(translation,
  `    return Object.freeze({ bind, refreshGlobal, refreshChat, checkHealth });\n`,
  `    return Object.freeze({ bind, refreshGlobal, refreshChat, checkHealth, resetGlobalDefaults });\n`,
  'translation reset export');
fs.writeFileSync(translationPath, translation);

const settingsTestPath = path.join(root, 'test', 'settings-ux-contract.cjs');
let settingsTest = fs.readFileSync(settingsTestPath, 'utf8');
const settingsTestAnchor = `assert.match(controller, /已保存 ✓/, '保存成功必须内联反馈');\n`;
const settingsTestExtra = `assert.match(controller, /settings-reset-appearance/, '外观分区必须提供独立恢复默认入口');\nassert.match(controller, /settings-reset-account-display/, '当前账号显示分区必须提供独立恢复默认入口');\nassert.match(controller, /APPEARANCE_DEFAULTS = Object\\.freeze\\(\\{ theme: 'dark', accent: 'green' \\}\\)/, '外观默认值必须明确且只包含主题与强调色');\nassert.match(controller, /ACCOUNT_DISPLAY_DEFAULTS = Object\\.freeze\\(\\{ fontSize: 16, fontColor: '#18A058' \\}\\)/, '账号显示默认值必须只包含字号与颜色');\nassert.match(controller, /账号名称、代理和登录状态不会改变/, '账号显示恢复必须明确安全边界');\n`;
settingsTest = replaceOnce(settingsTest, settingsTestAnchor, settingsTestAnchor + settingsTestExtra, 'settings reset contract');
fs.writeFileSync(settingsTestPath, settingsTest);

const translationTestPath = path.join(root, 'test', 'translation-settings-ux-contract.cjs');
let translationTest = fs.readFileSync(translationTestPath, 'utf8');
const translationTestAnchor = `assert.match(css, /translation-appearance-preview-text/, '预览必须有独立聚焦样式');\n`;
const translationTestExtra = `assert.match(ux, /translation-reset-global/, '翻译设置必须提供独立恢复推荐设置入口');\nassert.match(ux, /setStorage\\('translationGlobal', JSON\\.stringify\\(DEFAULTS\\)\\)/, '翻译恢复默认必须只复用现有 translationGlobal 与 DEFAULTS');\nconst resetStart = ux.indexOf('async function resetGlobalDefaults()');\nconst resetEnd = ux.indexOf('async function checkHealth', resetStart);\nassert.ok(resetStart >= 0 && resetEnd > resetStart, '翻译恢复默认函数必须保持聚焦');\nassert.ok(!ux.slice(resetStart, resetEnd).includes('translationChats'), '翻译全局恢复默认不得修改当前聊天 override');\nassert.match(ux.slice(resetStart, resetEnd), /当前聊天的单独设置会保留/, '恢复前必须明确当前聊天单独设置会保留');\n`;
translationTest = replaceOnce(translationTest, translationTestAnchor, translationTestAnchor + translationTestExtra, 'translation reset contract');
fs.writeFileSync(translationTestPath, translationTest);

console.log('SAFE_SECTION_RESET_PATCH_OK');
