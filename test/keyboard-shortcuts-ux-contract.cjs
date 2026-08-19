'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const settings = fs.readFileSync(path.join(root, 'ui', 'settings-controller.js'), 'utf8');
const translation = fs.readFileSync(path.join(root, 'ui', 'translation-settings.js'), 'utf8');

assert.match(settings, /\(event\.ctrlKey \|\| event\.metaKey\)[\s\S]*event\.key === ','/, '设置必须支持 Ctrl+, / Cmd+,');
assert.match(settings, /overlayVisible\('lock-overlay'\)/, '锁屏状态必须阻止设置快捷键');
assert.match(settings, /overlayVisible\('settings-overlay'\)[\s\S]*settings-close'\)\?\.focus/, '重复设置快捷键必须聚焦现有面板而不是重复打开');
assert.match(settings, /event\.key === 'Escape'[\s\S]*stopImmediatePropagation\(\)[\s\S]*close\(\{ restorePreview: true \}\)/, '设置 Esc 必须只关闭顶层设置并恢复预览');
assert.match(settings, /returnFocus/, '设置打开关闭必须保存并恢复壳层焦点');
assert.match(settings, /document\.addEventListener\('keydown', handleKeydown\)/, '设置 controller 必须自行绑定键盘事件');

assert.match(translation, /event\.key !== 'Escape'/, '翻译面板必须支持 Esc');
assert.match(translation, /panelVisible\('settings-overlay'\)/, '设置覆盖翻译时翻译 Esc handler 必须让路');
assert.match(translation, /closePopover\(\{ restoreFocus: true \}\)/, '翻译 Esc/关闭必须统一走可恢复焦点的关闭路径');
assert.match(translation, /button\?\.focus\(\)/, '关闭翻译面板后必须把焦点还给翻译按钮');
assert.match(translation, /document\.addEventListener\('keydown', handleKeydown\)/, '翻译 controller 必须自行绑定键盘事件');

for (const source of [settings, translation]) {
  assert.doesNotMatch(source, /globalShortcut|before-input-event/, '本轮不得升级为主进程或 guest 级全局快捷键');
}

console.log('KEYBOARD_SHORTCUTS_UX_CONTRACT_OK');
