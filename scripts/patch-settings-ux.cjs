'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'ui', 'index.html');
const appPath = path.join(root, 'ui', 'app.js');

function replaceBounded(source, start, end, replacement, label) {
  const first = source.indexOf(start);
  if (first < 0) throw new Error(`${label}: start anchor missing`);
  if (source.indexOf(start, first + start.length) >= 0) throw new Error(`${label}: start anchor not unique`);
  const finish = source.indexOf(end, first + start.length);
  if (finish < 0) throw new Error(`${label}: end anchor missing`);
  return source.slice(0, first) + replacement + source.slice(finish);
}

let html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes('./settings-controller.css')) {
  const cssAnchor = '  <link rel="stylesheet" href="./translation-settings.css">\n';
  if (!html.includes(cssAnchor)) throw new Error('settings css anchor missing');
  html = html.replace(cssAnchor, cssAnchor + '  <link rel="stylesheet" href="./settings-controller.css">\n');
}

const settingsStart = '<!-- 设置面板 -->';
const settingsEnd = '<div id="broadcast-overlay" class="overlay hidden">';
const settingsMarkup = String.raw`<!-- 设置面板 -->
<div id="settings-overlay" class="overlay hidden">
  <div class="settings-panel settings-panel--humanized" role="dialog" aria-modal="true" aria-label="设置">
    <div class="settings-header">
      <div class="settings-head-copy"><span>设置</span><small>按使用场景调整，保存前可直接预览外观</small></div>
      <button id="settings-close" class="settings-close" aria-label="关闭设置">×</button>
    </div>
    <div class="settings-tabs">
      <button class="settings-tab active" data-tab="global">应用设置</button>
      <button class="settings-tab" data-tab="account">账号设置</button>
    </div>

    <div id="settings-global" class="settings-body settings-body--cards">
      <section class="settings-card">
        <div class="settings-card-title">外观</div>
        <div class="settings-card-sub">主题和强调色会即时预览；取消后恢复打开设置前的外观。</div>
        <div class="row-item"><span>主题</span><select id="cfg-theme"><option value="system">跟随系统</option><option value="dark">深色</option><option value="light">浅色</option></select></div>
        <div class="row-item"><span>强调色</span><select id="cfg-accent"><option value="green">极客绿</option><option value="blue">深蓝</option><option value="purple">深紫</option><option value="cyan">青色</option><option value="orange">橙色</option><option value="pink">粉色</option></select></div>
      </section>

      <section class="settings-card">
        <div class="settings-card-title">启动与通知</div>
        <div class="settings-card-sub">控制极客如何随系统启动，以及收到新消息时的提示方式。</div>
        <label class="settings-switch-row"><span class="settings-switch-copy"><strong>开机自动启动</strong><small>登录 Windows 后自动启动极客</small></span><input class="settings-switch-input" type="checkbox" id="cfg-autoLaunch"></label>
        <label class="settings-switch-row"><span class="settings-switch-copy"><strong>启动时最小化</strong><small>适合长期挂机收消息</small></span><input class="settings-switch-input" type="checkbox" id="cfg-isStartupMinimize"></label>
        <label class="settings-switch-row"><span class="settings-switch-copy"><strong>消息提示音</strong><small>新未读消息到达时播放提示音</small></span><input class="settings-switch-input" type="checkbox" id="cfg-messageSound"></label>
      </section>

      <section class="settings-card">
        <div class="settings-card-title">安全</div>
        <div class="settings-card-sub">锁屏只保护极客界面，不会退出账号或停止后台收消息。</div>
        <div class="row-item"><span>锁屏密码</span><input type="password" id="cfg-lockPassword" placeholder="留空表示不设置锁屏密码" autocomplete="new-password"></div>
        <div class="settings-danger-note">锁屏密码会通过现有安全存储机制保存；此页面不会显示或记录历史密码。</div>
      </section>

      <section class="settings-card">
        <div class="settings-card-title">网络代理</div>
        <div class="settings-card-sub">全局代理适用于未开启“账号独立代理”的账号。代理设置保存后按现有 Session 逻辑生效。</div>
        <label class="settings-switch-row"><span class="settings-switch-copy"><strong>启用全局代理</strong><small>关闭时所有未单独配置代理的账号直接连接</small></span><input class="settings-switch-input" type="checkbox" id="cfg-openProxy"></label>
        <div id="settings-global-proxy-fields" class="settings-fields">
          <div class="row-item"><span>协议</span><select id="cfg-protocal"><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks4">SOCKS4</option><option value="socks5">SOCKS5</option></select></div>
          <div class="row-item"><span>主机</span><input type="text" id="cfg-host" placeholder="127.0.0.1" autocomplete="off"></div>
          <div class="row-item"><span>端口</span><input type="text" id="cfg-port" inputmode="numeric" placeholder="7890" autocomplete="off"></div>
          <div class="row-item"><span>用户名</span><input type="text" id="cfg-login" placeholder="可选" autocomplete="off"></div>
          <div class="row-item"><span>密码</span><input type="password" id="cfg-password" placeholder="可选" autocomplete="new-password"></div>
        </div>
      </section>
    </div>

    <div id="settings-account" class="settings-body settings-body--cards hidden">
      <section class="settings-card">
        <div class="settings-card-title">选择账号</div>
        <div class="settings-card-sub">每个账号的名称、显示和独立代理互不影响。</div>
        <div class="row-item"><span>当前编辑</span><select id="acc-select"></select></div>
      </section>
      <div id="settings-account-empty" class="settings-account-empty hidden">当前没有可编辑的账号</div>
      <div id="settings-account-content" class="settings-body--cards">
        <section class="settings-card">
          <div class="settings-card-title">基本信息</div>
          <div class="settings-card-sub">这里只改变极客侧边栏中的显示方式，不修改聊天平台账号资料。</div>
          <div class="row-item"><span>显示名</span><input type="text" id="acc-name" maxlength="80"></div>
          <div class="row-item"><span>字体大小</span><input type="number" id="acc-fontSize" min="10" max="28" step="1"></div>
          <div class="row-item"><span>字体颜色</span><input type="color" id="acc-fontColor"></div>
        </section>
        <section class="settings-card">
          <div class="settings-card-title">当前账号网络</div>
          <div class="settings-card-sub">独立代理优先于全局代理；关闭后自动回到全局代理或直连。</div>
          <div class="settings-proxy-strategy">
            <div class="settings-proxy-strategy-main"><strong>实际连接策略</strong><small id="settings-proxy-strategy-detail">正在读取…</small></div>
            <span id="settings-proxy-strategy" class="settings-proxy-strategy-badge" data-state="direct">当前为直连</span>
          </div>
          <label class="settings-switch-row"><span class="settings-switch-copy"><strong>使用账号独立代理</strong><small>开启后只影响当前账号</small></span><input class="settings-switch-input" type="checkbox" id="acc-openProxy"></label>
          <div id="settings-account-proxy-fields" class="settings-fields">
            <div class="row-item"><span>主机</span><input type="text" id="acc-host" placeholder="127.0.0.1" autocomplete="off"></div>
            <div class="row-item"><span>端口</span><input type="text" id="acc-port" inputmode="numeric" placeholder="7890" autocomplete="off"></div>
            <div class="row-item"><span>用户名</span><input type="text" id="acc-huser" placeholder="可选" autocomplete="off"></div>
            <div class="row-item"><span>密码</span><input type="password" id="acc-hpwd" placeholder="可选" autocomplete="new-password"></div>
          </div>
        </section>
      </div>
    </div>

    <div class="settings-footer settings-footer--status">
      <div id="settings-status" class="settings-status" aria-live="polite"></div>
      <button id="settings-cancel" class="btn-plain">取消</button>
      <button id="settings-save" class="btn-add">保存更改</button>
    </div>
  </div>
</div>

`;
html = replaceBounded(html, settingsStart, settingsEnd, settingsMarkup, 'settings markup');

if (!html.includes('<script src="settings-controller.js"></script>')) {
  const scriptAnchor = '<script src="translation-settings.js"></script>\n';
  if (!html.includes(scriptAnchor)) throw new Error('settings script anchor missing');
  html = html.replace(scriptAnchor, scriptAnchor + '<script src="settings-controller.js"></script>\n');
}
fs.writeFileSync(indexPath, html);

let app = fs.readFileSync(appPath, 'utf8');
const appStart = '  // ---------- 设置面板 ----------';
const appEnd = '  function reloadAccountScopedUiState() {';
const appIntegration = String.raw`  // ---------- 设置面板（体验层独立模块；沿用既有 config/accounts IPC） ----------
  const settingsController = window.GeekSettingsController.create({
    getConfig: () => window.api.config.get(),
    setConfig: patch => window.api.config.set(patch),
    getAccounts: () => window.api.accounts.list(),
    updateAccount: (accountId, patch) => window.api.accounts.update(accountId, patch),
    applyTheme,
    getActiveId: () => activeId,
    familyLabel: type => familyOf(type).label,
    afterSave: async () => { await loadAccounts(); },
  });
  function openSettings() {
    const preferred = accSelect.value || activeId || '';
    return settingsController.open(preferred);
  }
  function closeSettings() {
    settingsController.close();
  }
  function loadAccountSettingsForm() {
    settingsController.loadAccount();
  }
  settingsController.bind();

`;
app = replaceBounded(app, appStart, appEnd, appIntegration, 'settings app integration');
fs.writeFileSync(appPath, app);

console.log('SETTINGS_UX_PATCH_OK');
