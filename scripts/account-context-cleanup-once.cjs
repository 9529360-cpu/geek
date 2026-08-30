'use strict';
const fs = require('node:fs');

function removeRegion(file, startMarker, endMarker) {
  let text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`${file}: region markers missing`);
  text = text.slice(0, start) + text.slice(end);
  fs.writeFileSync(file, text, 'utf8');
}

removeRegion('ui/index.html', '<!-- 独立代理IP 弹窗 -->', '<!-- 添加账号弹窗 -->');
removeRegion('ui/app.js', '  // ---------- 独立代理IP 弹窗（原版 Proxy IP） ----------', '  // ---------- 排序 ----------');

const settingsFile = 'ui/settings-controller.js';
let settings = fs.readFileSync(settingsFile, 'utf8');
const validateStart = settings.indexOf('    function validate() {');
const validateEnd = settings.indexOf('    function activateTab(name) {', validateStart);
if (validateStart < 0 || validateEnd < 0) throw new Error('validate region missing');
const validate = `    function validate() {
      if (!lockedAccountId) {
        const globalProxyError = validateProxy(checked('cfg-openProxy'), value('cfg-host'), value('cfg-port'), '全局代理');
        if (globalProxyError) return { ok: false, message: globalProxyError, focusId: !value('cfg-host').trim() ? 'cfg-host' : 'cfg-port' };
        return { ok: true };
      }

      const accountId = currentAccountId();
      if (!accountId) return { ok: false, message: '目标账号不存在', focusId: 'acc-name', tab: 'account' };
      const name = value('acc-name').trim();
      if (!name) return { ok: false, message: '账号显示名不能为空', focusId: 'acc-name', tab: 'account' };
      if (name.length > 80) return { ok: false, message: '账号显示名不能超过 80 个字符', focusId: 'acc-name', tab: 'account' };
      const fontSize = Number(value('acc-fontSize'));
      if (!Number.isInteger(fontSize) || fontSize < 10 || fontSize > 28) return { ok: false, message: '字体大小必须是 10-28 的整数', focusId: 'acc-fontSize', tab: 'account' };
      const accountProxyError = validateProxy(checked('acc-openProxy'), value('acc-host'), value('acc-port'), '账号代理');
      if (accountProxyError) return { ok: false, message: accountProxyError, focusId: !value('acc-host').trim() ? 'acc-host' : 'acc-port', tab: 'account' };
      return { ok: true };
    }

`;
settings = settings.slice(0, validateStart) + validate + settings.slice(validateEnd);
settings = settings.replace(
`        const nextConfig = configPatch();
const accountId = currentAccountId();
if (lockedAccountId) {
  await deps.updateAccount(accountId, accountPatch());
} else {
  await deps.setConfig(nextConfig);
  config = { ...config, ...nextConfig };
  deps.applyTheme(nextConfig.theme, nextConfig.accent);
}`,
`        const nextConfig = configPatch();
        const accountId = currentAccountId();
        if (lockedAccountId) {
          await deps.updateAccount(accountId, accountPatch());
        } else {
          await deps.setConfig(nextConfig);
          config = { ...config, ...nextConfig };
          deps.applyTheme(nextConfig.theme, nextConfig.accent);
        }`);
fs.writeFileSync(settingsFile, settings, 'utf8');

const testFile = 'test/account-context-phase2-contract.cjs';
let test = fs.readFileSync(testFile, 'utf8');
const proxyAnchor = "assert.match(app, /settingsController\\.openAccount\\(accountId,\\s*\\{\\s*focus:\\s*['\"]proxy['\"]\\s*\\}\\)/, '代理菜单必须复用同一个固定实例账号设置 handler');\n";
if (!test.includes(proxyAnchor)) throw new Error('proxy contract anchor missing');
test = test.replace(proxyAnchor, proxyAnchor +
  "assert.doesNotMatch(html, /id=\\\"proxy-overlay\\\"/, '旧独立代理弹窗必须移除，避免第二套代理状态');\n" +
  "assert.doesNotMatch(app, /showProxyDialog|proxyAccountId/, 'renderer 不得保留第二套代理保存 handler');\n");
const settingsAnchor = "assert.match(settings, /lockedAccountId/, '实例设置必须保存固定 target，而不是依赖 active account');\n";
if (!test.includes(settingsAnchor)) throw new Error('settings contract anchor missing');
test = test.replace(settingsAnchor, settingsAnchor +
  "assert.match(settings, /if \\(!lockedAccountId\\)[\\s\\S]{0,500}globalProxyError[\\s\\S]{0,500}return \\{ ok: true \\}/, '普通设置只校验全局字段');\n" +
  "assert.match(settings, /const accountId = currentAccountId\\(\\);[\\s\\S]{0,500}账号显示名不能为空/, '实例设置必须只校验固定 target 字段');\n");
fs.writeFileSync(testFile, test, 'utf8');
