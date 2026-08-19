'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'ui', 'index.html');
const appPath = path.join(root, 'ui', 'app.js');

function replaceBounded(source, start, end, replacement, label) {
  const first = source.indexOf(start);
  if (first < 0) throw new Error(`${label}: start anchor missing`);
  if (source.indexOf(start, first + start.length) >= 0) throw new Error(`${label}: start anchor is not unique`);
  const finish = source.indexOf(end, first + start.length);
  if (finish < 0) throw new Error(`${label}: end anchor missing`);
  return source.slice(0, first) + replacement + source.slice(finish);
}

let html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes('./translation-settings.css')) {
  const cssAnchor = '  <link rel="stylesheet" href="./style-mac.css">\n';
  if (!html.includes(cssAnchor)) throw new Error('index: stylesheet anchor missing');
  html = html.replace(cssAnchor, cssAnchor + '  <link rel="stylesheet" href="./translation-settings.css">\n');
}

const popoverStart = '          <div id="translation-popover" class="translation-popover hidden" role="dialog" aria-label="翻译通道设置">';
const popoverEnd = '          <button class="quick-btn" id="btn-broadcast" title="群发">';
const popover = String.raw`          <div id="translation-popover" class="translation-popover hidden" role="dialog" aria-label="翻译设置">
            <div class="translation-popover-head">
              <div class="translation-head-copy"><strong>翻译设置</strong><small>当前账号独立保存，修改后自动生效</small></div>
              <span id="translation-service-state" class="translation-service-state" data-state="idle">服务状态</span>
              <button type="button" id="translation-close" class="translation-close" aria-label="关闭翻译设置">×</button>
            </div>
            <div class="translation-tabs">
              <button type="button" class="translation-tab active" data-translation-tab="global">常用设置</button>
              <button type="button" class="translation-tab" data-translation-tab="channel">当前聊天</button>
              <button type="button" class="translation-tab" data-translation-tab="advanced">高级设置</button>
            </div>
            <section id="translation-tab-global" class="translation-tab-panel translation-tab-panel--scroll">
              <div class="translation-intro">按聊天习惯设置即可：收到的消息翻成你看的语言，发送时翻成对方看的语言。线路等低频选项已放到“高级设置”。</div>
              <div class="translation-card">
                <div class="translation-card-title">收到的消息</div>
                <div class="translation-card-sub">自动把对方发来的消息显示成你熟悉的语言。</div>
                <label class="translation-switch-row">
                  <span class="translation-switch-copy"><strong>自动翻译收到的消息</strong><small>关闭后仍可按需手动翻译</small></span>
                  <input id="translation-receive-auto" class="translation-switch-input" type="checkbox">
                </label>
                <label class="translation-row"><span>翻译成</span><select id="translation-message-to"></select></label>
                <label class="translation-switch-row">
                  <span class="translation-switch-copy"><strong>群聊也自动翻译</strong><small>只在自动翻译开启时生效</small></span>
                  <input id="translation-group" class="translation-switch-input" type="checkbox">
                </label>
              </div>
              <div class="translation-card">
                <div class="translation-card-title">发送消息</div>
                <div class="translation-card-sub">发送前自动翻译，不改变你输入原文的习惯。</div>
                <label class="translation-switch-row">
                  <span class="translation-switch-copy"><strong>发送前自动翻译</strong><small>关闭后按原文直接发送</small></span>
                  <input id="translation-send" class="translation-switch-input" type="checkbox">
                </label>
                <label class="translation-row"><span>我通常使用</span><select id="translation-send-from"></select></label>
                <label class="translation-row"><span>发送为</span><select id="translation-send-to"></select></label>
              </div>
              <div id="translation-global-status" class="translation-save-status" aria-live="polite"></div>
            </section>
            <section id="translation-tab-channel" class="translation-tab-panel hidden">
              <div class="translation-chat-summary">
                <div><strong>当前聊天</strong><span id="translation-chat-mode" class="translation-chat-mode" data-state="idle">未检测到聊天</span></div>
                <label class="translation-switch-row" style="min-height:auto;padding:0">
                  <span class="translation-switch-copy"><strong>单独设置</strong><small>关闭时跟随全局</small></span>
                  <input id="translation-chat-override" class="translation-switch-input" type="checkbox">
                </label>
              </div>
              <div id="translation-chat-custom" class="hidden">
                <div class="translation-card">
                  <div class="translation-card-title">这个聊天的接收设置</div>
                  <label class="translation-switch-row">
                    <span class="translation-switch-copy"><strong>自动翻译收到的消息</strong><small>关闭后改为按需翻译</small></span>
                    <input id="translation-channel-receive-auto" class="translation-switch-input" type="checkbox">
                  </label>
                  <label class="translation-row"><span>翻译成</span><select id="translation-channel-message-to"></select></label>
                </div>
                <div class="translation-card">
                  <div class="translation-card-title">这个聊天的发送设置</div>
                  <label class="translation-switch-row">
                    <span class="translation-switch-copy"><strong>发送前自动翻译</strong><small>只影响当前聊天</small></span>
                    <input id="translation-enabled" class="translation-switch-input" type="checkbox">
                  </label>
                  <label class="translation-row"><span>发送为</span><select id="translation-target"></select></label>
                  <label class="translation-switch-row">
                    <span class="translation-switch-copy"><strong>允许手动翻译</strong><small>保留右键/按需翻译能力</small></span>
                    <input id="translation-message-action" class="translation-switch-input" type="checkbox">
                  </label>
                </div>
                <button type="button" id="translation-chat-reset" class="translation-save translation-save--secondary translation-reset">恢复为全局设置</button>
              </div>
              <input id="translation-auto-send" type="checkbox" hidden>
              <div id="translation-chat-hint" class="translation-hint">请先在当前平台打开一个聊天</div>
              <div id="translation-chat-status" class="translation-save-status" aria-live="polite"></div>
            </section>
            <section id="translation-tab-advanced" class="translation-tab-panel translation-tab-panel--scroll hidden">
              <input id="translation-source" type="hidden" value="auto">
              <input id="translation-message" type="hidden" value="auto">
              <details class="translation-advanced" open>
                <summary>翻译行为</summary>
                <div class="translation-advanced-body">
                  <label class="translation-row"><span>翻译线路</span><select id="translation-server"><option value="default">自动选择（推荐）</option><option value="primary">主线路</option><option value="backup">备用线路</option></select></label>
                  <label class="translation-row"><span>收到消息原语言</span><select id="translation-message-from"></select></label>
                  <label class="translation-switch-row">
                    <span class="translation-switch-copy"><strong>包含中文消息</strong><small>发送翻译时也处理包含中文的内容</small></span>
                    <input id="translation-include-zh" class="translation-switch-input" type="checkbox">
                  </label>
                  <label class="translation-switch-row">
                    <span class="translation-switch-copy"><strong>允许显示译文</strong><small>关闭后聊天里不挂载译文</small></span>
                    <input id="translation-display" class="translation-switch-input" type="checkbox">
                  </label>
                  <label class="translation-switch-row">
                    <span class="translation-switch-copy"><strong>允许手动翻译</strong><small>保留右键翻译入口</small></span>
                    <input id="translation-manual" class="translation-switch-input" type="checkbox">
                  </label>
                </div>
              </details>
              <details class="translation-advanced">
                <summary>译文外观</summary>
                <div class="translation-advanced-body">
                  <label class="translation-row"><span>字体大小</span><select id="translation-font-size"><option value="11">小</option><option value="13">标准</option><option value="15">大</option></select></label>
                  <label class="translation-row"><span>字体颜色</span><input id="translation-font-color" type="color" value="#667eea"></label>
                </div>
              </details>
              <details class="translation-advanced">
                <summary>服务状态</summary>
                <div class="translation-advanced-body">
                  <div class="translation-service-actions">
                    <button type="button" id="translation-gateway-test" class="translation-save translation-save--secondary">重新检测</button>
                    <div id="translation-gateway-status" class="translation-hint"></div>
                  </div>
                </div>
              </details>
            </section>
          </div>
`;
html = replaceBounded(html, popoverStart, popoverEnd, popover, 'index translation popover');

if (!html.includes('<script src="translation-settings.js"></script>')) {
  const scriptAnchor = '<script src="translation-adapters.js"></script>\n';
  if (!html.includes(scriptAnchor)) throw new Error('index: script anchor missing');
  html = html.replace(scriptAnchor, scriptAnchor + '<script src="translation-settings.js"></script>\n');
}
fs.writeFileSync(indexPath, html);

let app = fs.readFileSync(appPath, 'utf8');
const appStart = '  // ---------- 翻译通道（极客自有入口；原版行为，后端网关可插拔） ----------';
const appEnd = '  // 托盘菜单"锁屏" → 触发渲染层锁屏';
const appIntegration = String.raw`  // ---------- 翻译设置（体验层独立模块；沿用既有账号沙箱与平台同步） ----------
  const translationSettings = window.GeekTranslationSettings.create({
    core: window.GeekTranslationCore,
    getActiveId: () => activeId,
    getStorage: (key) => accountStorageGetItem(key),
    setStorage: (key, raw) => accountStorageSetItem(key, raw),
    getCurrentChat: async () => {
      const account = accounts.find(item => item.id === activeId);
      const wv = wvMap.get(activeId);
      if (!account || !wv || typeof wv.executeJavaScript !== 'function') return null;
      try { return await platformTransportFor(account, wv).getCurrentChat(); }
      catch { return null; }
    },
    sync: () => {
      const account = accounts.find(item => item.id === activeId);
      if (account) syncTranslationCfgToWebview(wvMap.get(activeId), account);
    },
    health: () => window.api.translation.health(),
  });
  function refreshTranslationGlobalPanel() {
    translationSettings.refreshGlobal();
    void translationSettings.refreshChat();
  }
  translationSettings.bind();

`;
app = replaceBounded(app, appStart, appEnd, appIntegration, 'app translation settings');
fs.writeFileSync(appPath, app);

console.log('TRANSLATION_SETTINGS_PATCH_OK');
