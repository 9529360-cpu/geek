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
  "    let statusTimer = null;\n",
  "    let statusTimer = null;\n    let returnFocus = null;\n",
  'settings focus state');

settings = replaceOnce(settings,
  "    function setStatus(text, kind = '') {\n",
  "    function overlayVisible(id) {\n      const node = el(id);\n      return !!node && !node.classList.contains('hidden');\n    }\n\n    function restoreFocus() {\n      const target = returnFocus;\n      returnFocus = null;\n      if (target && target.isConnected !== false && typeof target.focus === 'function') target.focus();\n    }\n\n    function setStatus(text, kind = '') {\n",
  'settings visibility helpers');

settings = replaceOnce(settings,
`    async function open(preferredAccountId = '') {\n      const activeTab = document.querySelector('.settings-tab.active')?.dataset.tab || 'global';\n      const before = await deps.getConfig() || {};\n      previewSnapshot = { theme: before.theme || 'dark', accent: before.accent || 'green' };\n      await load(preferredAccountId);\n      activateTab(activeTab);\n      el('settings-overlay')?.classList.remove('hidden');\n    }\n\n    function close({ restorePreview = false } = {}) {\n      if (restorePreview && previewSnapshot) deps.applyTheme(previewSnapshot.theme, previewSnapshot.accent);\n      previewSnapshot = null;\n      el('settings-overlay')?.classList.add('hidden');\n      setStatus('');\n    }\n`,
`    async function open(preferredAccountId = '') {\n      if (overlayVisible('settings-overlay')) {\n        el('settings-close')?.focus();\n        return;\n      }\n      const activeTab = document.querySelector('.settings-tab.active')?.dataset.tab || 'global';\n      const active = document.activeElement;\n      returnFocus = active && typeof active.focus === 'function' ? active : null;\n      const before = await deps.getConfig() || {};\n      previewSnapshot = { theme: before.theme || 'dark', accent: before.accent || 'green' };\n      await load(preferredAccountId);\n      activateTab(activeTab);\n      el('settings-overlay')?.classList.remove('hidden');\n      el('settings-close')?.focus();\n    }\n\n    function close({ restorePreview = false } = {}) {\n      if (!overlayVisible('settings-overlay')) return;\n      if (restorePreview && previewSnapshot) deps.applyTheme(previewSnapshot.theme, previewSnapshot.accent);\n      previewSnapshot = null;\n      el('settings-overlay')?.classList.add('hidden');\n      setStatus('');\n      restoreFocus();\n    }\n`,
  'settings open close');

settings = replaceOnce(settings,
  "    function bind() {\n",
  "    function handleKeydown(event) {\n      if (event.defaultPrevented || event.repeat) return;\n      const settingsShortcut = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key === ',';\n      if (settingsShortcut) {\n        if (overlayVisible('lock-overlay')) return;\n        event.preventDefault();\n        event.stopPropagation();\n        if (overlayVisible('settings-overlay')) {\n          el('settings-close')?.focus();\n          return;\n        }\n        const preferredId = typeof deps.getActiveId === 'function' ? deps.getActiveId() : '';\n        void open(preferredId);\n        return;\n      }\n      if (event.key === 'Escape' && overlayVisible('settings-overlay')) {\n        event.preventDefault();\n        event.stopImmediatePropagation();\n        close({ restorePreview: true });\n      }\n    }\n\n    function bind() {\n",
  'settings keyboard handler');

settings = replaceOnce(settings,
  "      el('settings-save')?.addEventListener('click', save);\n",
  "      el('settings-save')?.addEventListener('click', save);\n      document.addEventListener('keydown', handleKeydown);\n",
  'settings keyboard binding');
fs.writeFileSync(settingsPath, settings);

const translationPath = path.join(root, 'ui', 'translation-settings.js');
let translation = fs.readFileSync(translationPath, 'utf8');
translation = replaceOnce(translation,
  "    function activateTab(name) {\n",
  "    function panelVisible(id) {\n      const node = el(id);\n      return !!node && !node.classList.contains('hidden');\n    }\n\n    function closePopover({ restoreFocus = true } = {}) {\n      const popover = el('translation-popover');\n      const button = el('btn-translation');\n      popover?.classList.add('hidden');\n      button?.setAttribute('aria-expanded', 'false');\n      if (restoreFocus) button?.focus();\n    }\n\n    function handleKeydown(event) {\n      if (event.defaultPrevented || event.repeat || event.key !== 'Escape') return;\n      if (!panelVisible('translation-popover')) return;\n      if (panelVisible('settings-overlay')) return;\n      event.preventDefault();\n      event.stopPropagation();\n      closePopover({ restoreFocus: true });\n    }\n\n    function activateTab(name) {\n",
  'translation keyboard helpers');

translation = replaceOnce(translation,
`      el('translation-close')?.addEventListener('click', () => {\n        popover?.classList.add('hidden');\n        button?.setAttribute('aria-expanded', 'false');\n      });\n`,
`      el('translation-close')?.addEventListener('click', () => closePopover({ restoreFocus: true }));\n      document.addEventListener('keydown', handleKeydown);\n`,
  'translation close and keyboard binding');
fs.writeFileSync(translationPath, translation);

const contract = `'use strict';\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst path = require('node:path');\n\nconst root = path.resolve(__dirname, '..');\nconst settings = fs.readFileSync(path.join(root, 'ui', 'settings-controller.js'), 'utf8');\nconst translation = fs.readFileSync(path.join(root, 'ui', 'translation-settings.js'), 'utf8');\n\nassert.match(settings, /\\(event\\.ctrlKey \\|\\| event\\.metaKey\\)[\\s\\S]*event\\.key === ','/, '设置必须支持 Ctrl+, / Cmd+,');\nassert.match(settings, /overlayVisible\\('lock-overlay'\\)/, '锁屏状态必须阻止设置快捷键');\nassert.match(settings, /overlayVisible\\('settings-overlay'\\)[\\s\\S]*settings-close'\\)\\?\\.focus/, '重复设置快捷键必须聚焦现有面板而不是重复打开');\nassert.match(settings, /event\\.key === 'Escape'[\\s\\S]*stopImmediatePropagation\\(\\)[\\s\\S]*close\\(\\{ restorePreview: true \\}\\)/, '设置 Esc 必须只关闭顶层设置并恢复预览');\nassert.match(settings, /returnFocus/, '设置打开关闭必须保存并恢复壳层焦点');\nassert.match(settings, /document\\.addEventListener\\('keydown', handleKeydown\\)/, '设置 controller 必须自行绑定键盘事件');\n\nassert.match(translation, /event\\.key !== 'Escape'/, '翻译面板必须支持 Esc');\nassert.match(translation, /panelVisible\\('settings-overlay'\\)/, '设置覆盖翻译时翻译 Esc handler 必须让路');\nassert.match(translation, /closePopover\\(\\{ restoreFocus: true \\}\\)/, '翻译 Esc/关闭必须统一走可恢复焦点的关闭路径');\nassert.match(translation, /button\\?\\.focus\\(\\)/, '关闭翻译面板后必须把焦点还给翻译按钮');\nassert.match(translation, /document\\.addEventListener\\('keydown', handleKeydown\\)/, '翻译 controller 必须自行绑定键盘事件');\n\nfor (const source of [settings, translation]) {\n  assert.doesNotMatch(source, /globalShortcut|before-input-event/, '本轮不得升级为主进程或 guest 级全局快捷键');\n}\n\nconsole.log('KEYBOARD_SHORTCUTS_UX_CONTRACT_OK');\n`;
fs.writeFileSync(path.join(root, 'test', 'keyboard-shortcuts-ux-contract.cjs'), contract);

console.log('KEYBOARD_CONVENIENCE_PATCH_OK');
