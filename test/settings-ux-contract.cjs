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
for (const title of ['外观','启动与通知','安全','网络代理']) assert.match(html, new RegExp(title), `全局设置缺少任务分组: ${title}`);
assert.doesNotMatch(html, /data-tab="account"|id="acc-select"|id="acc-openProxy"/, '普通 Settings 不再拥有实例账号设置');
assert.match(html, /id="account-settings-overlay"/, '实例显示设置必须迁移到独立右键面板');
assert.match(html, /id="proxy-overlay"/, '实例代理必须保留独立右键面板');
assert.match(html, /id="cfg-openProxy"[^>]*type="checkbox"|type="checkbox"[^>]*id="cfg-openProxy"/, '全局代理必须使用直接开关');
assert.match(html, /id="settings-status"[^>]*aria-live="polite"/, '保存结果必须有内联 live status');

assert.match(controller, /PROXY_GLOBAL_IDS/, 'controller 必须集中管理全局代理字段联动');
assert.doesNotMatch(controller, /PROXY_ACCOUNT_IDS|updateAccount|acc-select|ACCOUNT_DISPLAY_DEFAULTS/, '全局 Settings controller 不得继续拥有实例字段');
assert.match(controller, /1-65535/, '启用全局代理时必须校验端口范围');
assert.match(controller, /restorePreview/, '取消设置必须恢复外观预览');
assert.match(controller, /保存失败/, '保存失败必须内联反馈');
assert.match(controller, /已保存 ✓/, '保存成功必须内联反馈');
assert.match(controller, /settings-reset-appearance/, '外观分区必须提供独立恢复默认入口');
assert.match(controller, /APPEARANCE_DEFAULTS = Object\.freeze\(\{ theme: 'dark', accent: 'green' \}\)/, '外观默认值必须明确且只包含主题与强调色');
assert.match(app, /GeekSettingsController\.create\(/, 'app.js 应只注入全局设置 controller 运行时依赖');
assert.match(app, /function openSettings\(\)/, '必须保留现有 openSettings 兼容入口');
assert.match(app, /showAccountSettingsDialog\(account\)/, '实例设置必须由右键上下文打开');
assert.match(app, /showProxyDialog\(account\)/, '实例代理必须由右键上下文打开');
assert.ok(css.length < 10000, '设置 UX 样式应保持聚焦');

const context = { window: {}, document: {}, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(controller, context, { filename: 'settings-controller.js' });
assert.equal(typeof context.window.GeekSettingsController?.create, 'function', '设置 controller 必须可独立加载');

console.log('SETTINGS_UX_CONTRACT_OK');
