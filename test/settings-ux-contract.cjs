'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'ui', 'settings-controller.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'ui', 'settings-controller.css'), 'utf8');

assert.match(html, /settings-controller\.css/, '设置面板必须加载独立 UX 样式');
assert.match(html, /settings-controller\.js/, '设置面板必须加载独立 controller');
for (const title of ['外观','启动与通知','安全','网络代理','基本信息','当前账号网络']) assert.match(html, new RegExp(title), `设置面板缺少任务分组: ${title}`);
assert.match(html, /id="cfg-openProxy"[^>]*type="checkbox"|type="checkbox"[^>]*id="cfg-openProxy"/, '全局代理必须使用直接开关');
assert.match(html, /id="acc-openProxy"[^>]*type="checkbox"|type="checkbox"[^>]*id="acc-openProxy"/, '账号代理必须使用直接开关');
assert.match(html, /id="settings-proxy-strategy"/, '账号设置必须显示实际代理策略');
assert.match(html, /id="settings-status"[^>]*aria-live="polite"/, '保存结果必须有内联 live status');

assert.match(controller, /PROXY_GLOBAL_IDS/, 'controller 必须集中管理全局代理字段联动');
assert.match(controller, /PROXY_ACCOUNT_IDS/, 'controller 必须集中管理账号代理字段联动');
assert.match(controller, /1-65535/, '启用代理时必须校验端口范围');
assert.match(controller, /账号显示名不能为空/, '必须校验账号显示名');
assert.match(controller, /10-28/, '必须校验账号字体大小');
assert.match(controller, /restorePreview/, '取消设置必须恢复外观预览');
assert.match(controller, /使用账号独立代理/, '必须区分账号独立代理策略');
assert.match(controller, /跟随全局代理/, '必须区分跟随全局代理策略');
assert.match(controller, /当前为直连/, '必须区分直连策略');
assert.match(controller, /保存失败/, '保存失败必须内联反馈');
assert.match(controller, /已保存 ✓/, '保存成功必须内联反馈');
assert.match(controller, /settings-reset-appearance/, '外观分区必须提供独立恢复默认入口');
assert.match(controller, /settings-reset-account-display/, '当前账号显示分区必须提供独立恢复默认入口');
assert.match(controller, /APPEARANCE_DEFAULTS = Object\.freeze\(\{ theme: 'dark', accent: 'green' \}\)/, '外观默认值必须明确且只包含主题与强调色');
assert.match(controller, /ACCOUNT_DISPLAY_DEFAULTS = Object\.freeze\(\{ fontSize: 16, fontColor: '#18A058' \}\)/, '账号显示默认值必须只包含字号与颜色');
assert.match(controller, /账号名称、代理和登录状态不会改变/, '账号显示恢复必须明确安全边界');
assert.match(app, /GeekSettingsController\.create\(/, 'app.js 应只注入设置 controller 运行时依赖');
assert.match(app, /function openSettings\(\)/, '必须保留现有 openSettings 兼容入口');
assert.match(app, /function loadAccountSettingsForm\(\)/, '必须保留现有账号设置刷新入口');
assert.ok(css.length < 10000, '设置 UX 样式应保持聚焦');

const context = { window: {}, document: {}, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(controller, context, { filename: 'settings-controller.js' });
assert.equal(typeof context.window.GeekSettingsController?.create, 'function', '设置 controller 必须可独立加载');

console.log('SETTINGS_UX_CONTRACT_OK');
