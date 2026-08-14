(() => {
  'use strict';

  // ---------- 群组工具常驻监听器（注入 WA webview） ----------
  // 聊天设置：被移出/退出自动删群、自动加入群链接
  // 指令：/kick /promote /demote /groupinfo /tagall（回复消息+指令，管理员可用）
  // 配置存 webview 域 localStorage（键 __gtAutoCfg），UI 保存时同步写入
  const GT_AGENT_SOURCE = `(() => {
  var GT_VERSION = 9;
  if (window.__gtAgentInstalled && window.__gtAgentVersion === GT_VERSION) return 'ALREADY';
  var W = window.WAPLUS_WPP || window.WPP;
  if (!W || typeof W.on !== 'function' || !W.chat || !W.group) { window.__gtAgentInstalled = false; return 'NO_WPP'; }
  // 新版本脚本：先卸载旧版本监听（开发/升级场景避免残留）
  if (window.__gtUninstall) { try { window.__gtUninstall(); } catch (e) {} }
  window.__gtAgentInstalled = true;
  window.__gtAgentVersion = GT_VERSION;
  var handlers = [];
  function on(ev, fn) { try { W.on(ev, fn); handlers.push([ev, fn]); } catch (e) {} }
  window.__gtUninstall = function () {
    for (var i = 0; i < handlers.length; i++) { try { W.off(handlers[i][0], handlers[i][1]); } catch (e) {} }
    handlers = [];
    window.__gtAgentInstalled = false;
    window.__gtAgentVersion = 0;
  };
  var CFG_KEY = '__gtAutoCfg';
  function gtCfg() {
    try { var c = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); return c && typeof c === 'object' ? c : {}; } catch (e) { return {}; }
  }
  window.__gtSetCfg = function (cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg || {})); } catch (e) {}
  };
  function meId() {
    try {
      var UP = W.whatsapp && W.whatsapp.UserPrefs;
      // 消息 sender 是 lid 格式——优先取 lid（原版用 mEandMeLid 比较）
      var me = UP && (UP.getMaybeMeLidUser ? UP.getMaybeMeLidUser() : (UP.getMeLidUserOrThrow ? UP.getMeLidUserOrThrow() : (UP.getMeUser ? UP.getMeUser() : null)));
      if (!me) return null;
      var id = me.id || me;
      return String(id._serialized || id);
    } catch (e) { return null; }
  }
  function sameUser(a, b) {
    if (!a || !b) return false;
    return String(a).split('@')[0] === String(b).split('@')[0];
  }
  function chatOf(msg) {
    try { return String((msg.id && msg.id.remote) || msg.chat || msg.to || ''); } catch (e) { return ''; }
  }
  function senderOf(msg) {
    try { return String((msg.senderObj && (msg.senderObj.id || msg.senderObj)) || msg.author || ''); } catch (e) { return ''; }
  }
  function widStr(x) {
    try { return String((x && (x._serialized || (x.id && x.id._serialized) || x.id)) || x); } catch (e) { return String(x); }
  }
  async function isAdminOf(groupId, userWid) {
    try {
      var parts = await W.group.getParticipants(groupId);
      for (var i = 0; i < parts.length; i++) {
        if (sameUser(widStr(parts[i].id), userWid)) return !!(parts[i].isAdmin || parts[i].isSuperAdmin);
      }
    } catch (e) {}
    return false;
  }
  function sendReply(chatId, text) {
    return W.chat.sendTextMessage(chatId, text).catch(function () {});
  }
  // 指令配置（原版 localStorage 键：指令名可自定义，默认 ban/adm/deadm/infog/tagall）
  function cmdCfg() {
    var c = {};
    try {
      c.cmdban = localStorage.getItem('comandoban') || 'ban';
      c.cmdadm = localStorage.getItem('comandoadm') || 'adm';
      c.cmddeadm = localStorage.getItem('comandodeadm') || 'deadm';
      c.cmdinfo = localStorage.getItem('comandoinfo') || 'infog';
      c.cmdtagall = localStorage.getItem('comandotagall') || 'tagall';
      c.permitiradmins = localStorage.getItem('permitiradmins') !== 'false';
      c.apagarcomando = localStorage.getItem('apagarcomando') === 'true';
    } catch (e) {}
    return c;
  }
  // 1) 自动删群：被移出（remove）/ 退出（leaver）
  on('group.participant_changed', function (ev) {
    try {
      var cfg = gtCfg();
      if (!cfg.delRemoved && !cfg.delLeft) return;
      var me = meId();
      if (!me) return;
      var involved = (ev.participants || []).some(function (p) { return sameUser(p, me); });
      if (!involved) return;
      if (ev.action === 'remove' && cfg.delRemoved) { W.chat.delete(ev.groupId).catch(function () {}); }
      else if (ev.action === 'leaver' && cfg.delLeft) { W.chat.delete(ev.groupId).catch(function () {}); }
    } catch (e) {}
  });
  // 2) 新消息：自动删群(gp2) + 自动加群 + 指令
  on('chat.new_message', function (msg) {
    (async function () {
      try {
        var cfg = gtCfg();
        var body = String(msg.body || msg.__x_body || '');
        var chatId = chatOf(msg);
        // 群成员变更通知（gp2）——被移出(remove)/退出(leave)自动删群
        // （group.participant_changed 事件在旧版页面不触发，用 gp2 兜底）
        if (msg.type === 'gp2' && (cfg.delRemoved || cfg.delLeft)) {
          var me2 = meId();
          var sub = msg.subtype || msg.__x_subtype || '';
          var recips = (msg.recipients || msg.__x_recipients || []).map(function (r) { return String(r && (r._serialized || r)); });
          var involved2 = me2 && recips.some(function (r) { return sameUser(r, me2); });
          if (involved2) {
            if (sub === 'remove' && cfg.delRemoved) { W.chat.delete(chatId).catch(function () {}); }
            else if (sub === 'leave' && cfg.delLeft) { W.chat.delete(chatId).catch(function () {}); }
          }
          return;
        }
        if (!body) return;
        // 自动加入群组链接（任意聊天出现链接即加入）
        if (cfg.joinLinks) {
          var m = body.match(/chat\\.whatsapp\\.com\\/([A-Za-z0-9_-]{15,})/);
          if (m) { try { await W.group.join(m[1]); } catch (e) {} }
        }
        // 指令：只处理群聊消息（对齐原版：指令名可自定义，默认 ban/adm/deadm/infog/tagall）
        if (chatId.indexOf('@g.us') === -1) return;
        var t = body.trim();
        var sp = t.split(/\\s+/);
        var first = (sp[0] || '').toLowerCase();
        var cc = cmdCfg();
        function isCmd(name) { return first === name || first === '/' + name; }
        if (!isCmd(cc.cmdban) && !isCmd(cc.cmdadm) && !isCmd(cc.cmddeadm) && !isCmd(cc.cmdinfo) && !isCmd(cc.cmdtagall)) return;
        // 权限：自己发的直接执行；别人发的需 permitiradmins 且为群管理员
        var sender = senderOf(msg);
        var me3 = meId();
        var fromMe = me3 && sameUser(sender, me3);
        var allowed = !!fromMe;
        if (!allowed && cc.permitiradmins !== false) {
          allowed = await isAdminOf(chatId, sender);
        }
        if (!allowed) return;
        // 被回复的消息 → 操作目标
        var targetWid = null;
        try {
          var q = msg.quotedMsg;
          if (!q && msg.quotedMsgId) { q = await W.chat.getMessageById(msg.quotedMsgId); }
          if (q) targetWid = senderOf(q);
        } catch (e) {}
        // ban/adm/deadm：引用消息踢/提升/降级，或 @参数（可多个）
        if (isCmd(cc.cmdban) || isCmd(cc.cmdadm) || isCmd(cc.cmddeadm)) {
          var targets = [];
          if (targetWid) targets.push(targetWid);
          for (var i = 1; i < sp.length; i++) {
            var tok = sp[i];
            if (tok.charAt(0) === '@') targets.push(tok.replace('@', '') + '@c.us');
          }
          if (targets.length) {
            for (var j = 0; j < targets.length; j++) {
              try {
                if (isCmd(cc.cmdban)) await W.group.removeParticipants(chatId, targets[j]);
                else if (isCmd(cc.cmdadm)) await W.group.promoteParticipants(chatId, targets[j]);
                else if (isCmd(cc.cmddeadm)) await W.group.demoteParticipants(chatId, targets[j]);
              } catch (e) {}
            }
          }
        }
        // infog：群信息（只有自己触发）
        else if (isCmd(cc.cmdinfo) && fromMe) {
          try {
            var meta = await W.whatsapp.GroupMetadataStore.find(chatId);
            var gmd = meta && meta.groupMetadata ? meta.groupMetadata : null;
            if (gmd) {
              var info = 'Subject: *' + (gmd.__x_subject || '') + '*\\n\\nDescription: ' + (gmd.__x_desc || '') + '\\n\\nPeople in group: *' + (gmd.__x_size || 0) + '*\\n\\nDate of creation: *' + new Date(1000 * (gmd.__x_creation || 0)).toLocaleString() + '*';
              await sendReply(chatId, info);
            } else {
              // meta 本身就是 model
              var g2 = meta;
              var info2 = 'Subject: *' + (g2.__x_subject || '') + '*\\n\\nDescription: ' + (g2.__x_desc || '') + '\\n\\nPeople in group: *' + (g2.__x_size || 0) + '*\\n\\nDate of creation: *' + new Date(1000 * (g2.__x_creation || 0)).toLocaleString() + '*';
              await sendReply(chatId, info2);
            }
          } catch (e) { await sendReply(chatId, 'infog 失败：' + e.message); }
        }
        // tagall：@全体成员（只有自己触发；原版隐藏字符技巧）
        else if (isCmd(cc.cmdtagall) && fromMe) {
          try {
            var parts = await W.group.getParticipants(chatId);
            var ids = [], names = [];
            for (var k = 0; k < parts.length; k++) {
              var pid = widStr(parts[k].id);
              if (!sameUser(pid, me3)) {
                ids.push(pid);
                names.push('@' + pid.split('@')[0]);
              }
            }
            var tagText = sp.slice(1).join(' ');
            var hide = String.fromCharCode(8206).repeat(4001);
            var text = (tagText || '@全体成员') + '\\n' + hide + '\\n\\n' + names.join(' ');
            await W.chat.sendTextMessage(chatId, text, { mentionedList: ids });
          } catch (e) { await sendReply(chatId, 'tagall 失败：' + e.message); }
        }
        // 删除指令消息（apagarcomando——管理员可撤回）
        if (cc.apagarcomando) {
          try { await W.chat.deleteMessage(chatId, msg.id, false, true); } catch (e) {}
        }
      } catch (e) {}
    })();
  });
  return 'OK';
})()`;
  // 运维/调试：暴露脚本源，允许外部强制重注入（页面未重载时代码升级后使用）
  window.__GT_AGENT_SOURCE = GT_AGENT_SOURCE;
  window.__gtReinjectAll = function () {
    document.querySelectorAll('webview').forEach((wv) => {
      try { if (wv.getURL().includes('1843')) injectGtAgent(wv, accounts.find(a => wvMap.get(a.id) === wv)); } catch (e) {}
    });
  };

  // ---------- DOM ----------
  const accountsEl = document.getElementById('nav-accounts');
  const tabsEl = document.getElementById('account-tabs');
  const wvContainer = document.getElementById('webview-container');
  const emptyState = document.getElementById('empty-state');
  const addBtn = document.getElementById('btn-app-center');
  const addOverlay = document.getElementById('add-overlay');
  const addPlatformsEl = document.getElementById('add-platforms');
  const addNameEl = document.getElementById('add-name');
  const addCountEl = document.getElementById('add-count');
  const settingsOverlay = document.getElementById('settings-overlay');
  const settingsGlobal = document.getElementById('settings-global');
  const settingsAccount = document.getElementById('settings-account');
  const settingsTabs = document.querySelectorAll('.settings-tab');
  const accSelect = document.getElementById('acc-select');

  let accounts = [];
  let activeId = null;
  let activePlatform = null; // 当前平台家族 key（whatsapp/telegram/line）
  let config = null;
  let platforms = [];
  let addSelectedType = null;
  const lastAccountByPlatform = {}; // 记住每个平台最后激活的账号
  const unreadPlatforms = new Set(); // 有未读消息的平台（闪烁状态持久，重绘不丢）
  const unreadByAccount = {}; // accountId -> 未读数（红点显示用）
  const wvMap = new Map(); // accountId -> webview element

  // 平台家族（顶部一个图标 = 一个家族；左侧列表 = 当前家族全部账号）
  const PLATFORM_FAMILIES = [
    { key: 'whatsapp', label: 'WhatsApp', iconType: 'whatsapp', iconClass: 'p-icon-whatsapp', types: ['whatsapp', 'whatsapp-pure'] },
    { key: 'telegram', label: 'Telegram', iconType: 'telegram-z', iconClass: 'p-icon-telegram-z', types: ['telegram-z', 'telegram-k'] },
    { key: 'line', label: 'Line', iconType: 'line', iconClass: 'p-icon-line', types: ['line', 'line-business'] }
  ];
  function familyOf(type) {
    return PLATFORM_FAMILIES.find(f => f.types.includes(type)) || PLATFORM_FAMILIES[0];
  }

  // ---------- 平台品牌图标（simple-icons，内联 SVG path） ----------
  const ICON_PATHS = {
    whatsapp: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z',
    telegram: 'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z',
    line: 'M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314'
  };

  // 平台 → 图标/品牌色 class 映射
  function platformIconClass(type) {
    if (type === 'whatsapp') return 'p-icon-whatsapp';
    if (type === 'whatsapp-pure') return 'p-icon-whatsapp-pure';
    if (type === 'telegram-z' || type === 'telegram-k') return 'p-icon-telegram-z';
    if (type === 'line') return 'p-icon-line';
    if (type === 'line-business') return 'p-icon-line-business';
    return 'p-icon-whatsapp';
  }
  function platformIconPath(type) {
    if (type === 'line' || type === 'line-business') return ICON_PATHS.line;
    if (type === 'telegram-z' || type === 'telegram-k') return ICON_PATHS.telegram;
    return ICON_PATHS.whatsapp;
  }
  function iconSvg(type, cls) {
    return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="${platformIconPath(type)}"/></svg>`;
  }

  // 平台下拉（对齐原版：WA=普通+纯净版 / TG=新版Z / LINE=普通+商业版）
  const PLATFORM_GROUPS = [
    { label: 'WhatsApp', types: ['whatsapp', 'whatsapp-pure'] },
    { label: 'Telegram', types: ['telegram-z'] },
    { label: 'Line', types: ['line', 'line-business'] }
  ];

  async function loadPlatforms() {
    platforms = (await window.api.platforms.list()) || [];
  }

  // ---------- 渲染左侧账号列表（只显示当前平台的账号） ----------
  function renderSidebar() {
    accountsEl.innerHTML = '';
    const list = accounts.filter(a => familyOf(a.type).key === activePlatform);
    // 账号少 → 侧栏自动收窄（动态缩减）
    const sideNav = document.getElementById('side-nav');
    if (sideNav) sideNav.classList.toggle('compact', list.length <= 2);
    if (!list.length) {
      accountsEl.innerHTML = '<div class="nav-empty">这个平台还没有账号</div>';
      return;
    }
    list.forEach((a, index) => {
      const item = document.createElement('div');
      item.className = 'nav-account' + (a.id === activeId ? ' active' : '');
      item.dataset.id = a.id;
      item.draggable = true; // 拖拽排序
      item.innerHTML = `
        <div class="nav-account-main">
          <span class="p-icon ${platformIconClass(a.type)}">${iconSvg(a.type)}</span>
          <span class="acc-dot">${unreadByAccount[a.id] || 0}</span>
          <span class="nav-account-name" style="font-size:${a.fontSize || 16}px;color:${a.fontColor || '#18A058'}">${escapeHtml(a.name)}</span>
        </div>`;
      // 红点初始显示状态
      const dotEl = item.querySelector('.acc-dot');
      if (dotEl) {
        const n = unreadByAccount[a.id] || 0;
        dotEl.style.display = n > 0 ? 'flex' : 'none';
        dotEl.textContent = n > 99 ? '99+' : String(n);
      }
      item.querySelector('.nav-account-main').onclick = () => switchAccount(a.id);
      // 拖拽排序（HTML5 DnD）
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', a.id);
        e.dataTransfer.effectAllowed = 'move';
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        accountsEl.querySelectorAll('.nav-account').forEach(el => el.classList.remove('drop-target'));
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const fromId = e.dataTransfer.getData('text/plain');
        if (fromId && fromId !== a.id) {
          accountsEl.querySelectorAll('.nav-account').forEach(el => el.classList.remove('drop-target'));
          item.classList.add('drop-target');
        }
      });
      item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
      item.addEventListener('drop', async (e) => {
        e.preventDefault();
        const fromId = e.dataTransfer.getData('text/plain');
        item.classList.remove('drop-target');
        if (!fromId || fromId === a.id) return;
        try {
          const fromIndex = accounts.findIndex(x => x.id === fromId);
          const toIndex = accounts.findIndex(x => x.id === a.id);
          if (fromIndex === -1 || toIndex === -1) return;
          await window.api.accounts.moveTo(fromId, toIndex);
          const r = await window.api.accounts.list();
          accounts = r?.accounts || r || [];
          renderSidebar();
          renderTabs();
        } catch (err) {
          alert('拖拽排序失败: ' + err.message);
        }
      });
      // 右键菜单（刷新/编辑/关闭）
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, a);
      });
      accountsEl.appendChild(item);
    });
  }

  // ---------- 渲染顶栏平台图标（每个平台一个纯图标，有未读消息时闪烁） ----------
  function renderTabs() {
    tabsEl.innerHTML = '';
    const families = PLATFORM_FAMILIES.filter(f =>
      accounts.some(a => familyOf(a.type).key === f.key)
    );
    if (!families.length) {
      tabsEl.innerHTML = '<span class="nav-empty" style="padding:0;font-size:12px">还没有账号，点 + 添加</span>';
      return;
    }
    families.forEach((f) => {
      const tab = document.createElement('div');
      tab.className = 'tab-item' + (f.key === activePlatform ? ' active' : '') + (unreadPlatforms.has(f.key) ? ' flash' : '');
      tab.dataset.platform = f.key;
      tab.title = f.label;
      tab.innerHTML = `
        <span class="p-icon ${f.iconClass}">${iconSvg(f.iconType)}</span>
        <span class="tab-dot"></span>`;
      tab.onclick = () => switchPlatform(f.key);
      tabsEl.appendChild(tab);
    });
  }

  // ---------- 未读管理：红点 + 闪烁 + 通知 ----------
  // 搞怪提示音轮换播放（主人 来消息了 / 主人 发财了…）
  let soundIdx = 0;
  function playMessageSound() {
    try {
      const n = (soundIdx % 4) + 1;
      soundIdx++;
      const audio = new Audio(`../resources/sounds/message-${n}.mp3`);
      audio.volume = 0.9;
      audio.play().catch(() => {});
    } catch (e) { /* 播放失败不影响 */ }
  }
  // 平台图标闪烁（有未读消息）——状态持久化到 unreadPlatforms，重绘不丢
  function setPlatformFlash(platformKey, on) {
    if (on) unreadPlatforms.add(platformKey);
    else unreadPlatforms.delete(platformKey);
    const tab = [...tabsEl.querySelectorAll('.tab-item')].find(t => t.dataset.platform === platformKey);
    if (tab) tab.classList.toggle('flash', on);
  }
  function clearPlatformFlash(platformKey) {
    setPlatformFlash(platformKey, false);
  }
  function platformUnreadTotal(key) {
    return accounts
      .filter(a => familyOf(a.type).key === key)
      .reduce((sum, a) => sum + (unreadByAccount[a.id] || 0), 0);
  }
  // 更新某账号未读数；count 增加时触发桌面通知
  function updateUnread(accountId, count) {
    const prev = unreadByAccount[accountId] || 0;
    if (prev === count) return;
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;
    unreadByAccount[accountId] = count;
    const fam = familyOf(account.type).key;
    // 顶部平台红点 + 闪烁
    setPlatformFlash(fam, count > 0);
    const tab = [...tabsEl.querySelectorAll('.tab-item')].find(t => t.dataset.platform === fam);
    if (tab) {
      const dot = tab.querySelector('.tab-dot');
      if (dot) dot.style.display = (platformUnreadTotal(fam) > 0) ? 'flex' : 'none';
    }
    // 左侧账号红点
    const item = accountsEl.querySelector(`.nav-account[data-id="${accountId}"] .acc-dot`);
    if (item) {
      item.style.display = count > 0 ? 'flex' : 'none';
      item.textContent = count > 99 ? '99+' : String(count);
    }
    // 新未读（0 → N）→ 桌面通知 + 提示音
    if (count > 0 && count > prev) {
      try {
        window.api.notify.show({ title: account.name || fam, body: `${fam.toUpperCase()} 收到 ${count} 条新消息` });
      } catch (e) { /* ignore */ }
      // 消息提示音（设置开关控制）
      try {
        if (!config || config.messageSound !== false) playMessageSound();
      } catch (e) { /* ignore */ }
    }
  }
  function clearUnread(accountId) {
    updateUnread(accountId, 0);
  }

  // ---------- 切换平台（点顶部图标） ----------
  async function switchPlatform(key) {
    activePlatform = key;
    clearPlatformFlash(key); // 查看该平台 → 停止闪烁
    const list = accounts.filter(a => familyOf(a.type).key === key);
    if (!list.length) return;
    const remembered = lastAccountByPlatform[key];
    const target = (remembered && list.some(a => a.id === remembered)) ? remembered : list[0].id;
    renderTabs();
    renderSidebar();
    await switchAccount(target);
  }

  // ---------- WebView 尺寸 ----------
  function resizeWebviews() {
    const rect = wvContainer.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    wvMap.forEach((wv) => {
      wv.style.width = `${width}px`;
      wv.style.height = `${height}px`;
      wv.setAttribute('width', String(width));
      wv.setAttribute('height', String(height));
    });
  }

  // ---------- WebView 创建 ----------
  function getWebview(account) {
    if (wvMap.has(account.id)) return wvMap.get(account.id);
    const wv = document.createElement('webview');
    wv.src = account.url || 'https://web.whatsapp.com/';
    wv.partition = account.partition;
    if (account.userAgent) {
      wv.setAttribute('useragent', account.userAgent);
    }
    wv.setAttribute('allowpopups', '');
    // 对齐原版：webview 强制白色背景（LINE 二维码扫码需要浅色背景，外壳深色不影响）
    wv.style.backgroundColor = 'rgb(255, 255, 255)';
    window.__wvLog = window.__wvLog || [];
    ['dom-ready', 'did-finish-load', 'did-fail-load', 'did-start-loading', 'did-stop-loading'].forEach((evt) => {
      wv.addEventListener(evt, (e) => {
        let detail = '';
        if (evt === 'did-fail-load') {
          detail = ` code=${e.errorCode} desc=${e.errorDescription} url=${e.validatedURL}`;
        }
        window.__wvLog.push(`${evt}${detail}`);
        try { window.__wvLog.push(`url=${wv.getURL && wv.getURL()}`); } catch (err) {}
      });
    });
    wv.addEventListener('dom-ready', () => {
      resizeWebviews();
      setTimeout(resizeWebviews, 100);
    });
    // 未读消息检测：页面 title 带未读数（如 "（2）WhatsApp"）→ 红点+闪烁+通知
    wv.addEventListener('page-title-updated', (e) => {
      const title = (e.title || '').trim();
      const m = title.match(/^[(\[（]\s*(\d+)\s*[)\]\）]/);
      updateUnread(account.id, m ? parseInt(m[1], 10) : 0);
    });
    wvContainer.appendChild(wv);
    wv.addEventListener('dom-ready', () => {
      if (lineReadyPartitions.has(account.partition)) {
        lineReadyPartitions.delete(account.partition);
        try { wv.reloadIgnoringCache(); } catch (e) { /* ignore */ }
      }
    });
    wvMap.set(account.id, wv);
    resizeWebviews();
    // 群组工具监听器：WA 页面就绪后注入（幂等；页面重载后自动重新注入）
    if (account.type === 'whatsapp' || account.type === 'whatsapp-pure') {
      wv.addEventListener('dom-ready', () => injectGtAgent(wv, account));
    }
    return wv;
  }

  // ---------- 群组工具监听器注入 ----------
  // 把 GT_AGENT_SOURCE 注入 WA webview；WPP 未就绪时重试（最多 ~10 次）
  function injectGtAgent(wv, account) {
    if (!wv || wv.isDestroyed?.()) return;
    wv.executeJavaScript(`(${GT_AGENT_SOURCE})`).then((r) => {
      const txt = String(r || '');
      if (txt === 'NO_WPP') {
        // WPP 还没就绪——等 3 秒重试（监听器安装标记未置位，可重复注入）
        setTimeout(() => { try { injectGtAgent(wv, account); } catch (e) {} }, 3000);
      }
    }).catch(() => {});
  }
  // 把群组工具配置同步到 webview 域 localStorage（webview 与外壳 localStorage 不互通）
  function syncGtCfgToWebview(wv) {
    if (!wv) return;
    const auto = JSON.parse(localStorage.getItem('gtAutoCfg') || '{}');
    const cmd = JSON.parse(localStorage.getItem('gtCmdCfg') || '{}');
    const cfg = Object.assign({}, auto, cmd);
    const cmdNames = JSON.parse(localStorage.getItem('gtCmdNames') || '{}');
    wv.executeJavaScript(`(() => {
      try {
        window.__gtSetCfg ? window.__gtSetCfg(${JSON.stringify(cfg)}) : localStorage.setItem('__gtAutoCfg', ${JSON.stringify(JSON.stringify(cfg))});
        // 指令名/权限（原版键：comandoban/comandoadm/comandodeadm/comandoinfo/comandotagall/permitiradmins/apagarcomando）
        const names = ${JSON.stringify(cmdNames)};
        if (names.cmdban) localStorage.setItem('comandoban', names.cmdban);
        if (names.cmdadm) localStorage.setItem('comandoadm', names.cmdadm);
        if (names.cmddeadm) localStorage.setItem('comandodeadm', names.cmddeadm);
        if (names.cmdinfo) localStorage.setItem('comandoinfo', names.cmdinfo);
        if (names.cmdtagall) localStorage.setItem('comandotagall', names.cmdtagall);
        localStorage.setItem('permitiradmins', String(cfg.adminOnly !== false));
        localStorage.setItem('apagarcomando', String(!!cfg.delMsg));
        return 'OK';
      } catch (e) { return 'ERR:' + e.message; }
    })()`).catch(() => {});
  }

  // ---------- 切换账号 ----------
  async function switchAccount(id) {
    const account = accounts.find(a => a.id === id);
    if (!account) return;
    activeId = id;
    activePlatform = familyOf(account.type).key;
    lastAccountByPlatform[activePlatform] = id;
    clearUnread(id); // 查看该账号 → 清未读（红点/闪烁/通知）
    // 持久化当前账号（防止重启/重载时 activeAccountId 过期导致切错账号）
    window.api.accounts.switch(id).catch(() => {});
    wvMap.forEach(wv => wv.classList.remove('active'));
    const wv = getWebview(account);
    wv.classList.add('active');
    resizeWebviews();
    setTimeout(resizeWebviews, 50);
    emptyState.style.display = 'none';
    renderSidebar();
    renderTabs();
  }

  // ---------- 删除账号 ----------
  async function removeAccount(id) {
    if (!confirm('删除账号将清除该账号的登录数据，确定？')) return;
    const removed = accounts.find(a => a.id === id);
    const wv = wvMap.get(id);
    if (wv) { wv.remove(); wvMap.delete(id); }
    accounts = accounts.filter(a => a.id !== id);
    await window.api.accounts.remove(id);
    if (removed && lastAccountByPlatform[familyOf(removed.type).key] === id) {
      delete lastAccountByPlatform[familyOf(removed.type).key];
    }
    if (activeId === id) {
      // 当前平台还有账号 → 切到当前平台最后一个；否则切到下一个有账号的平台
      const curList = accounts.filter(a => familyOf(a.type).key === activePlatform);
      if (curList.length) {
        activeId = curList[curList.length - 1].id;
        await switchAccount(activeId);
      } else {
        const next = PLATFORM_FAMILIES.find(f => f.key !== activePlatform &&
          accounts.some(a => familyOf(a.type).key === f.key));
        if (next) {
          await switchPlatform(next.key);
        } else {
          activeId = null;
          activePlatform = null;
          emptyState.style.display = 'flex';
        }
      }
    }
    renderSidebar();
    renderTabs();
  }

  // ---------- 右键菜单（对齐原版：刷新应用/编辑应用/删除应用） ----------
  const ctxMenu = document.getElementById('ctx-menu');
  function showContextMenu(x, y, account) {
    ctxMenu.innerHTML = `
      <div class="ctx-item" data-act="refresh">刷新应用</div>
      <div class="ctx-item" data-act="edit">编辑应用</div>
      <div class="ctx-item" data-act="proxy">代理设置</div>
      <div class="ctx-item ctx-danger" data-act="delete">删除应用</div>`;
    const mw = 150, mh = 132;
    ctxMenu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px';
    ctxMenu.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px';
    ctxMenu.dataset.accountId = account.id;
    ctxMenu.classList.remove('hidden');
  }
  function hideContextMenu() { ctxMenu.classList.add('hidden'); }

  ctxMenu.addEventListener('click', async (e) => {
    const item = e.target.closest('.ctx-item');
    if (!item) return;
    const act = item.dataset.act;
    const accountId = ctxMenu.dataset.accountId;
    hideContextMenu();
    if (!accountId) return;
    if (act === 'refresh') {
      // 原版 refreshApp：重新加载应用列表 + 重载页面
      const wv = wvMap.get(accountId);
      if (wv) wv.reloadIgnoringCache();
      try {
        const r = await window.api.accounts.list();
        accounts = r?.accounts || r || [];
        renderSidebar();
        renderTabs();
      } catch (err) { /* 列表刷新失败不影响页面刷新 */ }
    } else if (act === 'edit') {
      editAccount(accountId);
    } else if (act === 'proxy') {
      const account = accounts.find(a => a.id === accountId);
      if (account) showProxyDialog(account);
    } else if (act === 'delete') {
      removeAccount(accountId);
    }
  });
  document.addEventListener('click', hideContextMenu);
  window.addEventListener('blur', hideContextMenu);

  // ---------- 独立代理IP 弹窗（原版 Proxy IP） ----------
  const proxyOverlay = document.getElementById('proxy-overlay');
  let proxyAccountId = null;
  function showProxyDialog(account) {
    proxyAccountId = account.id;
    document.getElementById('proxy-openProxy').checked = !!account.openProxy;
    document.getElementById('proxy-protocal').value = account.protocal || 'http';
    document.getElementById('proxy-host').value = account.host || '';
    document.getElementById('proxy-port').value = account.port || '';
    document.getElementById('proxy-user').value = account.huser || '';
    document.getElementById('proxy-pwd').value = account.hpwd || '';
    proxyOverlay.classList.remove('hidden');
  }
  function closeProxyDialog() { proxyOverlay.classList.add('hidden'); }
  document.getElementById('proxy-close').onclick = closeProxyDialog;
  document.getElementById('proxy-cancel').onclick = closeProxyDialog;
  proxyOverlay.onclick = (e) => { if (e.target === proxyOverlay) closeProxyDialog(); };
  document.getElementById('proxy-save').onclick = async () => {
    if (!proxyAccountId) return;
    try {
      await window.api.accounts.update(proxyAccountId, {
        openProxy: document.getElementById('proxy-openProxy').checked,
        protocal: document.getElementById('proxy-protocal').value,
        host: document.getElementById('proxy-host').value.trim(),
        port: document.getElementById('proxy-port').value.trim(),
        huser: document.getElementById('proxy-user').value.trim(),
        hpwd: document.getElementById('proxy-pwd').value
      });
      closeProxyDialog();
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  };

  // 编辑应用：打开设置 → 账号设置 tab → 选中该账号
  function editAccount(id) {
    const accountTab = [...settingsTabs].find(t => t.dataset.tab === 'account');
    if (accountTab) {
      settingsTabs.forEach(t => t.classList.remove('active'));
      accountTab.classList.add('active');
      settingsGlobal.classList.add('hidden');
      settingsAccount.classList.remove('hidden');
    }
    accSelect.value = id;
    loadAccountSettingsForm();
    openSettings();
  }

  // ---------- 排序 ----------
  async function moveAccount(id, direction) {
    try {
      await window.api.accounts.move(id, direction);
      // 只刷新列表，不切换账号（防止存储的旧 activeAccountId 把当前账号切走）
      const r = await window.api.accounts.list();
      accounts = r?.accounts || r || [];
      renderSidebar();
      renderTabs();
    } catch (e) {
      alert('排序失败: ' + e.message);
    }
  }

  // ---------- 添加账号弹窗 ----------
  function openAddDialog(preselectType) {
    addSelectedType = null;
    addNameEl.value = '';
    addCountEl.value = '1';
    addPlatformsEl.innerHTML = '';
    platforms.forEach((p) => {
      if (p.type === 'website') return;
      const card = document.createElement('div');
      card.className = 'add-platform-card' + (p.type === preselectType ? ' selected' : '');
      card.dataset.type = p.type;
      card.innerHTML = `
        <span class="p-icon p-icon-lg ${platformIconClass(p.type)}">${iconSvg(p.type)}</span>
        <span class="add-platform-label">${escapeHtml(p.name)}</span>`;
      card.onclick = () => {
        addPlatformsEl.querySelectorAll('.add-platform-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        addSelectedType = p.type;
      };
      addPlatformsEl.appendChild(card);
    });
    if (preselectType) addSelectedType = preselectType;
    addOverlay.classList.remove('hidden');
    setTimeout(() => addNameEl.focus(), 50);
  }
  function closeAddDialog() {
    addOverlay.classList.add('hidden');
  }

  document.getElementById('add-close').onclick = closeAddDialog;
  document.getElementById('add-cancel').onclick = closeAddDialog;
  addOverlay.onclick = (e) => {
    if (e.target === addOverlay) closeAddDialog();
  };
  document.getElementById('add-confirm').onclick = async () => {
    const type = addSelectedType;
    if (!type) { alert('请先选择一个平台'); return; }
    const platform = platforms.find(p => p.type === type);
    const label = platform ? platform.name : type;
    const count = Math.max(1, Math.min(10, parseInt(addCountEl.value, 10) || 1));
    let baseName = (addNameEl.value || '').trim();
    try {
      for (let i = 0; i < count; i++) {
        const existing = accounts.filter(a => a.type === type).length;
        const name = baseName
          ? (count > 1 ? `${baseName} ${i + 1}` : baseName)
          : `${label} ${existing + 1}`;
        const r = await window.api.accounts.add({ name: name.trim(), type, customUrl: '' });
        await loadAccounts();
        if (i === 0 && r && r.account) activeId = r.account.id;
      }
      closeAddDialog();
      if (activeId) switchAccount(activeId);
    } catch (e) {
      alert('添加失败: ' + e.message);
    }
  };

  addBtn.onclick = () => openAddDialog();

  // ---------- 侧栏折叠 ----------
  const sideNav = document.getElementById('side-nav');
  document.getElementById('btn-collapse').onclick = () => {
    sideNav.classList.toggle('collapsed');
  };

  // ---------- 顶部操作栏 ----------
  document.getElementById('btn-app-center').onclick = () => openAddDialog();
  document.getElementById('btn-restart').onclick = async () => {
    if (confirm('确定重启应用？')) {
      try { await window.api.window.relaunch(); } catch (e) { alert(e.message); }
    }
  };
  document.getElementById('btn-lock').onclick = lockScreen;
  document.getElementById('btn-settings').onclick = openSettings;
  // 托盘菜单"锁屏" → 触发渲染层锁屏
  try {
    window.api.tray.onLock(() => lockScreen());
  } catch (e) { /* ignore */ }

  // ---------- 群发消息（多平台） ----------
  // 平台适配器：读取聊天列表 / 切换聊天 / 输入消息 / 发送（webview DOM 操作）
  const BROADCAST_ADAPTERS = {
    'telegram-z': {
      getChats: `(() => {
        const out = [];
        document.querySelectorAll('.chat-item-clickable').forEach(row => {
          const a = row.querySelector('a');
          if (!a) return;
          const t = row.querySelector('[class*="title"], .peer-title');
          out.push({
            id: (a.getAttribute('href') || '').replace('#', ''),
            name: (t ? t.textContent : '').trim(),
            type: (row.className || '').includes('group') ? '群组' : '联系人'
          });
        });
        return JSON.stringify(out);
      })()`,
      switchChat: (id) => `(() => {
        const a = document.querySelector('.chat-item-clickable a[href="#${id}"]');
        if (!a) return false;
        // React 应用需要完整指针事件序列（普通 click() 无效）
        const fire = (type, opts) => a.dispatchEvent(new PointerEvent(type, Object.assign({bubbles: true, cancelable: true, view: window, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1}, opts)));
        fire('pointerdown');
        a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
        fire('pointerup', { buttons: 0 });
        a.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 0 }));
        a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, button: 0 }));
        return true;
      })()`,
      setMessage: (msg) => `(async () => {
        // 轮询等 ProseMirror 编辑器就绪（聊天刚打开可能未初始化，大群加载慢）
        let ed = null;
        for (let i = 0; i < 60; i++) {
          ed = document.querySelector('.form-control.ProseMirror') || document.querySelector('[contenteditable="true"]');
          if (ed && ed.textContent !== undefined) break;
          await new Promise(r => setTimeout(r, 250));
        }
        if (!ed) return 'NO_EDITOR';
        // 等编辑器真正可编辑（ProseMirror 初始化完成）
        for (let i = 0; i < 20; i++) {
          ed.focus();
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(ed);
          sel.removeAllRanges();
          sel.addRange(range);
          const ok = document.execCommand('insertText', false, ${JSON.stringify(msg)});
          await new Promise(r => setTimeout(r, 200));
          if ((ed.textContent || '').includes(${JSON.stringify(msg)})) return 'OK';
        }
        return 'EMPTY';
      })()`,
      send: (msg) => `(async () => {
        const modal = document.querySelector('.modal-dialog, .modal-container');
        if (modal) {
          // 文件发送确认弹窗：文字输入到 caption，再点 Send
          const caption = modal.querySelector('[contenteditable="true"], .form-control, textarea, input[type="text"]');
          const m = ${JSON.stringify(msg)};
          if (caption && m) {
            caption.focus();
            document.execCommand('insertText', false, m);
            await new Promise(r => setTimeout(r, 300));
          }
          const modalBtn = [...modal.querySelectorAll('button')].find(b => /primary/.test((b.className || '').toString()));
          if (modalBtn) {
            const fire = (type, opts) => modalBtn.dispatchEvent(new PointerEvent(type, Object.assign({bubbles: true, cancelable: true, view: window, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1}, opts)));
            fire('pointerdown');
            modalBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 }));
            fire('pointerup', { buttons: 0 });
            modalBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0, buttons: 0 }));
            modalBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, button: 0 }));
            return 'CLICKED';
          }
          return 'NO_MODAL_BTN';
        }
        // 普通发送按钮（纯文字）——轮询等按钮就绪（TG 可能延迟出现/短暂禁用）
        let btn = null;
        for (let i = 0; i < 24; i++) {
          btn = document.querySelector('button[class*="send"], button[class*="Send"], button[aria-label*="Send"], .btn-send, button[class*="primary"], .Button.primary');
          if (btn && !btn.disabled) break;
          await new Promise(r => setTimeout(r, 250));
        }
        if (btn) {
          btn.click();
          return 'CLICKED';
        }
        // 无按钮：Enter 发送文字
        const ed = document.querySelector('.form-control.ProseMirror') || document.querySelector('[contenteditable="true"]');
        if (!ed) return 'NO_EDITOR';
        ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        ed.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        // 等编辑器清空（= 发送成功），最长 15 秒
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 250));
          if (!(ed.textContent || '').trim()) return 'SENT';
        }
        return 'MAYBE';
      })()`,
    },
    whatsapp: {
      // WPP 直发模式（对齐原版/HelloWorld：内部 API，不走 UI 模拟）
      // window.WPP（wppconnect 官方）+ window.WAPLUS_WPP（HelloWorld fork——sendFileMessage 可用）
      getChats: `(async () => {
        try {
          const W = window.WAPLUS_WPP || window.WPP;
          const chats = await W.chat.list();
          const arr = Array.isArray(chats) ? chats : (chats ? Object.values(chats) : []);
          const out = arr.map(c => ({
            id: String(c.id),
            name: (c.name || c.formattedTitle || String(c.id)).trim(),
            realName: (!c.isGroup && c.contact ? (c.contact.pushname || c.contact.name || c.contact.shortName || '') : ''),
            type: c.isGroup ? '群组' : '联系人'
          })).filter(c => c.id.includes('@'));
          return JSON.stringify(out);
        } catch (e) { return 'ERR:' + e.message; }
      })()`,
      sendDirect: (chatId, msg, tagall) => `(async () => {
        try {
          const W = window.WAPLUS_WPP || window.WPP;
          const extra = {};
          if (${!!tagall}) {
            try {
              const chat = W.whatsapp.ChatStore.get(${JSON.stringify(chatId)});
              if (chat && chat.isGroup && chat.participants) {
                extra.mentionedList = chat.participants.map(p => p.id);
              }
            } catch (e) { /* 拿不到成员则普通发送 */ }
          }
          const r = await Promise.race([
            W.chat.sendTextMessage(${JSON.stringify(chatId)}, ${JSON.stringify(msg)}, extra),
            new Promise(res => setTimeout(() => res({ id: 'submitted' }), 8000))
          ]);
          return r && r.id ? 'SENT' : 'FAIL';
        } catch (e) { return 'ERR:' + e.message; }
      })()`,
      // 电子名片：使用 WPP 4.3 官方 API，避免旧内部 SendAction 返回 Promise 但消息不落地
      sendVcards: (chatId, vcards) => `(async () => {
        try {
          const W = window.WAPLUS_WPP || window.WPP;
          if (!W.chat || typeof W.chat.sendVCardContactMessage !== 'function') return 'ERR:当前 WPP 不支持电子名片发送';
          const contacts = ${JSON.stringify(vcards)}.map(v => ({ id: String(v.id), name: String(v.name || v.realName || v.id) }));
          const result = await Promise.race([
            W.chat.sendVCardContactMessage(${JSON.stringify(chatId)}, contacts),
            new Promise((_, reject) => setTimeout(() => reject(new Error('名片发送超时，无回执')), 8000))
          ]);
          return result && (result.id || result.messageId) ? 'SENT' : 'FAIL:名片发送无消息回执';
        } catch (e) { return 'ERR:' + e.message; }
      })()`,
      // WA 文件+文字一起（底层 API——HelloWorld 同款：ChatStore.get 模型 + prepRawMedia + sendMediaMsgToChat，秒发）
      sendFileDirect: (chatId, file, caption) => `(async () => {
        try {
          const W = window.require;
          const wpp = window.WAPLUS_WPP || window.WPP;
          const chatModel = wpp.whatsapp.ChatStore.get(${JSON.stringify(chatId)});
          if (!chatModel) return 'NO_CHAT';
          const bytes = Uint8Array.from(atob('${file.base64}'), c => c.charCodeAt(0));
          const f = new File([bytes], ${JSON.stringify(file.name || 'file')}, { type: ${JSON.stringify(file.mime || 'application/octet-stream')} });
          const mediaData = W('WAWebMediaOpaqueData').createFromData(f, f.type);
          const mime = ${JSON.stringify(file.mime || '')};
          const type = mime.startsWith('image') ? 'image' : mime.startsWith('video') ? 'video' : mime.startsWith('audio') ? 'audio' : 'document';
          const prepOptions = { isPtt: false, asDocument: type === 'document', asGif: false, isAudio: type === 'audio', asSticker: type === 'sticker', precomputedFields: { duration: null, waveform: null } };
          const preparedMedia = W('WAWebMedia').prepRawMedia(mediaData, prepOptions);
          await preparedMedia.waitForPrep();
          const result = await W('WAWebMediaPrep').sendMediaMsgToChat({
            chat: chatModel,
            options: { addEvenWhilePreparing: false, caption: ${JSON.stringify(caption)}, type },
            prep: preparedMedia,
            earlyUpload: null,
          });
          return result ? 'SENT' : 'FAIL';
        } catch (e) { return 'ERR:' + e.message; }
      })()`,
    },
    line: {
      getChats: `(() => {
        const out = [];
        document.querySelectorAll('[class*="mdMN02Item"]').forEach(el => {
          const t = el.querySelector('[class*="mdMN02Thumb"], [class*="Title"], [class*="title"]');
          out.push({ id: el.getAttribute('data-id') || '', name: (t ? t.textContent : el.textContent).trim().slice(0, 40) });
        });
        return JSON.stringify(out);
      })()`,
      switchChat: (id) => `(() => {
        const el = document.querySelector('[data-id="${id}"]');
        if (el) { el.click(); return true; }
        return false;
      })()`,
      setMessage: (msg) => `(() => {
        const ed = document.querySelector('[class*="mdCMN09Input"], [contenteditable="true"], textarea');
        if (!ed) return false;
        ed.focus();
        document.execCommand('insertText', false, ${JSON.stringify(msg)});
        return true;
      })()`,
      send: `(() => {
        const ed = document.querySelector('[class*="mdCMN09Input"], [contenteditable="true"], textarea');
        if (!ed) return false;
        ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        return true;
      })()`,
    },
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let broadcastChats = [];      // 全部聊天
  let broadcastSelected = new Set(); // 勾选 id
  let broadcastFiles = [];      // 附件 [{name, base64, mime}]
  let broadcastRunning = false;
  let broadcastStop = false;
  let broadcastPaused = false;
  let broadcastFailed = [];     // 失败名单 [{name, reason}]

  const bOverlay = document.getElementById('broadcast-overlay');
  const bListEl = document.getElementById('broadcast-list');
  const bSearchEl = document.getElementById('broadcast-search');
  const bMessageEl = document.getElementById('broadcast-message');
  const bMetaEl = document.getElementById('broadcast-meta');
  const bProgressEl = document.getElementById('broadcast-progress');
  const bcSelectize = document.getElementById('bc-selectize');
  const bcSelectizeControl = document.getElementById('bc-selectize-control');
  const bcSelectizeDropdown = document.getElementById('bc-selectize-dropdown');
  const bcSelectedChips = document.getElementById('bc-selected-chips');

  function openBroadcast() {
    // 没激活账号时自动激活第一个（体验改进）
    if (!accounts.find(a => a.id === activeId) && accounts.length) {
      switchAccount(accounts[0].id);
    }
    // 定时时间默认今天 + 当前（用户只改时间，不用填年月）
    const schedTimeEl = document.getElementById('broadcast-schedule-time');
    if (schedTimeEl && !schedTimeEl.value) {
      const now = new Date();
      now.setMinutes(now.getMinutes() + 30); // 默认半小时后
      const pad = n => String(n).padStart(2, '0');
      schedTimeEl.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }
    const account = accounts.find(a => a.id === activeId);
    if (!account) { alert('请先切换到一个账号'); return; }
    broadcastChats = [];
    broadcastSelected = new Set();
    broadcastSavedFilter = null;
    broadcastFiles = [];
    bSearchEl.value = '';
    bMessageEl.value = '';
    renderBroadcastFiles();
    bProgressEl.classList.add('hidden');
    bOverlay.classList.remove('hidden');
    renderSavedGroups();
    const savedTagSel = document.getElementById('broadcast-saved-groups');
    if (savedTagSel) savedTagSel.value = '';
    renderBroadcastList();
    loadBroadcastChats().then(() => armScheduleTasks());
  }
  // 附件：选择文件 + 列表（新界面用开关 change 触发——见下方群发绑定；此处移除避免重复弹窗）
  // CSV 导入联系人（每行：聊天名称或 ID，自动匹配勾选）
  document.getElementById('broadcast-import-csv').onclick = async () => {
    try {
      const f = await window.api.file.pickCsv();
      if (!f) return;
      const lines = f.content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      let names = lines;
      if (lines.length > 1 && /^(name|名称|姓名|联系人|id|聊天)/i.test(lines[0])) names = lines.slice(1);
      const targets = names.map(l => l.split(/[,，\t]/)[0].trim()).filter(Boolean);
      let matched = 0;
      targets.forEach(n => {
        const c = broadcastChats.find(c => (c.name || '') === n || c.id === n);
        if (c && !broadcastSelected.has(c.id)) { broadcastSelected.add(c.id); matched++; }
      });
      renderBroadcastList();
      alert(matched ? `CSV 导入成功：匹配 ${matched} 个聊天（共 ${targets.length} 行）` : `CSV 未匹配到聊天（${targets.length} 行）——请确认每行是聊天名称或 ID`);
    } catch (e) { alert('导入失败: ' + e.message); }
  };
  function renderBroadcastFiles() {
    const el = document.getElementById('broadcast-files');
    el.innerHTML = broadcastFiles.map((f, i) =>
      `<span class="bf-item" title="${escapeHtml(f.name)}">${escapeHtml(f.name)} <i data-i="${i}">×</i></span>`
    ).join('');
    el.querySelectorAll('i').forEach((x) => {
      x.onclick = () => { broadcastFiles.splice(+x.dataset.i, 1); renderBroadcastFiles(); };
    });
  }
  function closeBroadcast() { bOverlay.classList.add('hidden'); }
  async function loadBroadcastChats() {
    bMetaEl.textContent = '加载聊天列表…';
    const account = accounts.find(a => a.id === activeId);
    const wv = wvMap.get(activeId);
    if (!account || !wv) { bMetaEl.textContent = '当前账号不可用'; return; }
    const key = familyOf(account.type).key;
    const adapter = BROADCAST_ADAPTERS[key] || BROADCAST_ADAPTERS['telegram-z'];
    try {
      const res = await wv.executeJavaScript(adapter.getChats);
      broadcastChats = JSON.parse(String(res));
      bMetaEl.textContent = `共 ${broadcastChats.length} 个聊天（联系人和群组）`;
      renderBroadcastList();
    } catch (e) {
      bMetaEl.textContent = '读取聊天列表失败: ' + e.message;
    }
  }
  function visibleBroadcastChats() {
    const q = bSearchEl.value.trim().toLowerCase();
    return broadcastChats.filter(c => {
      if (broadcastSavedFilter && (!broadcastSavedFilter.has(c.id) || c.type !== '群组')) return false;
      return !q || (c.name || '').toLowerCase().includes(q);
    });
  }
  function renderBroadcastSelectedChips() {
    if (!bcSelectedChips) return;
    const selected = [...broadcastSelected].map(id => broadcastChats.find(c => c.id === id)).filter(Boolean);
    bcSelectedChips.innerHTML = selected.map(c => `<span class="bc-selected-chip" title="${escapeHtml(c.name || c.id)}"><span>${escapeHtml(c.name || c.id)}</span><button type="button" data-id="${escapeHtml(c.id)}">×</button></span>`).join('');
    bcSelectedChips.querySelectorAll('button').forEach(btn => btn.onclick = e => { e.stopPropagation(); broadcastSelected.delete(btn.dataset.id); renderBroadcastList(); });
  }
  function renderBroadcastList() {
    const q = bSearchEl.value.trim().toLowerCase();
    const list = visibleBroadcastChats();
    bListEl.innerHTML = '';
    list.forEach((c) => {
      const item = document.createElement('label');
      item.className = 'broadcast-item';
      const checked = broadcastSelected.has(c.id);
      const badge = c.type ? `<span class="bc-type-badge ${c.type === '群组' ? 'group' : ''}">${c.type === '群组' ? '群组' : '联系人'}</span>` : '';
      item.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''}><span class="broadcast-name">${escapeHtml(c.name || c.id)}</span>${badge}`;
      item.querySelector('input').onchange = (e) => {
        if (e.target.checked) broadcastSelected.add(c.id);
        else broadcastSelected.delete(c.id);
        renderBroadcastSelectedChips();
        updateBroadcastMeta();
      };
      bListEl.appendChild(item);
    });
    if (!list.length) bListEl.innerHTML = '<div class="nav-empty">没有匹配的聊天</div>';
    renderBroadcastSelectedChips();
    updateBroadcastMeta();
  }
  // 全选 / 清空 / 全选群组
  document.getElementById('broadcast-select-all').onclick = () => {
    const q = bSearchEl.value.trim().toLowerCase();
    visibleBroadcastChats().forEach(c => broadcastSelected.add(c.id));
    renderBroadcastList();
  };
  document.getElementById('broadcast-select-groups').onclick = () => {
    const q = bSearchEl.value.trim().toLowerCase();
    visibleBroadcastChats().filter(c => c.type === '群组').forEach(c => broadcastSelected.add(c.id));
    renderBroadcastList();
  };
  document.getElementById('broadcast-select-contacts').onclick = () => {
    const q = bSearchEl.value.trim().toLowerCase();
    broadcastChats.filter(c => c.type === '联系人' && (!q || (c.name || '').toLowerCase().includes(q))).forEach(c => broadcastSelected.add(c.id));
    renderBroadcastList();
  };
  // 插入变量按钮（%nc 联系人名称）
  document.getElementById('broadcast-insert-var').onclick = () => {
    bMessageEl.value += '%nc';
    bMessageEl.focus();
  };
  document.getElementById('broadcast-clear').onclick = () => {
    broadcastSelected.clear();
    renderBroadcastList();
  };
  // 群组标签：原版语义=保存一组群，点击后恢复并筛选这组群
  let broadcastSavedFilter = null;
  function currentBroadcastGroupTags() {
    const all = (config || {}).broadcastGroups || [];
    // 兼容旧版本无 accountId 的标签；新保存的标签严格按账号隔离
    return all.filter(g => !g.accountId || g.accountId === activeId);
  }
  function renderSavedGroups() {
    const sel = document.getElementById('broadcast-saved-groups');
    const list = document.getElementById('bc-group-tag-list');
    if (!sel || !list) return;
    const tags = currentBroadcastGroupTags();
    const current = sel.value;
    sel.innerHTML = '<option value="">全部群组（清除筛选）</option>' + tags.map(g =>
      `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}（${(g.chatIds || []).length} 个群）</option>`).join('');
    if (current && tags.some(g => g.id === current)) sel.value = current;
    list.innerHTML = tags.length ? '' : '<span class="bc-original-empty">暂无已保存标签</span>';
    tags.forEach(g => {
      const wrap = document.createElement('span');
      wrap.className = 'bc-original-tag' + (sel.value === g.id ? ' active' : '');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'bc-original-tag__open';
      open.innerHTML = `<span class="bc-original-tag__icon">▣</span>${escapeHtml(g.name)}<em>${(g.chatIds || []).length}</em>`;
      open.onclick = () => applyBroadcastGroupTag(g);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'bc-original-tag__remove';
      remove.title = '删除标签';
      remove.textContent = '×';
      remove.onclick = (e) => { e.stopPropagation(); deleteBroadcastGroupTag(g); };
      wrap.append(open, remove);
      list.appendChild(wrap);
    });
  }
  document.getElementById('broadcast-save-group').onclick = async () => {
    const selectedGroups = broadcastChats.filter(c => broadcastSelected.has(c.id) && c.type === '群组');
    if (!selectedGroups.length) { alert('请先勾选要保存的群组'); return; }
    const name = prompt('给这组群起个标签名：', `群组标签 ${(currentBroadcastGroupTags()).length + 1}`);
    if (!name) return;
    const groups = (config.broadcastGroups || []).filter(g => g.accountId !== activeId || !g.accountId);
    const old = groups.find(g => g.accountId === activeId && g.name === name);
    const tag = { id: old ? old.id : 'bg' + Date.now(), accountId: activeId, name: name.trim(), chatIds: selectedGroups.map(c => c.id), createdAt: old?.createdAt || Date.now(), updatedAt: Date.now() };
    const next = old ? groups.map(g => g.id === old.id ? tag : g) : [...groups, tag];
    config.broadcastGroups = next;
    await window.api.config.set({ broadcastGroups: next });
    broadcastSavedFilter = new Set(tag.chatIds);
    document.getElementById('broadcast-saved-groups').value = tag.id;
    renderSavedGroups();
    renderBroadcastList();
    alert(`已保存群组标签「${tag.name}」（${tag.chatIds.length} 个群）`);
  };
  function clearBroadcastGroupTagFilter() {
    broadcastSavedFilter = null;
    broadcastSelected.clear();
    const sel = document.getElementById('broadcast-saved-groups');
    if (sel) sel.value = '';
    renderSavedGroups();
    renderBroadcastList();
  }
  function applyBroadcastGroupTag(g) {
    if (!g) return;
    const sel = document.getElementById('broadcast-saved-groups');
    if (sel) sel.value = g.id;
    broadcastSavedFilter = new Set(g.chatIds || []);
    broadcastSelected.clear();
    // 原版 setValue 语义：整体替换当前集合，不追加
    g.chatIds.forEach(id => { if (broadcastChats.some(c => c.id === id && c.type === '群组')) broadcastSelected.add(id); });
    renderSavedGroups();
    renderBroadcastList();
    const missing = g.chatIds.filter(id => !broadcastChats.some(c => c.id === id));
    if (missing.length) alert(`标签「${g.name}」中有 ${missing.length} 个群当前不可用，已跳过`);
  }
  async function deleteBroadcastGroupTag(g) {
    if (!g) return;
    if (!confirm(`删除群组标签「${g.name}」？不会删除真实群组。`)) return;
    const next = (config.broadcastGroups || []).filter(x => x.id !== g.id);
    config.broadcastGroups = next;
    await window.api.config.set({ broadcastGroups: next });
    clearBroadcastGroupTagFilter();
  }
  document.getElementById('broadcast-saved-groups').onchange = (e) => {
    const g = currentBroadcastGroupTags().find(x => x.id === e.target.value);
    if (g) applyBroadcastGroupTag(g); else clearBroadcastGroupTagFilter();
  };
  document.getElementById('broadcast-show-all-groups').onclick = clearBroadcastGroupTagFilter;
  document.getElementById('broadcast-delete-group').onclick = async () => {
    const gid = document.getElementById('broadcast-saved-groups')?.value;
    await deleteBroadcastGroupTag(currentBroadcastGroupTags().find(x => x.id === gid));
  };
  function updateBroadcastMeta() {
    const account = accounts.find(a => a.id === activeId);
    const visible = visibleBroadcastChats().length;
    const scope = broadcastSavedFilter ? `标签内 ${visible} 个群` : `共 ${broadcastChats.length} 个聊天`;
    bMetaEl.innerHTML = `<span>${escapeHtml(account ? account.name : '')}</span><span> · ${scope}</span><strong class="bc-selected-count">已选 ${broadcastSelected.size} 个</strong>`;
  }
  // 构造文件拖拽注入脚本（TG 接收 drop 后自动上传）
  function buildDropFileScript(file) {
    return `(() => {
      try {
        const b64 = '${file.base64}';
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const f = new File([bytes], ${JSON.stringify(file.name)}, { type: ${JSON.stringify(file.mime || 'application/octet-stream')} });
        const dt = new DataTransfer();
        dt.items.add(f);
        const target = document.querySelector('.input-message-container, .composer, [contenteditable="true"]') || document.body;
        const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
        target.dispatchEvent(ev);
        return 'DROPPED';
      } catch (e) { return 'ERR:' + e.message; }
    })()`;
  }
  // 多消息定时任务（持久化；重启/重开窗口后重新挂定时器）
  let scheduleTasks = JSON.parse(localStorage.getItem('scheduleTasks') || '[]');
  const scheduleTaskTimers = new Map();
  function persistScheduleTasks() {
    localStorage.setItem('scheduleTasks', JSON.stringify(scheduleTasks));
  }
  function armScheduleTasks() {
    for (const [id, timer] of scheduleTaskTimers) clearTimeout(timer);
    scheduleTaskTimers.clear();
    for (const task of scheduleTasks) {
      if (!task.id) task.id = 'sched-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      const delay = new Date(task.time || '').getTime() - Date.now();
      if (!task.time || !task.message || delay <= 0) continue;
      const timer = setTimeout(async () => {
        scheduleTaskTimers.delete(task.id);
        try { await fireScheduledTask(task); task.doneAt = Date.now(); }
        catch (e) { task.lastError = e.message; }
        persistScheduleTasks();
        renderScheduleList();
      }, delay);
      scheduleTaskTimers.set(task.id, timer);
    }
    persistScheduleTasks();
  }
  function renderScheduleList() {
    const el = document.getElementById('broadcast-schedule-list');
    if (!scheduleTasks.length) { el.innerHTML = ''; return; }
    el.innerHTML = scheduleTasks.map((t, i) => `
      <div class="bc-schedule-item">
        <input type="datetime-local" class="bc-sched-time" value="${t.time || ''}" data-i="${i}" title="发送时间">
        <input type="text" class="bc-sched-msg" placeholder="消息内容…（支持 %nc）" value="${escapeHtml(t.message || '')}" data-i="${i}">
        <select class="bc-sched-group" data-i="${i}" title="发送到哪个群组预设（留空=当前勾选）">
          <option value="">当前勾选</option>
          ${(config.broadcastGroups || []).map(g => `<option value="${g.id}" ${t.groupId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
        </select>
        <button class="bc-btn bc-sched-del" data-i="${i}" title="删除">×</button>
      </div>`).join('');
    el.querySelectorAll('.bc-sched-time').forEach(x => x.onchange = () => { scheduleTasks[+x.dataset.i].time = x.value; persistScheduleTasks(); armScheduleTasks(); });
    el.querySelectorAll('.bc-sched-msg').forEach(x => x.oninput = () => { scheduleTasks[+x.dataset.i].message = x.value; persistScheduleTasks(); });
    el.querySelectorAll('.bc-sched-group').forEach(x => x.onchange = () => { scheduleTasks[+x.dataset.i].groupId = x.value; persistScheduleTasks(); });
    el.querySelectorAll('.bc-sched-del').forEach(x => x.onclick = () => { const t = scheduleTasks[+x.dataset.i]; if (t && scheduleTaskTimers.has(t.id)) clearTimeout(scheduleTaskTimers.get(t.id)); scheduleTasks.splice(+x.dataset.i, 1); persistScheduleTasks(); renderScheduleList(); });
  }
  const addSchedBtn = document.getElementById('broadcast-add-schedule');
  if (addSchedBtn) addSchedBtn.onclick = () => {
    scheduleTasks.push({ id: 'sched-' + Date.now(), time: '', message: '', groupId: '' });
    persistScheduleTasks();
    renderScheduleList();
  };
  // 定时任务到点执行：加载群组预设 + 设置消息 + 发送
  async function fireScheduledTask(t) {
    if (t.groupId) {
      const g = (config.broadcastGroups || []).find(x => x.id === t.groupId);
      if (g) {
        broadcastSelected.clear();
        g.chatIds.forEach(id => { if (broadcastChats.some(c => c.id === id)) broadcastSelected.add(id); });
      }
    }
    bMessageEl.value = t.message;
    renderBroadcastList();
    await doSendBroadcast();
  }
  function expandBroadcastVariants(text) {
    // 原版多版本语法：{版本A|版本B|版本C}，每个目标随机选一条
    return String(text || '').replace(/\{([^{}|]+(?:\|[^{}|]+)+)\}/g, (_all, body) => {
      const choices = body.split('|');
      return choices[Math.floor(Math.random() * choices.length)].trim();
    });
  }
  function broadcastGreeting() {
    const h = new Date().getHours();
    return h < 12 ? '早上好' : h < 18 ? '下午好' : '晚上好';
  }
  // 发送（入口：支持定时）
  let broadcastTimer = null;
  let broadcastTotal = 0, broadcastCurrent = 0, broadcastOkCount = 0; // 发送视图（HelloWorld 风格）
  let countdownInterval = null;
  function setProgress(percent, text) {
    bProgressEl.classList.remove('hidden');
    document.getElementById('broadcast-progress-bar').style.width = percent + '%';
    document.getElementById('broadcast-progress-text').textContent = text;
    // 发送中视图（HelloWorld 风格）：进度条计数 + 已发送
    const lgFill = document.getElementById('bc-progress-lg-fill');
    if (lgFill) {
      const pct = Math.min(100, Math.max(0, percent));
      lgFill.style.width = (pct === 0 ? 1 : pct) + '%';
      const lgText = document.getElementById('bc-progress-lg-text');
      if (lgText) lgText.textContent = `${broadcastCurrent} / ${broadcastTotal} (${pct.toFixed(2)}%)`;
    }
    const sentEl = document.getElementById('bc-sent-count');
    if (sentEl) sentEl.textContent = broadcastOkCount;
    const totalEl = document.getElementById('bc-total-count');
    if (totalEl) totalEl.textContent = broadcastTotal;
  }
  function showSendingView() {
    const body = document.querySelector('#broadcast-overlay .bc-body');
    if (body) body.style.display = 'none';
    const sending = document.getElementById('broadcast-sending');
    if (sending) sending.classList.remove('hidden');
    const footerBtns = document.querySelector('#broadcast-overlay .bc-footer__btns');
    if (footerBtns) footerBtns.style.display = 'none';
  }
  function hideSendingView() {
    const body = document.querySelector('#broadcast-overlay .bc-body');
    if (body) body.style.display = '';
    const sending = document.getElementById('broadcast-sending');
    if (sending) sending.classList.add('hidden');
    const footerBtns = document.querySelector('#broadcast-overlay .bc-footer__btns');
    if (footerBtns) footerBtns.style.display = '';
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    document.getElementById('bc-countdown').textContent = '下一次发送 --s';
    document.getElementById('bc-preview-name').textContent = '—';
    document.getElementById('bc-preview-msg').textContent = '—';
  }
  function startCountdown(seconds) {
    const el = document.getElementById('bc-countdown');
    if (countdownInterval) clearInterval(countdownInterval);
    let left = Math.max(0, Math.round(seconds));
    el.textContent = `下一次发送 00:${String(left).padStart(2, '0')}s`;
    countdownInterval = setInterval(() => {
      left--;
      if (left <= 0) { clearInterval(countdownInterval); countdownInterval = null; el.textContent = '正在发送…'; return; }
      el.textContent = `下一次发送 00:${String(left).padStart(2, '0')}s`;
    }, 1000);
  }
  async function sendBroadcast() {
    window.__bcTrace = (window.__bcTrace || '') + 'sendBroadcast→';
    if (broadcastRunning) { broadcastStop = true; return; }
    // 多消息定时：持久化任务由 armScheduleTasks 统一挂载，避免重复 setTimeout
    const pendingSched = scheduleTasks.filter(t => t.time && t.message && new Date(t.time).getTime() > Date.now());
    if (pendingSched.length) {
      persistScheduleTasks();
      armScheduleTasks();
      setProgress(0, `已持久化 ${pendingSched.length} 条定时消息（重启后仍会恢复）`);
      return;
    }
    // 单条定时发送：勾选了定时且时间在未来 → 安排到点自动开始
    try {
      const schedOn = document.getElementById('broadcast-schedule-toggle')?.checked;
      const schedTime = document.getElementById('broadcast-schedule-time')?.value;
      if (schedOn && schedTime) {
        const target = new Date(schedTime).getTime();
        if (target > Date.now()) {
          clearTimeout(broadcastTimer);
          setProgress(0, `已安排定时发送：${new Date(target).toLocaleString()} 自动开始`);
          broadcastTimer = setTimeout(() => { doSendBroadcast(); }, target - Date.now());
          return;
        }
      }
    } catch (e) { /* 定时解析失败则立即发送 */ }
    await doSendBroadcast();
  }
  // 实际群发
  async function doSendBroadcast() {
    window.__bcTrace = (window.__bcTrace || '') + 'doSend→';
    if (broadcastRunning) { broadcastStop = true; return; }
    const account = accounts.find(a => a.id === activeId);
    const wv = wvMap.get(activeId);
    const message = bMessageEl.value;
    if (!account || !wv) { alert('当前账号不可用'); return; }
    if (!message.trim() && !broadcastFiles.length) { alert('请输入消息内容或添加文件'); return; }
    // 发送至单选模式：custom=勾选列表；paste/excel=号码匹配聊天；all*=全选（已由 radio change 处理）
    let targets = broadcastChats.filter(c => broadcastSelected.has(c.id));
    // 排除列表（勾选的不发）
    const excl = window.__broadcastExcludeSet ? window.__broadcastExcludeSet() : new Set();
    if (excl.size) targets = targets.filter(t => !excl.has(t.id));
    const sendtoVal = document.querySelector('input[name="bc-sendto"]:checked')?.value || 'custom';
    if (sendtoVal === 'group-members') {
      const sel = document.getElementById('bc-group-members-select');
      const groupIds = sel ? [...sel.selectedOptions].map(o => o.value) : [];
      if (!groupIds.length) { alert('请先选择至少一个群组'); return; }
      if (!(account.type === 'whatsapp' || account.type === 'whatsapp-pure')) { alert('群成员私聊发送仅支持 WhatsApp'); return; }
      try {
        const res = await wv.executeJavaScript(`(async () => {
          try {
            const W = window.WAPLUS_WPP || window.WPP;
            const UP = W.whatsapp.UserPrefs;
            const mePn = UP.getMaybeMePnUser ? UP.getMaybeMePnUser() : UP.getMeUser();
            const meLid = UP.getMaybeMeLidUser ? UP.getMaybeMeLidUser() : null;
            const mine = [mePn, meLid].filter(Boolean).map(x => String(x._serialized || x));
            const seen = new Set();
            const out = [];
            for (const gid of ${JSON.stringify(groupIds)}) {
              const parts = await W.group.getParticipants(gid);
              for (const p of parts) {
                let id = String(p.id && (p.id._serialized || p.id) || p);
                if (mine.includes(id) || seen.has(id)) continue;
                // LID 转 PN（若可用），私聊优先真实号码 JID
                try {
                  if (id.endsWith('@lid') && W.contact.getPnLidEntry) {
                    const pair = await W.contact.getPnLidEntry(id);
                    if (pair && pair.pn) id = String(pair.pn._serialized || pair.pn);
                  }
                } catch (e) {}
                seen.add(id);
                const c = await W.contact.get(id).catch(() => null);
                out.push({ id, name: c ? (c.name || c.pushname || c.shortName || id) : id, realName: c ? (c.pushname || c.name || '') : '' });
              }
            }
            return JSON.stringify(out);
          } catch (e) { return 'ERR:' + e.message; }
        })()`);
        if (String(res).startsWith('ERR:')) { alert('读取群成员失败: ' + res); return; }
        targets = JSON.parse(String(res));
      } catch (e) { alert('读取群成员失败: ' + e.message); return; }
    } else if (sendtoVal === 'label') {
      // 标签模式：选标签 → 该标签下所有联系人
      const labelId = document.getElementById('bc-label-select')?.value;
      if (!labelId) { alert('请先选择标签'); return; }
      try {
        const res = await wv.executeJavaScript(`(async () => {
          try {
            const L = window.require('WAWebLabelCollection').LabelCollection;
            const lb = (L._models || []).find(l => String(l.id) === ${JSON.stringify(labelId)});
            const chatIds = lb && (lb.__x_chatIds || (lb.getChatIds ? lb.getChatIds() : [])) || [];
            return JSON.stringify(chatIds.map(c => String(c)));
          } catch (e) { return 'ERR:' + e.message; }
        })()`);
        const txt = String(res || '');
        if (txt.startsWith('ERR:')) { alert('获取标签联系人失败: ' + txt); return; }
        const ids = JSON.parse(txt);
        targets = broadcastChats.filter(c => ids.includes(c.id));
      } catch (e) { alert('获取标签联系人失败: ' + e.message); return; }
    } else if (sendtoVal === 'paste' || sendtoVal === 'excel') {
      const numbers = (sendtoVal === 'paste')
        ? (document.getElementById('bc-paste-numbers')?.value || '').split(/\n+/).map(s => s.trim()).filter(Boolean)
        : (window.__excelNumbers || []);
      targets = numbers.map(n => {
        const clean = n.replace(/\s+/g, '');
        const hit = broadcastChats.find(c => (c.name || '').includes(clean) || String(c.id).includes(clean));
        return hit ? hit : { id: clean, name: clean, isNumber: true };
      });
      // WA 裸号码不能直接当 chatId：交给 WPP queryExists 核验并转换为规范 JID
      if ((account.type === 'whatsapp' || account.type === 'whatsapp-pure') && targets.length) {
        try {
          const checked = await wv.executeJavaScript(`(async () => {
            try {
              const W = window.WAPLUS_WPP || window.WPP;
              const out = [];
              for (const n of ${JSON.stringify(targets.map(t => t.id))}) {
                const raw = String(n).replace(/[^0-9@]/g, '');
                const jid = raw.includes('@') ? raw : raw + '@c.us';
                const c = await W.contact.queryExists(jid);
                if (c) out.push({ id: String(c.wid || c.id || jid), name: String(c.pushname || c.name || jid), isNumber: true });
              }
              return JSON.stringify(out);
            } catch (e) { return 'ERR:' + e.message; }
          })()`);
          if (String(checked).startsWith('ERR:')) { alert('号码核验失败: ' + checked); return; }
          targets = JSON.parse(String(checked));
        } catch (e) { alert('号码核验失败: ' + e.message); return; }
      }
    }
    if (!targets.length) { alert('请先勾选要发送的聊天'); return; }
    const preview = targets.slice(0, 6).map(t => t.name).join('、') + (targets.length > 6 ? '…' : '');
    const attachInfo = broadcastFiles.length ? `\n附件：${broadcastFiles.map(f => f.name).join('、')}` : '';
    if (!confirm(`确认向 ${targets.length} 个聊天群发？\n\n${preview}\n\n消息内容：\n${message || '（无文字）'}${attachInfo}\n\n将逐个发送（每条间隔可调防风控）。`)) return;

    broadcastRunning = true;
    broadcastStop = false;
    broadcastPaused = false;
    broadcastFailed = [];
    broadcastTotal = targets.length;
    broadcastCurrent = 0;
    broadcastOkCount = 0;
    showSendingView();
    const key = familyOf(account.type).key;
    const adapter = BROADCAST_ADAPTERS[key] || BROADCAST_ADAPTERS['telegram-z'];
    document.getElementById('broadcast-send').classList.add('hidden');
    const total = targets.length;
    let ok = 0, fail = 0;
    const failReasons = [];
    for (let i = 0; i < targets.length; i++) {
      if (broadcastStop) { setProgress(100, '已停止'); break; }
      // 暂停挂起
      while (broadcastPaused) {
        setProgress(Math.round(i / total * 100), `已暂停（${i}/${total}）`);
        await sleep(800);
        if (broadcastStop) break;
      }
      if (broadcastStop) { setProgress(100, '已停止'); break; }
      const t = targets[i];
      // 原版语义：换行属于同一条完整消息，不能拆成多条随机话术。
      // 只有显式的 {版本A|版本B} 语法才进行随机展开。
      const expandedMsg = expandBroadcastVariants(message);
      let personalMsg = expandedMsg
        .replace(/%nc/gi, t.name || '')
        .replace(/%nr/gi, t.realName || t.name || '')
        .replace(/%sa/gi, broadcastGreeting());
      broadcastCurrent = i + 1;
      // 消息预览（HelloWorld 风格：名称 + 消息）
      const pn = document.getElementById('bc-preview-name');
      if (pn) pn.textContent = t.name || '';
      const pm = document.getElementById('bc-preview-msg');
      if (pm) pm.textContent = personalMsg;
      setProgress(Math.round(i / total * 100), `发送中 ${i + 1}/${total}：${t.name}`);
      // 单个聊天发送（失败自动重试 1 次，消除间歇性时序问题）
      let sentOk = 'NO_SEND';
      let setOk = 'NO_SET';
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (adapter.sendDirect) {
            // WPP 直发模式（WA）
            if (broadcastFiles.length) {
              // 多附件逐个发送；最后一个附件带主消息作为 caption（避免重复发同一段文字）
              let mediaOk = true;
              const mediaResults = [];
              for (let fi = 0; fi < broadcastFiles.length; fi++) {
                const file = broadcastFiles[fi];
                const caption = fi === broadcastFiles.length - 1 ? personalMsg : '';
                try {
                  const sf = await window.api.broadcast.sendFile({
                    partition: account.partition,
                    filePath: file.filePath,
                    chatId: t.id,
                    caption,
                    mime: file.mime,
                    name: file.name,
                  });
                  const r = String(sf || '');
                  mediaResults.push(`${file.name}:${r}`);
                  if (!(r === 'SENT' || r === 'CLICKED')) mediaOk = false;
                } catch (e) {
                  mediaOk = false;
                  mediaResults.push(`${file.name}:ERR:${e.message}`);
                }
              }
              sentOk = mediaOk ? 'SENT' : 'ERR:' + mediaResults.join(' | ');
            } else {
              // 名片优先（选中的联系人名片发到聊天）
              const vcards = (window.__vcardContacts || []).length ? window.__vcardContacts : null;
              if (vcards && vcards.length) {
                const vs = await wv.executeJavaScript(adapter.sendVcards(t.id, vcards));
                if (String(vs) !== 'SENT') { sentOk = 'ERR:名片:' + String(vs); failReasons.push(`${t.name}: ${sentOk}`); break; }
              }
              const tagall = document.getElementById('broadcast-tagall')?.checked || false;
              sentOk = await wv.executeJavaScript(adapter.sendDirect(t.id, personalMsg, tagall));
            }
            if (sentOk === 'SENT' || sentOk === 'CLICKED') break;
            continue;
          }
          await wv.executeJavaScript(adapter.switchChat(t.id));
          await sleep(900); // 等聊天打开
          if (broadcastFiles.length) {
            // 附件：真实拖拽（主进程 CDP）→ 等 TG 弹出发送确认
            for (const file of broadcastFiles) {
              try {
                await window.api.broadcast.dropFile({ partition: account.partition, filePath: file.filePath, mime: file.mime, platform: familyOf(account.type).key });
                await sleep(3000); // 等 TG 弹"Send 1 Files"窗口
              } catch (e) { failReasons.push(`${t.name}: 文件注入失败 ${e.message}`); }
            }
            // 文字消息：由 send 输入到弹窗 caption（弹窗会遮挡主输入框）
            sentOk = await wv.executeJavaScript(adapter.send(personalMsg)); // 弹窗 caption + Send
          } else {
            // 纯文字
            setOk = await wv.executeJavaScript(adapter.setMessage(personalMsg));
            sentOk = await wv.executeJavaScript(adapter.send(''));
            if (setOk !== 'OK') failReasons.push(`${t.name}: 输入失败 ${setOk}`);
          }
          if (sentOk === 'SENT' || sentOk === 'CLICKED') break; // 成功
        } catch (e) {
          if (attempt === 0) { failReasons.push(`${t.name}: EXC ${e.message}（重试）`); continue; }
          failReasons.push(`${t.name}: EXC ${e.message}`);
        }
      }
      if (sentOk === 'SENT' || sentOk === 'CLICKED') ok++;
      else { fail++; failReasons.push(`${t.name}: send=${sentOk} set=${setOk}`); broadcastFailed.push({ name: t.name, reason: sentOk || setOk }); }
      broadcastOkCount = ok;
      if (i < targets.length - 1 && !broadcastStop) {
        const intervalMin = parseFloat(document.getElementById('broadcast-interval-min')?.value) || 2;
        const intervalMax = parseFloat(document.getElementById('broadcast-interval-max')?.value) || intervalMin;
        const lo = Math.max(0.5, Math.min(intervalMin, intervalMax));
        const hi = Math.max(lo, intervalMax);
        const waitSec = lo + Math.random() * (hi - lo);
        startCountdown(waitSec); // 倒计时（HelloWorld 风格：下一次发送 MM:SSs）
        await sleep(waitSec * 1000); // 随机间隔防风控
      }
    }
    broadcastRunning = false;
    hideSendingView();
    document.getElementById('broadcast-send').classList.remove('hidden');
    setProgress(100, `完成：成功 ${ok}，失败 ${fail}${broadcastStop ? '（已停止）' : ''}`);
    // 记录发送历史（数据报表用）
    try {
      const hist = JSON.parse(localStorage.getItem('sendHistory') || '[]');
      hist.push({ t: Date.now(), total, ok, fail, files: broadcastFiles.length, msgLen: message.length });
      if (hist.length > 500) hist.splice(0, hist.length - 500);
      localStorage.setItem('sendHistory', JSON.stringify(hist));
    } catch (e) {}
    if (failReasons.length) {
      console.log('群发失败明细:', failReasons.join(' | '));
      window.__lastFailReasons = failReasons; // 调试：CDP 可读
      window.__lastFailDetail = failReasons.map(r => r.slice(0, 120));
      document.getElementById('broadcast-progress-text').textContent += '（失败名单可导出）';
      document.getElementById('broadcast-export').classList.remove('hidden');
      // 弹窗显示失败明细（方便定位原因）
      const top = failReasons.slice(0, 8).map(r => '· ' + r).join('\n');
      alert(`群发完成：成功 ${ok}，失败 ${fail}\n\n失败明细：\n${top}${failReasons.length > 8 ? `\n… 共 ${failReasons.length} 条（可导出 CSV）` : ''}`);
    }
    broadcastRunning = false;
  }

  const savedMessagesEl = document.getElementById('bc-saved-messages');
  const savedMessageListEl = document.getElementById('bc-saved-message-list');
  const saveMessageBtn = document.getElementById('bc-save-message');
  const deleteMessageBtn = document.getElementById('bc-delete-message');
  let savedMessages = JSON.parse(localStorage.getItem('savedMessages') || '[]');
  function applySavedMessage(i) {
    if (savedMessages[i]) {
      bMessageEl.value = savedMessages[i].msg;
      if (savedMessagesEl) savedMessagesEl.value = String(i);
      renderSavedMessages();
      bMessageEl.focus();
    }
  }
  function removeSavedMessage(i) {
    const item = savedMessages[i];
    if (!item || !confirm(`删除已保存消息「${item.name}」？`)) return;
    savedMessages.splice(i, 1);
    localStorage.setItem('savedMessages', JSON.stringify(savedMessages));
    renderSavedMessages();
  }
  function renderSavedMessages() {
    if (!savedMessagesEl || !savedMessageListEl) return;
    savedMessagesEl.innerHTML = '<option value="">已保存消息…</option>' + savedMessages.map((m, i) => `<option value="${i}">${escapeHtml((m.name || '').slice(0, 24))}</option>`).join('');
    savedMessageListEl.innerHTML = savedMessages.length ? '' : '<span class="bc-original-empty">暂无已保存消息</span>';
    savedMessages.forEach((m, i) => {
      const wrap = document.createElement('span');
      wrap.className = 'bc-original-message-chip' + (savedMessagesEl.value === String(i) ? ' active' : '');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'bc-original-message-chip__open';
      open.textContent = m.name || `消息${i + 1}`;
      open.title = m.msg || '';
      open.onclick = () => applySavedMessage(i);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'bc-original-message-chip__remove';
      remove.textContent = '×';
      remove.title = '删除已保存消息';
      remove.onclick = (e) => { e.stopPropagation(); removeSavedMessage(i); };
      wrap.append(open, remove);
      savedMessageListEl.appendChild(wrap);
    });
  }
  if (saveMessageBtn) saveMessageBtn.onclick = () => {
    const msg = bMessageEl.value;
    if (!msg.trim()) { alert('请先输入消息内容'); return; }
    const name = prompt('保存为（名称）：', '消息' + (savedMessages.length + 1));
    if (!name || !name.trim()) return;
    const old = savedMessages.findIndex(m => m.name === name.trim());
    const item = { name: name.trim(), msg };
    if (old >= 0) savedMessages[old] = item; else savedMessages.push(item);
    localStorage.setItem('savedMessages', JSON.stringify(savedMessages));
    renderSavedMessages();
  };
  if (savedMessagesEl) savedMessagesEl.onchange = () => {
    const i = parseInt(savedMessagesEl.value);
    if (i >= 0) applySavedMessage(i);
  };
  if (deleteMessageBtn) deleteMessageBtn.onclick = () => {
    const i = parseInt(savedMessagesEl?.value || '-1');
    if (i >= 0) removeSavedMessage(i); else alert('请先选择要删除的消息');
  };
  // 保存列表（已选聊天 → 预设）
  const savedListsEl = document.getElementById('bc-saved-lists');
  const saveListBtn = document.getElementById('bc-save-list');
  const deleteListBtn = document.getElementById('bc-delete-list');
  let savedLists = JSON.parse(localStorage.getItem('savedLists') || '[]');
  function renderSavedLists() {
    if (!savedListsEl) return;
    savedListsEl.innerHTML = '<option value="">已保存列表…</option>' + savedLists.map((l, i) => `<option value="${i}">${(l.name || '').slice(0, 24)}（${(l.ids || []).length}）</option>`).join('');
  }
  if (saveListBtn) saveListBtn.onclick = () => {
    if (!broadcastSelected.size) { alert('请先勾选聊天'); return; }
    const name = prompt('保存为（列表名称）：', '列表' + (savedLists.length + 1));
    if (!name) return;
    savedLists.push({ name, ids: [...broadcastSelected] });
    localStorage.setItem('savedLists', JSON.stringify(savedLists));
    renderSavedLists();
  };
  if (savedListsEl) savedListsEl.onchange = () => {
    const i = parseInt(savedListsEl.value);
    if (i >= 0 && savedLists[i]) {
      (savedLists[i].ids || []).forEach(id => broadcastSelected.add(id));
      renderBroadcastList();
    }
  };
  if (deleteListBtn) deleteListBtn.onclick = () => {
    const i = parseInt(savedListsEl?.value || '-1');
    if (i < 0) { alert('请先选择要删除的列表'); return; }
    if (!confirm('删除该列表？')) return;
    savedLists.splice(i, 1);
    localStorage.setItem('savedLists', JSON.stringify(savedLists));
    renderSavedLists();
  };
  // 排除列表（勾选不需要发送的聊天）
  let broadcastExclude = new Set(JSON.parse(localStorage.getItem('broadcastExclude') || '[]'));
  const excludeToggleBtn = document.getElementById('bc-exclude-toggle');
  const excludePanel = document.getElementById('bc-exclude-panel');
  const excludeListEl = document.getElementById('bc-exclude-list');
  if (excludeToggleBtn) excludeToggleBtn.onclick = () => {
    if (!excludePanel) return;
    excludePanel.classList.toggle('hidden');
    if (!excludePanel.classList.contains('hidden')) renderExcludeList();
  };
  function renderExcludeList() {
    if (!excludeListEl) return;
    excludeListEl.innerHTML = '';
    broadcastChats.forEach(c => {
      const label = document.createElement('label');
      label.className = 'broadcast-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = broadcastExclude.has(c.id);
      cb.addEventListener('change', () => {
        if (cb.checked) broadcastExclude.add(c.id); else broadcastExclude.delete(c.id);
        localStorage.setItem('broadcastExclude', JSON.stringify([...broadcastExclude]));
      });
      const span = document.createElement('span');
      span.textContent = c.name || c.id;
      const type = document.createElement('span');
      type.className = 'bc-type';
      type.textContent = c.type || '';
      label.append(cb, span, type);
      excludeListEl.appendChild(label);
    });
  }
  // 发送时排除（doSendBroadcast 的 targets 过滤）
  window.__broadcastExcludeSet = () => broadcastExclude;
  renderSavedMessages();
  renderSavedLists();

  const bcScheduleToggle = document.getElementById('broadcast-schedule-toggle');
  if (bcScheduleToggle) bcScheduleToggle.addEventListener('change', () => {
    const wrap = document.getElementById('bc-schedule-time-wrap');
    if (wrap) wrap.style.display = bcScheduleToggle.checked ? '' : 'none';
  });
  const bcAddFile = document.getElementById('broadcast-add-file');
  async function pickBroadcastFiles() {
    try {
      const f = await window.api.file.pick({ multiple: true });
      if (f) {
        const arr = Array.isArray(f) ? f : [f];
        arr.forEach(x => broadcastFiles.push(x));
        renderBroadcastFiles();
      }
    } catch (e) { /* 用户取消 */ }
  }
  const bcDropzone = document.getElementById('broadcast-dropzone');
  if (bcDropzone) bcDropzone.onclick = pickBroadcastFiles;
  if (bcAddFile) bcAddFile.addEventListener('change', async () => {
    if (bcAddFile.checked) {
      await pickBroadcastFiles();
      bcAddFile.checked = false;
    }
  });
  const bcAddVcard = document.getElementById('broadcast-add-vcard');
  if (bcAddVcard) bcAddVcard.addEventListener('change', async () => {
    if (bcAddVcard.checked) {
      const wv = wvMap.get(activeId);
      const vlist = document.getElementById('bc-vcard-list');
      if (!wv || !vlist) { bcAddVcard.checked = false; return; }
      try {
        const contacts = await wv.executeJavaScript(`(async () => {
          try {
            const W = window.WAPLUS_WPP || window.WPP;
            const chats = await W.chat.list();
            return JSON.stringify(chats.filter(c => !c.isGroup && String(c.id) !== '0@c.us').map(c => {
              const contact = (W.whatsapp.ContactStore && W.whatsapp.ContactStore.get(c.id)) || c.contact || null;
              const name = c.name || c.formattedTitle || (contact && (contact.name || contact.pushname || contact.shortName || contact.formattedName)) || String(c.id);
              return { id: String(c.id), name };
            }).slice(0, 300));
          } catch (e) { return 'ERR:' + e.message; }
        })()`);
        const txt = String(contacts || '');
        if (txt.startsWith('ERR:')) { alert('获取联系人失败: ' + txt); bcAddVcard.checked = false; return; }
        const list = JSON.parse(txt);
        if (!list.length) { alert('当前账号没有联系人'); bcAddVcard.checked = false; return; }
        vlist.innerHTML = '<div class="bc-vcard-title">选择要发送名片的联系人：</div>' + list.map(c => `<label class="bc-vcard-item"><input type="checkbox" value="${c.id.replace(/"/g, '&quot;')}" data-name="${c.name.replace(/"/g, '&quot;')}"> <span>${c.name}</span></label>`).join('');
        vlist.style.display = '';
        window.__vcardContacts = [];
        vlist.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => {
          window.__vcardContacts = [...vlist.querySelectorAll('input:checked')].map(x => ({ id: x.value, name: x.dataset.name }));
          const title = vlist.querySelector('.bc-vcard-title');
          if (title) title.textContent = window.__vcardContacts.length ? `已选 ${window.__vcardContacts.length} 个联系人名片：` : '选择要发送名片的联系人：';
        }));
      } catch (e) { alert('加载联系人失败: ' + e.message); bcAddVcard.checked = false; }
    }
  });
  const bcSendtoRadios = document.querySelectorAll('input[name="bc-sendto"]');
  bcSendtoRadios.forEach(r => r.addEventListener('change', () => {
    const v = document.querySelector('input[name="bc-sendto"]:checked').value;
    const map = { custom: 'bc-sendto-custom', paste: 'bc-sendto-paste', excel: 'bc-sendto-excel', 'group-members': 'bc-sendto-group-members', label: 'bc-sendto-label' };
    Object.keys(map).forEach(k => {
      const el = document.getElementById(map[k]);
      if (el) el.classList.toggle('hidden', k !== v);
    });
    if (v === 'label') loadLabels();
    if (v === 'group-members') {
      const sel = document.getElementById('bc-group-members-select');
      if (sel) {
        const groups = broadcastChats.filter(c => c.type === '群组');
        sel.innerHTML = groups.map(g => `<option value="${g.id}">${escapeHtml(g.name || g.id)}</option>`).join('');
      }
    }
    if (v === 'all-contacts' || v === 'all-groups' || v === 'all') {
      // 模式切换必须先清空，避免把上一个模式的选择混进来
      broadcastSelected.clear();
      const q = bSearchEl.value.trim().toLowerCase();
      broadcastChats.filter(c => (v === 'all' || (v === 'all-contacts' && c.type === '联系人') || (v === 'all-groups' && c.type === '群组')) && (!q || (c.name || '').toLowerCase().includes(q))).forEach(c => broadcastSelected.add(c.id));
      renderBroadcastList();
    }
  }));
  // 标签发送：加载 WA 标签列表（LabelCollection）
  async function loadLabels() {
    const labelSel = document.getElementById('bc-label-select');
    if (!labelSel) return;
    const account = accounts.find(a => a.id === activeId);
    const wv = wvMap.get(activeId);
    if (!account || !wv || !(account.type === 'whatsapp' || account.type === 'whatsapp-pure')) { labelSel.innerHTML = '<option value="">（需要 WhatsApp 账号）</option>'; return; }
    try {
      const res = await wv.executeJavaScript(`(async () => {
        try {
          const L = window.require('WAWebLabelCollection').LabelCollection;
          const labels = (L._models || []).map(l => ({ id: String(l.id), name: l.__x_name || '' }));
          return JSON.stringify(labels);
        } catch (e) { return 'ERR:' + e.message; }
      })()`);
      const txt = String(res || '');
      if (txt.startsWith('ERR:')) { labelSel.innerHTML = '<option value="">（标签加载失败）</option>'; return; }
      const labels = JSON.parse(txt);
      labelSel.innerHTML = '<option value="">选择标签…</option>' + labels.map(l => `<option value="${l.id}">${l.name}</option>`).join('');
      if (!labels.length) labelSel.innerHTML = '<option value="">（当前账号无标签）</option>';
    } catch (e) { labelSel.innerHTML = '<option value="">（标签加载失败）</option>'; }
  }
  const bcPaste = document.getElementById('bc-paste-numbers');
  if (bcPaste) bcPaste.addEventListener('input', () => {
    const total = bcPaste.value.split(/\n+/).map(s => s.trim()).filter(Boolean).length;
    const el = document.getElementById('bc-paste-total');
    if (el) el.textContent = total;
  });
  const insertSaBtn = document.getElementById('broadcast-insert-sa');
  if (insertSaBtn) insertSaBtn.onclick = () => { bMessageEl.value += '%sa'; };
  const insertNrBtn = document.getElementById('broadcast-insert-nr');
  if (insertNrBtn) insertNrBtn.onclick = () => { bMessageEl.value += '%nr'; };
  const multiVerBtn = document.getElementById('bc-multiversion');
  if (multiVerBtn) multiVerBtn.onclick = () => { bMessageEl.value += ' {版本1|版本2|版本3}'; };
  const excelMeta = document.getElementById('bc-excel-meta');
  const importCsvBtn = document.getElementById('broadcast-import-csv');
  if (importCsvBtn) importCsvBtn.onclick = async () => {
    try {
      const f = await window.api.file.pickCsv();
      if (!f) return;
      // 主进程对 XLS/XLSX 已解析为 rows；CSV/TXT 保留原始文本
      const rows = Array.isArray(f.rows) ? f.rows.map(row => row.map(v => String(v ?? ''))) : null;
      const lines = rows
        ? rows.filter(row => row.some(v => v.trim())).map(row => row)
        : (f.content || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(l => l.split(/[,;\t]/));
      let col = -1;
      if (lines.length) {
        const header = lines[0];
        col = header.findIndex(h => /号码|电话|phone|number|whatsapp|mobile/i.test(h));
        if (col === -1) col = 0;
        // 有表头才跳过；第一行看起来就是号码时保留
        const firstValue = String(lines[0][col] || '').replace(/[\s+()-]/g, '');
        if (lines.length > 1 && (col >= 0 && /号码|电话|phone|number|whatsapp|mobile|姓名|name/i.test(header.join(' ')))) lines.shift();
        else if (lines.length > 1 && !/^\d{6,}$/.test(firstValue)) lines.shift();
      }
      const numbers = lines.map(row => String(row[col] ?? '').trim()).filter(Boolean);
      // 核验：WA 联系人集合存在 = 已注册（原版 verificacontatosaguarde 逻辑）
      window.__excelNumbers = numbers;
      const account = accounts.find(a => a.id === activeId);
      const wv = wvMap.get(activeId);
      if (excelMeta) excelMeta.textContent = `已导入 ${numbers.length} 个号码，正在核验…`;
      if (account && wv && (account.type === 'whatsapp' || account.type === 'whatsapp-pure')) {
        try {
          const chunk = numbers.slice(0, 100);
          const res = await wv.executeJavaScript(`(async () => {
            try {
              const C = window.require('WAWebContactCollection').ContactCollection;
              let ok = 0;
              for (const n of ${JSON.stringify(chunk)}) {
                const c = C.get(n.replace(/\\s+/g, ''));
                if (c) ok++;
              }
              return 'OK:' + ok;
            } catch (e) { return 'ERR:' + e.message; }
          })()`);
          const txt = String(res || '');
          if (txt.startsWith('OK:')) {
            const okN = parseInt(txt.split(':')[1]) || 0;
            if (excelMeta) excelMeta.textContent = `已导入 ${numbers.length} 个号码（前 ${chunk.length} 个核验：${okN} 个有效 WhatsApp）`;
          }
        } catch (e) { /* 核验失败不阻塞 */ }
      } else if (excelMeta) {
        excelMeta.textContent = `已导入 ${numbers.length} 个号码`;
      }
    } catch (e) { if (excelMeta) excelMeta.textContent = '导入失败: ' + e.message; }
  };

  document.getElementById('btn-broadcast').onclick = (e) => {
    e.stopPropagation();
    const menu = document.getElementById('broadcast-menu');
    if (!menu) { openBroadcast(); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = Math.max(4, rect.left) + 'px';
    menu.classList.toggle('hidden');
  };
  const bcMenuSend = document.getElementById('bc-menu-send');
  if (bcMenuSend) bcMenuSend.onclick = () => {
    document.getElementById('broadcast-menu')?.classList.add('hidden');
    openBroadcast();
  };
  const bcMenuGrouptools = document.getElementById('bc-menu-grouptools');
  // ---------- 群组工具（克隆/解散/退出——真实 WA API） ----------
  const gtOverlay = document.getElementById('gt-overlay');
  const gtGroups = document.getElementById('gt-group-list');
  const gtStatus = document.getElementById('gt-status');
  const gtCloneBtn = document.getElementById('gt-clone');
  const gtCloneCount = document.getElementById('gt-clone-count');
  const gtDestroyBtn = document.getElementById('gt-destroy');
  const gtLeaveBtn = document.getElementById('gt-leave');
  const gtDestroyDelayMin = document.getElementById('gt-destroy-delay-min');
  const gtDestroyDelayMax = document.getElementById('gt-destroy-delay-max');
  if (gtOverlay && gtGroups) {
    document.getElementById('gt-close').onclick = () => gtOverlay.classList.add('hidden');
    async function loadGtGroups() {
      // 群组工具只支持 WhatsApp——自动切到第一个 WA 账号
      if (!accounts.find(a => a.id === activeId && (a.type === 'whatsapp' || a.type === 'whatsapp-pure'))) {
        const waAcc = accounts.find(a => a.type === 'whatsapp' || a.type === 'whatsapp-pure');
        if (!waAcc) { alert('请先添加一个 WhatsApp 账号'); return false; }
        switchAccount(waAcc.id);
        await sleep(2500);
      }
      const account = accounts.find(a => a.id === activeId);
      const wv = wvMap.get(activeId);
      if (!account || !wv) { alert('请先切换到一个 WhatsApp 账号'); return false; }
      updateGtAccount();
      try {
        const res = await Promise.race([
          wv.executeJavaScript(`(async () => {
            try {
              const W = window.WAPLUS_WPP || window.WPP;
              const chats = await W.chat.list();
              const out = [];
              for (const c of chats) {
                if (!String(c.id).includes('@g.us')) continue;
                let name = c.name || c.formattedTitle || '';
                if (!name) { try { const m = window.require('WAWebGroupMetadataCollection').get(c.id); name = m ? (m.__x_subject || '') : ''; } catch(e){} }
                out.push({ id: String(c.id), name: name || String(c.id).slice(0, 20) });
              }
              return JSON.stringify(out);
            } catch (e) { return 'ERR:' + e.message; }
          })()`),
          new Promise(r => setTimeout(() => r('TIMEOUT'), 8000))
        ]);
        const txt = String(res || '');
        if (txt.startsWith('ERR:')) { alert('获取群组失败: ' + txt); return false; }
        gtGroupList = JSON.parse(txt);
        // 确保监听器已注入（幂等；页面重载后自动重新注入）
        injectGtAgent(wv, account);
        syncGtCfgToWebview(wv);
        renderGtGroups();
        return true;
      } catch (e) { alert('获取群组失败: ' + e.message); return false; }
    }
    // 多选渲染
    let gtGroupList = [];
    let gtSelected = new Set();
    function renderGtGroups() {
      const listEl = document.getElementById('gt-group-list');
      if (!listEl) return;
      if (!gtGroupList.length) { listEl.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary)">当前账号无群组</div>'; return; }
      listEl.innerHTML = gtGroupList.map(g => `<label style="display:flex;align-items:center;gap:6px;padding:3px 4px;font-size:12.5px;color:var(--text-primary);cursor:pointer">
        <input type="checkbox" data-gid="${g.id}" ${gtSelected.has(g.id) ? 'checked' : ''}>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${g.name}</span>
      </label>`).join('');
      listEl.querySelectorAll('input[type=checkbox]').forEach(cb => cb.onchange = () => {
        if (cb.checked) gtSelected.add(cb.dataset.gid); else gtSelected.delete(cb.dataset.gid);
        updateGtCount();
      });
      updateGtCount();
    }
    function updateGtCount() {
      const c = document.getElementById('gt-sel-count');
      if (c) c.textContent = `已选 ${gtSelected.size} 个`;
    }
    function selectedGidList() {
      return gtGroupList.filter(g => gtSelected.has(g.id)).map(g => ({ id: g.id, name: g.name }));
    }
    const gtSelectAll = document.getElementById('gt-select-all');
    const gtSelectNone = document.getElementById('gt-select-none');
    const gtGroupListEl = document.getElementById('gt-group-list');
    if (gtSelectAll) gtSelectAll.onclick = () => { gtGroupList.forEach(g => gtSelected.add(g.id)); renderGtGroups(); };
    if (gtSelectNone) gtSelectNone.onclick = () => { gtSelected.clear(); renderGtGroups(); };
    bcMenuGrouptools.onclick = async () => {
      document.getElementById('broadcast-menu')?.classList.add('hidden');
      if (await loadGtGroups()) gtOverlay.classList.remove('hidden');
    };
    // 从当前已选群组克隆：与链接克隆使用同一套资料复制和错误统计
    gtCloneBtn.onclick = async () => {
      const targets = selectedGidList();
      if (!targets.length) { gtStatus.textContent = '请先选择群组'; return; }
      const count = Math.max(1, Math.min(10, parseInt(gtCloneCount.value) || 1));
      const minDelay = Math.max(5, parseInt(gtCloneDelayMin?.value) || 5);
      const maxDelay = Math.max(minDelay, parseInt(gtCloneDelayMax?.value) || 10);
      const wv = wvMap.get(activeId);
      if (!wv) { gtStatus.textContent = '当前账号页面尚未就绪'; return; }
      gtStatus.textContent = `正在克隆 ${targets.length} 个源群，每个 ${count} 个…`;
      showCloneProgress(targets.length * count, '正在准备当前已选群组…');
      startClonePolling(wv, targets.length * count);
      const res = await wv.executeJavaScript(`(async () => {
        window.__gtCloneCancel = false;
        window.__gtCloneProgress = { done: 0, total: ${targets.length * count}, label: '正在读取源群资料…' };
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const result = { created: [], errors: [] };
        try {
          const W = window.WAPLUS_WPP || window.WPP;
          const M = window.require('WAWebGroupModifyInfoJob');
          const Pic = window.require('WAWebContactProfilePicThumbBridge');
          const makeSquare = (dataUrl, size) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => { const side = Math.min(img.width, img.height), sx = (img.width - side) / 2, sy = (img.height - side) / 2, canvas = document.createElement('canvas'); canvas.width = canvas.height = size; canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size); resolve(canvas.toDataURL('image/jpeg', .92)); }; img.onerror = () => reject(new Error('头像图片解码失败')); img.src = dataUrl; });
          const Meta = window.require('WAWebGroupMetadataCollection');
          const UP = W.whatsapp?.UserPrefs;
          const me = UP && (UP.getMaybeMeLidUser?.() || UP.getMaybeMePnUser?.() || UP.getMeUser?.());
          const meWid = String(me?._serialized || me?.id?._serialized || me?.id || '');
          if (!meWid) throw new Error('无法取得当前账号ID');
          for (let sourceIndex = 0; sourceIndex < ${JSON.stringify(targets)}.length; sourceIndex++) {
            if (window.__gtCloneCancel) { result.cancelled = true; break; }
            const source = ${JSON.stringify(targets)}[sourceIndex];
            const src = Meta.get(source.id) || await W.whatsapp.GroupMetadataStore.find(source.id).catch(() => null);
            const name = String(src?.__x_subject || source.name || '克隆群组').trim() || '克隆群组';
            const desc = String(src?.__x_desc || src?.__x_displayedDesc || '');
            const restrict = !!src?.__x_restrict, announce = !!src?.__x_announce;
            let avatar = null;
            try { avatar = await W.contact?.getProfilePictureUrl?.(source.id, true); } catch (e) {}
            const suffix = name.match(/^(.*?)(?:\\s+#(\\d+))$/);
            const base = suffix ? suffix[1].trim() : name;
            const start = suffix ? Number(suffix[2]) + 1 : 1;
            for (let i = 0; i < ${count}; i++) {
              if (window.__gtCloneCancel) { result.cancelled = true; break; }
              const newName = base + ' #' + (start + i);
              try {
                const created = await W.group.create(newName, [meWid], undefined);
                const gid = String(created?.gid?._serialized || created?.gid || '');
                if (!gid) throw new Error('创建接口未返回群ID');
                const applied = [];
                if (desc) { await M.setGroupDescription(gid, desc, String(Date.now()), void 0); applied.push('简介'); }
                if (avatar && Pic?.sendSetPicture) {
                  try { const blob = await (await fetch(avatar)).blob(); const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }); const thumb = await makeSquare(dataUrl, 96), full = await makeSquare(dataUrl, 640); await Pic.sendSetPicture(W.whatsapp.WidFactory.createWid(gid), thumb, full); applied.push('头像'); } catch (e) { result.errors.push(newName + ':头像:' + e.message); }
                }
                if (restrict) { await W.group.setProperty(gid, 'restrict', true); applied.push('仅管理员编辑'); }
                if (announce) { await W.group.setProperty(gid, 'announcement', true); applied.push('仅管理员发言'); }
                result.created.push({source: source.name, name: newName, id: gid, applied});
              } catch (e) { result.errors.push(newName + ':' + e.message); }
              window.__gtCloneProgress = { done: result.created.length + result.errors.filter(x => !x.includes(':头像:')).length, total: ${targets.length * count}, label: '已处理：' + newName };
              if (i < ${count} - 1 || sourceIndex < ${JSON.stringify(targets)}.length - 1) await sleep((Math.random() * (${maxDelay} - ${minDelay}) + ${minDelay}) * 1000);
            }
          }
          return JSON.stringify(result);
        } catch (e) { result.errors.push('初始化:' + e.message); return JSON.stringify(result); }
      })()`);
      try {
        const data = JSON.parse(String(res));
        const total = targets.length * count;
        finishCloneProgress(data.created?.length || 0, total, !!data.cancelled);
        gtStatus.textContent = `${data.cancelled ? '选中群组克隆已停止' : '选中群组克隆完成'}：成功 ${data.created?.length || 0}，失败 ${data.errors?.length || 0}` + (data.errors?.length ? `；${data.errors.slice(0, 2).join(' | ')}` : '');
      } catch (e) { finishCloneProgress(0, targets.length * count, false); gtStatus.textContent = '选中群组克隆失败：返回结果无法解析'; }
      setTimeout(loadGtGroups, 2000);
    };
    // 链接克隆（原版完整语义：资料、简介、头像、权限、编号、间隔）
    const gtCloneLinkBtn = document.getElementById('gt-clone-link-btn');
    const gtCloneDelayMin = document.getElementById('gt-clone-delay-min');
    const gtCloneDelayMax = document.getElementById('gt-clone-delay-max');
    const gtCloneProgress = document.getElementById('gt-clone-progress');
    const gtCloneProgressLabel = document.getElementById('gt-clone-progress-label');
    const gtCloneProgressCount = document.getElementById('gt-clone-progress-count');
    const gtCloneProgressBar = document.getElementById('gt-clone-progress-bar');
    const gtCloneStop = document.getElementById('gt-clone-stop');
    let gtCloneRunning = false;
    let gtClonePollTimer = null;
    let gtClonePollBusy = false;
    const showCloneProgress = (total, label) => { gtCloneRunning = true; gtCloneProgress?.classList.remove('hidden'); if (gtCloneProgressCount) gtCloneProgressCount.textContent = `0/${total}`; if (gtCloneProgressLabel) gtCloneProgressLabel.textContent = label; if (gtCloneProgressBar) gtCloneProgressBar.style.width = '0%'; };
    const startClonePolling = (wv, total) => { clearInterval(gtClonePollTimer); gtClonePollTimer = setInterval(async () => { if (!gtCloneRunning || gtClonePollBusy) return; gtClonePollBusy = true; try { const p = await wv.executeJavaScript('window.__gtCloneProgress || null'); if (p) { const done = Number(p.done) || 0; if (gtCloneProgressCount) gtCloneProgressCount.textContent = `${done}/${total}`; if (gtCloneProgressLabel && p.label) gtCloneProgressLabel.textContent = p.label; if (gtCloneProgressBar) gtCloneProgressBar.style.width = `${total ? Math.min(100, Math.round(done / total * 100)) : 0}%`; } } catch (e) {} finally { gtClonePollBusy = false; } }, 500); };
    const finishCloneProgress = (created, total, cancelled) => { clearInterval(gtClonePollTimer); gtClonePollTimer = null; if (gtCloneProgressCount) gtCloneProgressCount.textContent = `${created}/${total}`; if (gtCloneProgressLabel) gtCloneProgressLabel.textContent = cancelled ? '已停止后续克隆' : '克隆处理完成'; if (gtCloneProgressBar) gtCloneProgressBar.style.width = `${total ? Math.round(created / total * 100) : 0}%`; gtCloneRunning = false; };
    if (gtCloneStop) gtCloneStop.onclick = async () => { if (!gtCloneRunning) return; const wv = wvMap.get(activeId); if (wv) await wv.executeJavaScript('window.__gtCloneCancel = true').catch(() => {}); if (gtCloneProgressLabel) gtCloneProgressLabel.textContent = '正在停止…'; };
    if (gtCloneLinkBtn) gtCloneLinkBtn.onclick = async () => {
      const link = (document.getElementById('gt-clone-link') || {}).value || '';
      const code = (link.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i) || [])[1] || link.trim();
      if (!code) { gtStatus.textContent = '请粘贴群组链接'; return; }
      const count = Math.max(1, Math.min(10, parseInt(gtCloneCount.value) || 1));
      const minDelay = Math.max(5, parseInt(gtCloneDelayMin?.value) || 5);
      const maxDelay = Math.max(minDelay, parseInt(gtCloneDelayMax?.value) || 10);
      const wv = wvMap.get(activeId);
      if (!wv) { gtStatus.textContent = '当前账号页面尚未就绪'; return; }
      gtStatus.textContent = `正在读取群资料…（${count} 个）`;
      showCloneProgress(count, '正在读取邀请链接群资料…');
      startClonePolling(wv, count);
      const res = await wv.executeJavaScript(`(async () => {
        window.__gtCloneCancel = false;
        window.__gtCloneProgress = { done: 0, total: ${count}, label: '正在读取邀请链接群资料…' };
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const result = { created: [], errors: [], source: null };
        try {
          const W = window.WAPLUS_WPP || window.WPP;
          const M = window.require('WAWebGroupModifyInfoJob');
          const Pic = window.require('WAWebContactProfilePicThumbBridge');
          const makeSquare = (dataUrl, size) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => { const side = Math.min(img.width, img.height), sx = (img.width - side) / 2, sy = (img.height - side) / 2, canvas = document.createElement('canvas'); canvas.width = canvas.height = size; canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size); resolve(canvas.toDataURL('image/jpeg', .92)); }; img.onerror = () => reject(new Error('头像图片解码失败')); img.src = dataUrl; });
          const info = await W.group.getGroupInfoFromInviteCode(${JSON.stringify(code)});
          const sourceId = String(info && (info.id?._serialized || info.id || ''));
          const Meta = window.require('WAWebGroupMetadataCollection');
          const src = sourceId ? (Meta.get(sourceId) || await W.whatsapp.GroupMetadataStore.find(sourceId).catch(() => null)) : null;
          const name = String(info?.subject || src?.__x_subject || '克隆群组').trim() || '克隆群组';
          const desc = String(src?.__x_desc || src?.__x_displayedDesc || info?.desc || '');
          const restrict = !!(src?.__x_restrict ?? info?.restrict);
          const announce = !!(src?.__x_announce ?? info?.announce);
          let avatar = null;
          if (sourceId && W.contact?.getProfilePictureUrl) {
            try { avatar = await W.contact.getProfilePictureUrl(sourceId, true); } catch (e) {}
          }
          const UP = W.whatsapp?.UserPrefs;
          const me = UP && (UP.getMaybeMeLidUser?.() || UP.getMaybeMePnUser?.() || UP.getMeUser?.());
          const meWid = String(me?._serialized || me?.id?._serialized || me?.id || '');
          if (!meWid) throw new Error('无法取得当前账号ID');
          const suffix = name.match(/^(.*?)(?:\\s+#(\\d+))$/);
          const base = suffix ? suffix[1].trim() : name;
          const start = suffix ? Number(suffix[2]) + 1 : 1;
          result.source = { id: sourceId, name, hasDesc: !!desc, hasAvatar: !!avatar, restrict, announce };
          for (let i = 0; i < ${count}; i++) {
            if (window.__gtCloneCancel) { result.cancelled = true; break; }
            const newName = base + ' #' + (start + i);
            try {
              const created = await W.group.create(newName, [meWid], undefined);
              const gid = String(created?.gid?._serialized || created?.gid || '');
              if (!gid) throw new Error('创建接口未返回群ID');
              const applied = [];
              if (desc) { await M.setGroupDescription(gid, desc, String(Date.now()), void 0); applied.push('简介'); }
              if (avatar && Pic?.sendSetPicture) {
                try {
                  const resp = await fetch(avatar), blob = await resp.blob();
                  const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
                  const thumb = await makeSquare(dataUrl, 96), full = await makeSquare(dataUrl, 640);
                  await Pic.sendSetPicture(W.whatsapp.WidFactory.createWid(gid), thumb, full); applied.push('头像');
                } catch (e) { result.errors.push(newName + ':头像:' + e.message); }
              }
              if (restrict) { await W.group.setProperty(gid, 'restrict', true); applied.push('仅管理员编辑'); }
              if (announce) { await W.group.setProperty(gid, 'announcement', true); applied.push('仅管理员发言'); }
              result.created.push({ name: newName, id: gid, applied });
            } catch (e) { result.errors.push(newName + ':' + e.message); }
            window.__gtCloneProgress = { done: result.created.length + result.errors.filter(x => !x.includes(':头像:')).length, total: ${count}, label: '已处理：' + newName };
            if (i < ${count} - 1) await sleep((Math.random() * (${maxDelay} - ${minDelay}) + ${minDelay}) * 1000);
          }
          return JSON.stringify(result);
        } catch (e) { result.errors.push('读取/初始化:' + e.message); return JSON.stringify(result); }
      })()`);
      try {
        const data = JSON.parse(String(res));
        const ok = data.created?.length || 0, fail = data.errors?.length || 0;
        finishCloneProgress(ok, count, !!data.cancelled);
        gtStatus.textContent = `${data.cancelled ? '链接克隆已停止' : '链接克隆完成'}：成功 ${ok}，失败 ${fail}` + (data.errors?.length ? `；${data.errors.slice(0, 2).join(' | ')}` : '');
      } catch (e) { finishCloneProgress(0, count, false); gtStatus.textContent = '链接克隆失败：返回结果无法解析'; }
      setTimeout(loadGtGroups, 2000);
    };
    // 解散群组（移除全部成员 + 退出）
    gtDestroyBtn.onclick = async () => {
      const targets = selectedGidList();
      if (!targets.length) { gtStatus.textContent = '请先选择群组'; return; }
      if (!confirm(`确定解散选中的 ${targets.length} 个群组？（移除全部成员并退出——不可撤销）`)) return;
      const wv = wvMap.get(activeId);
      const destroyDelayMin = Math.max(5, parseInt(gtDestroyDelayMin?.value) || 5);
      const destroyDelayMax = Math.max(destroyDelayMin, parseInt(gtDestroyDelayMax?.value) || 10);
      gtStatus.textContent = '正在解散…';
      const results = [];
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
        const t = targets[targetIndex];
        const gid = t.id;
      const res = await wv.executeJavaScript(`(async () => {
        try {
          const W = window.WAPLUS_WPP || window.WPP, gid = ${JSON.stringify(gid)};
          const Meta = window.require('WAWebGroupMetadataCollection');
          const UP = W.whatsapp.UserPrefs, me = UP.getMaybeMeLidUser?.() || UP.getMaybeMePnUser?.() || UP.getMeUser?.();
          const meId = String(me?._serialized || me?.id?._serialized || me?.id || '');
          const meta = Meta.get(gid) || await W.whatsapp.GroupMetadataStore.find(gid).catch(() => null);
          const participants = meta?.participants?._models || meta?.participants || [];
          const others = participants.map(p => String(p.id?._serialized || p.id || '')).filter(id => id && id !== meId);
          if (others.length) await W.group.removeParticipants(gid, others);
          await W.group.leave(gid);
          await new Promise(r => setTimeout(r, 1500));
          const after = Meta.get(gid);
          return JSON.stringify({ ok: true, removed: others.length, remaining: after?.participants?.length ?? 0 });
        } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
      })()`);
      let row; try { row = JSON.parse(String(res)); } catch (e) { row = { ok: false, error: '返回无法解析' }; }
      results.push(t.name + ':' + (row.ok && row.remaining === 0 ? `解散（移除${row.removed}人）` : '失败:' + (row.error || `仍有${row.remaining}人`)));
      if (targetIndex < targets.length - 1) {
        const waitSec = destroyDelayMin + Math.random() * (destroyDelayMax - destroyDelayMin);
        gtStatus.textContent = `已解散 ${targetIndex + 1}/${targets.length}，等待 ${Math.round(waitSec)} 秒…`;
        await sleep(waitSec * 1000);
      }
      }
      gtStatus.textContent = '解散完成：' + results.join(' | ');
      targets.forEach(t => gtSelected.delete(t.id));
      setTimeout(loadGtGroups, 2000);
    };
    // 退出群组（leaveGroup）
    gtLeaveBtn.onclick = async () => {
      const targets = selectedGidList();
      if (!targets.length) { gtStatus.textContent = '请先选择群组'; return; }
      if (!confirm(`确定退出选中的 ${targets.length} 个群组？`)) return;
      const wv = wvMap.get(activeId);
      const leaveDelayMin = Math.max(5, parseInt(gtDestroyDelayMin?.value) || 5);
      const leaveDelayMax = Math.max(leaveDelayMin, parseInt(gtDestroyDelayMax?.value) || 10);
      gtStatus.textContent = '正在退出…';
      const results = [];
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
        const t = targets[targetIndex];
        const gid = t.id;
      const res = await wv.executeJavaScript(`(async () => {
        try {
          const W = window.WAPLUS_WPP || window.WPP, gid = ${JSON.stringify(gid)};
          await W.group.leave(gid);
          await new Promise(r => setTimeout(r, 1500));
          const meta = window.require('WAWebGroupMetadataCollection').get(gid);
          return JSON.stringify({ ok: true, remaining: meta?.participants?.length ?? 0 });
        } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
      })()`);
      let row; try { row = JSON.parse(String(res)); } catch (e) { row = { ok: false, error: '返回无法解析' }; }
      results.push(t.name + ':' + (row.ok && row.remaining === 0 ? '退出' : '失败:' + (row.error || `仍有${row.remaining}人`)));
      if (targetIndex < targets.length - 1) {
        const waitSec = leaveDelayMin + Math.random() * (leaveDelayMax - leaveDelayMin);
        gtStatus.textContent = `已退出 ${targetIndex + 1}/${targets.length}，等待 ${Math.round(waitSec)} 秒…`;
        await sleep(waitSec * 1000);
      }
      }
      gtStatus.textContent = '退出完成：' + results.join(' | ');
      targets.forEach(t => gtSelected.delete(t.id));
      setTimeout(loadGtGroups, 2000);
    };
    // 统一链接（获取/保存/删除——原版 linkunicoparagrupos）
    let savedGroupLinks = JSON.parse(localStorage.getItem('groupLinks') || '[]');
    const gtGetLinkBtn = document.getElementById('gt-getlink');
    const gtLinkBox = document.getElementById('gt-link-box');
    const gtLinkVal = document.getElementById('gt-link-val');
    const gtSaveLinkBtn = document.getElementById('gt-save-link');
    const gtLinksList = document.getElementById('gt-links-list');
    function renderGroupLinks() {
      if (!gtLinksList) return;
      if (!savedGroupLinks.length) { gtLinksList.innerHTML = '<div style="font-size:12px;color:var(--text-tertiary)">统一链接列表为空——获取群链接后保存到这里</div>'; return; }
      gtLinksList.innerHTML = savedGroupLinks.map((l, i) => `<div style="display:flex;gap:6px;align-items:center;padding:3px 0;font-size:12px;color:var(--text-secondary)">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${l.link}">${l.name || l.link}</span>
        <button class="gt-link-del" data-i="${i}" style="border:none;background:none;color:#e74c3c;cursor:pointer;font-size:12px">✕</button>
      </div>`).join('');
      gtLinksList.querySelectorAll('.gt-link-del').forEach(b => b.onclick = () => {
        savedGroupLinks.splice(parseInt(b.dataset.i), 1);
        localStorage.setItem('groupLinks', JSON.stringify(savedGroupLinks));
        renderGroupLinks();
      });
    }
    renderGroupLinks();
    if (gtGetLinkBtn) gtGetLinkBtn.onclick = async () => {
      const targets = selectedGidList();
      if (!targets.length) { gtStatus.textContent = '请先选择群组'; return; }
      const wv = wvMap.get(activeId);
      const linkDelayMin = Math.max(5, parseInt(document.getElementById('gt-links-min')?.value) || 5);
      const linkDelayMax = Math.max(linkDelayMin, parseInt(document.getElementById('gt-links-max')?.value) || 10);
      gtStatus.textContent = '正在获取群链接…';
      const results = [];
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
        const t = targets[targetIndex];
        const gid = t.id;
      const res = await wv.executeJavaScript(`(async () => {
        try {
          const W = window.WAPLUS_WPP || window.WPP;
          // 走 WPP 封装：ensureGroup + iAmAdmin + queryGroupInviteCode(wid, isAdmin)
          // （旧版页面直接调 queryGroupInviteCode(wid) 缺第二个参数会崩 "reading iAmAdmin"）
          const code = await W.group.getInviteCode(${JSON.stringify(gid)});
          return 'OK:' + String(code || '');
        } catch (e) { return 'ERR:' + e.message; }
      })()`);
      const txt = String(res || '');
      results.push(t.name + ':' + (txt.startsWith('OK:') ? 'OK' : '失败'));
      if (txt.startsWith('OK:')) { window.__curGroupLink = 'https://chat.whatsapp.com/' + txt.slice(3); window.__curGroupName = t.name; if (gtLinkVal) gtLinkVal.textContent = window.__curGroupLink; if (gtLinkBox) gtLinkBox.style.display = ''; }
      if (targetIndex < targets.length - 1) {
        const waitSec = linkDelayMin + Math.random() * (linkDelayMax - linkDelayMin);
        gtStatus.textContent = `已获取 ${targetIndex + 1}/${targets.length}，等待 ${Math.round(waitSec)} 秒…`;
        await sleep(waitSec * 1000);
      }
      }
      gtStatus.textContent = '获取链接：' + results.join(' | ');
    };
    if (gtSaveLinkBtn) gtSaveLinkBtn.onclick = () => {
      if (!window.__curGroupLink) { gtStatus.textContent = '请先获取链接'; return; }
      const name = window.__curGroupName || '群组';
      savedGroupLinks.push({ name, link: window.__curGroupLink });
      localStorage.setItem('groupLinks', JSON.stringify(savedGroupLinks));
      renderGroupLinks();
      if (gtLinkBox) gtLinkBox.style.display = 'none';
      gtStatus.textContent = '已保存到统一链接';
    };
    // Tab 切换（原版 nav-pills；群组选择仅在需要的页面出现）
    const gtSharedSelector = document.getElementById('gt-shared-selector');
    const syncGtSelectorVisibility = (tabName) => {
      if (!gtSharedSelector) return;
      const show = tabName === 'gtedit' || tabName === 'gtdestroy';
      gtSharedSelector.classList.toggle('hidden', !show);
    };
    document.querySelectorAll('.gt-tab').forEach(tab => tab.onclick = () => {
      document.querySelectorAll('.gt-tab').forEach(t => t.classList.remove('gt-tab-active'));
      tab.classList.add('gt-tab-active');
      document.querySelectorAll('.gt-pane').forEach(p => p.classList.add('hidden'));
      const pane = document.getElementById('pane-' + tab.dataset.tab);
      if (pane) pane.classList.remove('hidden');
      syncGtSelectorVisibility(tab.dataset.tab);
    });
    syncGtSelectorVisibility('gtsettings');
    const gtCloneCountValue = document.getElementById('gt-clone-count-value');
    if (gtCloneCount && gtCloneCountValue) {
      gtCloneCountValue.value = gtCloneCount.value;
      gtCloneCount.oninput = () => { gtCloneCountValue.value = gtCloneCount.value; gtCloneCountValue.textContent = gtCloneCount.value; };
    }
    const gtAdvancedClone = document.querySelector('.gt-original-advanced');
    if (gtAdvancedClone && gtSharedSelector) gtAdvancedClone.ontoggle = () => {
      const cloneTabActive = document.querySelector('.gt-tab.gt-tab-active')?.dataset.tab === 'gtclone';
      gtSharedSelector.classList.toggle('hidden', !(cloneTabActive && gtAdvancedClone.open));
    };
    // 聊天设置（localStorage——自动删群/自动加群）
    const gtAutoDelRemoved = document.getElementById('gt-auto-del-removed');
    const gtAutoDelLeft = document.getElementById('gt-auto-del-left');
    const gtAutoJoinLinks = document.getElementById('gt-auto-join-links');
    const gtSettingsSave = document.getElementById('gt-settings-save');
    const gtAutoCfg = JSON.parse(localStorage.getItem('gtAutoCfg') || '{}');
    if (gtAutoDelRemoved) gtAutoDelRemoved.checked = !!gtAutoCfg.delRemoved;
    if (gtAutoDelLeft) gtAutoDelLeft.checked = !!gtAutoCfg.delLeft;
    if (gtAutoJoinLinks) gtAutoJoinLinks.checked = !!gtAutoCfg.joinLinks;
    if (gtSettingsSave) gtSettingsSave.onclick = () => {
      localStorage.setItem('gtAutoCfg', JSON.stringify({ delRemoved: gtAutoDelRemoved.checked, delLeft: gtAutoDelLeft.checked, joinLinks: gtAutoJoinLinks.checked }));
      syncGtCfgToWebview(wvMap.get(activeId));
      gtStatus.textContent = '自动管理设置已保存（监听已生效）';
    };
    // 指令设置（localStorage）
    const gtCmdAdminOnly = document.getElementById('gt-cmd-adminonly');
    const gtCmdDelMsg = document.getElementById('gt-cmd-delmsg');
    const gtCmdSave = document.getElementById('gt-cmd-save');
    const gtCmdCfg = JSON.parse(localStorage.getItem('gtCmdCfg') || '{}');
    if (gtCmdAdminOnly) gtCmdAdminOnly.checked = gtCmdCfg.adminOnly !== false;
    if (gtCmdDelMsg) gtCmdDelMsg.checked = !!gtCmdCfg.delMsg;
    // 指令名回显（原版默认 ban/adm/deadm/infog/tagall）
    const gtCmdNamesStored = JSON.parse(localStorage.getItem('gtCmdNames') || '{}');
    const nameDefaults = { cmdban: 'ban', cmdadm: 'adm', cmddeadm: 'deadm', cmdinfo: 'infog', cmdtagall: 'tagall' };
    Object.entries(nameDefaults).forEach(([k, def]) => {
      const el = document.getElementById('gt-cmdname-' + k.replace('cmd', ''));
      if (el) el.value = gtCmdNamesStored[k] || def;
    });
    if (gtCmdSave) gtCmdSave.onclick = () => {
      localStorage.setItem('gtCmdCfg', JSON.stringify({ adminOnly: gtCmdAdminOnly.checked, delMsg: gtCmdDelMsg.checked }));
      const names = {
        cmdban: (document.getElementById('gt-cmdname-ban') || {}).value || 'ban',
        cmdadm: (document.getElementById('gt-cmdname-adm') || {}).value || 'adm',
        cmddeadm: (document.getElementById('gt-cmdname-deadm') || {}).value || 'deadm',
        cmdinfo: (document.getElementById('gt-cmdname-info') || {}).value || 'infog',
        cmdtagall: (document.getElementById('gt-cmdname-tagall') || {}).value || 'tagall'
      };
      localStorage.setItem('gtCmdNames', JSON.stringify(names));
      syncGtCfgToWebview(wvMap.get(activeId));
      gtStatus.textContent = '指令设置已保存（监听已生效）';
    };
    // 输入链接（批量加群——joinGroupViaInvite）
    const gtLinksInput = document.getElementById('gt-links-input');
    const gtLinksMin = document.getElementById('gt-links-min');
    const gtLinksMax = document.getElementById('gt-links-max');
    const gtLinksJoin = document.getElementById('gt-links-join');
    const gtLinksStatus = document.getElementById('gt-links-status');
    if (gtLinksJoin) gtLinksJoin.onclick = async () => {
      const links = (gtLinksInput.value || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
      if (!links.length) { gtLinksStatus.textContent = '请先粘贴群链接'; return; }
      const lo = Math.max(5, parseInt(gtLinksMin.value) || 5), hi = Math.max(lo, parseInt(gtLinksMax.value) || 10);
      const wv = wvMap.get(activeId);
      gtLinksStatus.textContent = `正在加入 ${links.length} 个群组…`;
      let ok = 0, fail = 0;
      for (let i = 0; i < links.length; i++) {
        const path = links[i].replace(/^https?:\/\/(chat\.)?whatsapp\.com\//, '').trim();
        gtLinksStatus.textContent = `加入中 ${i + 1}/${links.length}…`;
        const res = await wv.executeJavaScript(`(async () => {
          try { await window.require('WAWebGroupInviteAction').joinGroupViaInvite(${JSON.stringify(path)}); return 'OK'; }
          catch (e) { return 'ERR:' + e.message; }
        })()`);
        if (String(res) === 'OK') ok++; else fail++;
        if (i < links.length - 1) {
          const waitSec = lo + Math.random() * (hi - lo);
          gtLinksStatus.textContent = `已处理 ${i + 1}/${links.length}，等待 ${Math.round(waitSec)} 秒…`;
          await new Promise(r => setTimeout(r, waitSec * 1000));
        }
      }
      gtLinksStatus.textContent = `完成：成功 ${ok}，失败 ${fail}`;
    };
    // 底部账号信息 + 关闭
    const gtAccountName = document.getElementById('gt-account-name');
    const gtAccountId = document.getElementById('gt-account-id');
    const gtCloseBottom = document.getElementById('gt-close-bottom');
    if (gtCloseBottom) gtCloseBottom.onclick = () => gtOverlay.classList.add('hidden');
    function updateGtAccount() {
      const acc = accounts.find(a => a.id === activeId);
      if (gtAccountName) gtAccountName.textContent = acc ? acc.name : '—';
      if (gtAccountId) gtAccountId.textContent = acc ? (acc.type || '') : '—';
    }
    updateGtAccount();
    // 编辑群组（名称/简介/头像/权限/添加成员——原版级）
    const gtEditBtn = document.getElementById('gt-edit');
    const gtEditPanel = document.getElementById('gt-edit-panel');
    const gtEditSubject = document.getElementById('gt-edit-subject');
    const gtEditDesc = document.getElementById('gt-edit-desc');
    const gtEditPic = document.getElementById('gt-edit-pic');
    const gtPicName = document.getElementById('gt-pic-name');
    const gtEditRestrict = document.getElementById('gt-edit-restrict'); // announce：仅管理员发言
    const gtEditAdminedit = document.getElementById('gt-edit-adminedit'); // restrict=true：仅管理员编辑资料
    const gtEditAllEdit = document.getElementById('gt-edit-alledit'); // restrict=false：全体编辑资料
    const gtEditAllTalk = document.getElementById('gt-edit-alltalk'); // announcement=false：全体发言
    const gtEditMember = document.getElementById('gt-edit-member');
    const gtEditMemadmin = document.getElementById('gt-edit-memadmin');
    const gtEditDelayMin = document.getElementById('gt-edit-delay-min');
    const gtEditDelayMax = document.getElementById('gt-edit-delay-max');
    const gtEditSave = document.getElementById('gt-edit-save');
    let gtPicData = null; // 选中的头像（dataURL）
    if (gtEditRestrict && gtEditAllTalk) {
      gtEditRestrict.onchange = () => { if (gtEditRestrict.checked) gtEditAllTalk.checked = false; };
      gtEditAllTalk.onchange = () => { if (gtEditAllTalk.checked) gtEditRestrict.checked = false; };
    }
    if (gtEditAdminedit && gtEditAllEdit) {
      gtEditAdminedit.onchange = () => { if (gtEditAdminedit.checked) gtEditAllEdit.checked = false; };
      gtEditAllEdit.onchange = () => { if (gtEditAllEdit.checked) gtEditAdminedit.checked = false; };
    }
    if (gtEditPic) gtEditPic.onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.onchange = () => {
        const f = inp.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => { gtPicData = rd.result; if (gtPicName) gtPicName.textContent = f.name + '（' + Math.round(f.size / 1024) + 'KB）'; };
        rd.readAsDataURL(f);
      };
      inp.click();
    };
    if (gtEditSave) gtEditSave.onclick = async () => {
      const targets = selectedGidList();
      if (!targets.length) { gtStatus.textContent = '请先选择群组'; return; }
      const subject = gtEditSubject.value.trim();
      const desc = gtEditDesc.value.trim();
      const onlyAdminTalk = gtEditRestrict.checked;
      const onlyAdminEdit = gtEditAdminedit.checked;
      const allEdit = !!gtEditAllEdit?.checked;
      const allTalk = !!gtEditAllTalk?.checked;
      const members = gtEditMember.value.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean);
      const memadmin = gtEditMemadmin.checked;
      const editDelayMin = Math.max(5, parseInt(gtEditDelayMin?.value) || 5);
      const editDelayMax = Math.max(editDelayMin, parseInt(gtEditDelayMax?.value) || 10);
      if (!subject && !desc && !gtPicData && !onlyAdminTalk && !onlyAdminEdit && !allEdit && !allTalk && !members.length) { gtStatus.textContent = '请至少填写一项修改'; return; }
      const wv = wvMap.get(activeId);
      gtStatus.textContent = '正在保存…';
      const picData = gtPicData || '';
      const results = [];
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
        const t = targets[targetIndex];
        const gid = t.id;
      const res = await wv.executeJavaScript(`(async () => {
        try {
          const M = window.require('WAWebGroupModifyInfoJob');
          const Pic = window.require('WAWebContactProfilePicThumbBridge');
          const W = window.WAPLUS_WPP || window.WPP;
          const chats = await W.chat.list();
          const chat = chats.find(c => String(c.id) === ${JSON.stringify(gid)});
          const wid = chat ? chat.id : window.require('WAWebWidFactory').createWid(${JSON.stringify(gid)});
          const out = [];
          if (${JSON.stringify(subject)}) { await M.setGroupSubject(wid, ${JSON.stringify(subject)}); out.push('名称'); }
          if (${JSON.stringify(desc)}) { await M.setGroupDescription(wid, ${JSON.stringify(desc)}, '${Date.now()}', void 0).catch(()=>{}); out.push('简介'); }
          if (${JSON.stringify(picData)}) {
            try {
              const dataUrl = ${JSON.stringify(picData)};
              const makeSquare = (size) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => { const side = Math.min(img.width, img.height), sx = (img.width - side) / 2, sy = (img.height - side) / 2, canvas = document.createElement('canvas'); canvas.width = canvas.height = size; canvas.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, size, size); resolve(canvas.toDataURL('image/jpeg', .92)); }; img.onerror = () => reject(new Error('头像图片解码失败')); img.src = dataUrl; });
              const thumb = await makeSquare(96), full = await makeSquare(640);
              const picWid = window.require('WAWebWidFactory').createWid(${JSON.stringify(gid)});
              await Pic.sendSetPicture(picWid, thumb, full);
              out.push('头像');
            } catch (e) { throw new Error('头像:' + e.message); }
          }
          if (${JSON.stringify(onlyAdminEdit)}) { await W.group.setProperty(${JSON.stringify(gid)}, 'restrict', true); out.push('仅管理员编辑资料'); }
          if (${JSON.stringify(allEdit)}) { await W.group.setProperty(${JSON.stringify(gid)}, 'restrict', false); out.push('全体成员编辑资料'); }
          if (${JSON.stringify(onlyAdminTalk)}) { await W.group.setProperty(${JSON.stringify(gid)}, 'announcement', true); out.push('仅管理员发消息'); }
          if (${JSON.stringify(allTalk)}) { await W.group.setProperty(${JSON.stringify(gid)}, 'announcement', false); out.push('全体成员发消息'); }
          if (${JSON.stringify(members)}.length) {
            const ids = ${JSON.stringify(members)}.map(n => n.includes('@') ? n : n.replace(/[^0-9]/g, '') + '@c.us').filter(n => n && !n.startsWith('@'));
            const added = await W.group.addParticipants(${JSON.stringify(gid)}, ids);
            const direct = [];
            for (const id of ids) {
              const row = added?.[id] || Object.values(added || {}).find(x => String(x?.wid) === id);
              if (row?.code === 200) direct.push(id);
              else if (row?.invite_code) out.push('需邀请:' + id.split('@')[0]);
              else if (row?.code === 409) direct.push(id);
              else out.push('成员失败:' + id.split('@')[0] + '(' + (row?.code ?? '无返回') + ')');
            }
            if (${JSON.stringify(memadmin)} && direct.length) { await W.group.promoteParticipants(${JSON.stringify(gid)}, direct); out.push('设管理员' + direct.length + '人'); }
            else if (direct.length) out.push('添加成员' + direct.length + '人');
          }
          return 'OK:' + (out.join('、') || '无变化');
        } catch (e) { return 'ERR:' + e.message; }
      })()`);
      results.push(t.name + ':' + (String(res).startsWith('OK') ? String(res).slice(3) : '失败:' + String(res).replace(/^ERR:/, '')));
      if (targetIndex < targets.length - 1) {
        const waitSec = editDelayMin + Math.random() * (editDelayMax - editDelayMin);
        gtStatus.textContent = `已编辑 ${targetIndex + 1}/${targets.length}，等待 ${Math.round(waitSec)} 秒…`;
        await sleep(waitSec * 1000);
      }
      }
      gtStatus.textContent = '保存完成：' + results.join(' | ');
      gtEditSubject.value = ''; gtEditDesc.value = ''; gtEditMember.value = ''; gtPicData = null; gtPicName.textContent = '';
      gtEditRestrict.checked = false; gtEditAdminedit.checked = false; if (gtEditAllEdit) gtEditAllEdit.checked = false; if (gtEditAllTalk) gtEditAllTalk.checked = false; gtEditMemadmin.checked = false;
      setTimeout(loadGtGroups, 2000);
    };
  }
  const bcMenuExport = document.getElementById('bc-menu-export');
  if (bcMenuExport) bcMenuExport.onclick = async () => {
    document.getElementById('broadcast-menu')?.classList.add('hidden');
    const account = accounts.find(a => a.id === activeId);
    const wv = wvMap.get(activeId);
    if (!account || !wv) { alert('请先切换到一个账号'); return; }
    try {
      const contacts = await wv.executeJavaScript(`(async () => {
        try {
          const W = window.WAPLUS_WPP || window.WPP;
          const chats = await W.chat.list();
          return JSON.stringify(chats.filter(c => !c.isGroup && c.name).map(c => ({ id: c.id, name: c.name, number: (c.id || '').replace('@c.us', '').replace('@lid', '') })));
        } catch (e) { return 'ERR:' + e.message; }
      })()`);
      const txt = String(contacts || '');
      if (txt.startsWith('ERR:')) { alert('导出失败: ' + txt); return; }
      const list = JSON.parse(txt);
      const csv = '\uFEFF姓名,号码\n' + list.map(c => `"${(c.name || '').replace(/"/g, '""')}","${c.number || ''}"`).join('\n');
      const p = await window.api.file.save({ defaultName: '联系人导出.csv', content: csv });
      if (p) alert(`已导出 ${list.length} 个联系人: ${p}`);
    } catch (e) { alert('导出失败: ' + e.message); }
  };
  // 数据报表（发送历史统计）
  const bcMenuReport = document.getElementById('bc-menu-report');
  if (bcMenuReport) bcMenuReport.onclick = () => {
    document.getElementById('broadcast-menu')?.classList.add('hidden');
    const hist = JSON.parse(localStorage.getItem('sendHistory') || '[]');
    const total = hist.reduce((s, h) => s + h.total, 0);
    const ok = hist.reduce((s, h) => s + h.ok, 0);
    const fail = hist.reduce((s, h) => s + h.fail, 0);
    const today = new Date().toDateString();
    const todayCount = hist.filter(h => new Date(h.t).toDateString() === today).reduce((s, h) => s + h.total, 0);
    const days = {};
    hist.forEach(h => { const d = new Date(h.t).toDateString(); days[d] = (days[d] || 0) + h.total; });
    const daily = Object.entries(days).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7);
    const recent = hist.slice(-10).reverse().map(h => {
      const dt = new Date(h.t);
      const pad = n => String(n).padStart(2, '0');
      return `${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())} | 共${h.total} 成功${h.ok} 失败${h.fail}${h.files ? ' | 含文件' : ''}`;
    });
    alert(`📊 数据报表（共 ${hist.length} 次群发）\n\n━━ 总览 ━━\n消息总数：${total}\n成功：${ok}\n失败：${fail}\n成功占比：${total ? Math.round(ok / total * 100) : 0}%\n今日发送：${todayCount}\n\n━━ 最近 7 天 ━━\n${daily.map(([d, n]) => `${d.slice(4)}：${n} 条`).join('\n') || '无数据'}\n\n━━ 最近记录 ━━\n${recent.join('\n') || '暂无'}`);
  };
  const bcMenuBackup = document.getElementById('bc-menu-backup');
  if (bcMenuBackup) bcMenuBackup.onclick = async () => {
    document.getElementById('broadcast-menu')?.classList.add('hidden');
    const action = confirm('导出配置到文件？\n\n确定 = 导出备份文件\n取消 = 导入备份文件');
    if (action) {
      // 导出：所有配置 → JSON → 保存
      const cfg = {
        savedMessages: JSON.parse(localStorage.getItem('savedMessages') || '[]'),
        savedLists: JSON.parse(localStorage.getItem('savedLists') || '[]'),
        broadcastExclude: JSON.parse(localStorage.getItem('broadcastExclude') || '[]'),
        savedGroups: JSON.parse(localStorage.getItem('savedGroups') || '[]'),
        scheduleTasks: JSON.parse(localStorage.getItem('scheduleTasks') || '[]'),
        version: 1
      };
      try {
        const p = await window.api.file.save({ defaultName: '极客配置备份.json', content: JSON.stringify(cfg, null, 2) });
        if (p) alert('配置已导出: ' + p);
      } catch (e) { alert('导出失败: ' + e.message); }
    } else {
      // 导入：选文件 → 读 → 恢复
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json';
      inp.onchange = async () => {
        try {
          const f = inp.files[0];
          const text = await f.text();
          const cfg = JSON.parse(text);
          if (cfg.savedMessages) localStorage.setItem('savedMessages', JSON.stringify(cfg.savedMessages));
          if (cfg.savedLists) localStorage.setItem('savedLists', JSON.stringify(cfg.savedLists));
          if (cfg.broadcastExclude) localStorage.setItem('broadcastExclude', JSON.stringify(cfg.broadcastExclude));
          if (cfg.savedGroups) localStorage.setItem('savedGroups', JSON.stringify(cfg.savedGroups));
          if (cfg.scheduleTasks) localStorage.setItem('scheduleTasks', JSON.stringify(cfg.scheduleTasks));
          alert('配置已导入，重新打开窗口生效');
        } catch (e) { alert('导入失败（文件格式不对）: ' + e.message); }
      };
      inp.click();
    }
  };
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('broadcast-menu');
    if (menu && !menu.classList.contains('hidden') && !menu.contains(e.target) && e.target.id !== 'btn-broadcast') {
      menu.classList.add('hidden');
    }
  });
  document.getElementById('broadcast-close').onclick = closeBroadcast;
  document.getElementById('broadcast-cancel').onclick = closeBroadcast;
  document.getElementById('broadcast-send').onclick = sendBroadcast;
  document.getElementById('broadcast-pause').onclick = () => {
    broadcastPaused = !broadcastPaused;
    document.getElementById('broadcast-pause').textContent = broadcastPaused ? '▶ 继续发送' : '⏸ 暂停发送';
  };
  const stopBtn = document.getElementById('broadcast-stop');
  if (stopBtn) stopBtn.onclick = () => { broadcastStop = true; }; 
  const sendingClose = document.getElementById('broadcast-sending-close');
  if (sendingClose) sendingClose.onclick = closeBroadcast;
  document.getElementById('broadcast-export').onclick = async () => {
    if (!broadcastFailed.length) return;
    const csv = '\uFEFF联系人,失败原因\n' + broadcastFailed.map(f => `"${(f.name || '').replace(/"/g, '""')}","${(f.reason || '').replace(/"/g, '""')}"`).join('\n');
    try {
      const p = await window.api.file.save({ defaultName: '群发失败名单.csv', content: csv });
      if (p) alert('已导出失败名单: ' + p);
    } catch (e) { alert('导出失败: ' + e.message); }
  };
  bSearchEl.addEventListener('input', renderBroadcastList);
  if (bcSelectizeControl && bcSelectizeDropdown) {
    bcSelectizeControl.onclick = () => { bcSelectize.classList.add('open'); bcSelectizeDropdown.classList.remove('hidden'); bSearchEl.focus(); renderBroadcastList(); };
    document.addEventListener('click', e => { if (!bcSelectize?.contains(e.target)) { bcSelectize.classList.remove('open'); bcSelectizeDropdown.classList.add('hidden'); } });
  }
  const savedAccordionToggle = document.getElementById('bc-saved-accordion-toggle');
  if (savedAccordionToggle) savedAccordionToggle.onclick = () => {
    const box = document.getElementById('bc-saved-accordion');
    box.classList.toggle('collapsed');
    const arrow = document.getElementById('bc-saved-accordion-arrow');
    if (arrow) arrow.textContent = box.classList.contains('collapsed') ? '▸' : '▾';
  };
  bOverlay.addEventListener('click', (e) => { if (e.target === bOverlay) closeBroadcast(); });

  // ---------- 锁屏（挂机锁） ----------
  const lockOverlay = document.getElementById('lock-overlay');
  const lockPasswordEl = document.getElementById('lock-password');
  const lockErrorEl = document.getElementById('lock-error');
  let locked = false;
  async function lockScreen() {
    const cfg = await window.api.config.get();
    if (!cfg.lockPassword) {
      alert('请先在 设置 → 锁屏密码 设置密码');
      openSettings();
      return;
    }
    lockPasswordEl.value = '';
    lockErrorEl.classList.add('hidden');
    lockOverlay.classList.remove('hidden');
    locked = true;
    setTimeout(() => lockPasswordEl.focus(), 100);
  }
  async function unlockScreen() {
    const cfg = await window.api.config.get();
    if (lockPasswordEl.value === (cfg.lockPassword || '')) {
      lockOverlay.classList.add('hidden');
      locked = false;
    } else {
      lockErrorEl.classList.remove('hidden');
      lockPasswordEl.value = '';
      lockPasswordEl.focus();
    }
  }
  document.getElementById('lock-unlock').onclick = unlockScreen;
  lockPasswordEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') unlockScreen();
  });
  // 锁屏时拦截关闭/最小化？不拦——保持后台运行收消息（挂机锁语义）
  // 窗口控制（无边框自绘）
  document.getElementById('btn-win-min').onclick = () => window.api.window.minimize();
  document.getElementById('btn-win-max').onclick = () => window.api.window.maximize();
  document.getElementById('btn-win-close').onclick = () => window.api.window.close();

  // ---------- 设置面板 ----------
  function openSettings() {
    loadSettingsForm();
    settingsOverlay.classList.remove('hidden');
  }
  function closeSettings() {
    settingsOverlay.classList.add('hidden');
  }

  document.getElementById('settings-close').onclick = closeSettings;
  document.getElementById('settings-cancel').onclick = closeSettings;
  settingsOverlay.onclick = (e) => {
    if (e.target === settingsOverlay) closeSettings();
  };

  settingsTabs.forEach((tab) => {
    tab.onclick = () => {
      settingsTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      settingsGlobal.classList.toggle('hidden', which !== 'global');
      settingsAccount.classList.toggle('hidden', which !== 'account');
    };
  });

  accSelect.onchange = loadAccountSettingsForm;

  async function loadSettingsForm() {
    config = await window.api.config.get();
    applyTheme(config.theme, config.accent);
    document.getElementById('cfg-theme').value = config.theme || 'dark';
    document.getElementById('cfg-accent').value = config.accent || 'green';
    document.getElementById('cfg-autoLaunch').checked = !!config.autoLaunch;
    document.getElementById('cfg-isStartupMinimize').checked = !!config.isStartupMinimize;
    document.getElementById('cfg-messageSound').checked = !!config.messageSound;
    document.getElementById('cfg-lockPassword').value = config.lockPassword || '';
    document.getElementById('cfg-openProxy').checked = !!config.openProxy;
    document.getElementById('cfg-protocal').value = config.protocal || 'http';
    document.getElementById('cfg-host').value = config.host || '';
    document.getElementById('cfg-port').value = config.port || '';
    document.getElementById('cfg-login').value = config.login || '';
    document.getElementById('cfg-password').value = config.password || '';

    accSelect.innerHTML = '';
    accounts.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = `${a.name} (${(a.type === 'telegram-z' || a.type === 'telegram-k') ? 'TG' : 'WA'})`;
      accSelect.appendChild(opt);
    });
    if (activeId) accSelect.value = activeId;
    loadAccountSettingsForm();
  }

  function loadAccountSettingsForm() {
    const account = accounts.find(a => a.id === accSelect.value);
    if (!account) return;
    document.getElementById('acc-name').value = account.name || '';
    document.getElementById('acc-fontSize').value = account.fontSize || 16;
    document.getElementById('acc-fontColor').value = account.fontColor || '#18A058';
    document.getElementById('acc-openProxy').checked = !!account.openProxy;
    document.getElementById('acc-host').value = account.host || '';
    document.getElementById('acc-port').value = account.port || '';
    document.getElementById('acc-huser').value = account.huser || '';
    document.getElementById('acc-hpwd').value = account.hpwd || '';
  }

  document.getElementById('settings-save').onclick = async () => {
    try {
      const configPatch = {
        theme: document.getElementById('cfg-theme').value,
        accent: document.getElementById('cfg-accent').value,
        autoLaunch: document.getElementById('cfg-autoLaunch').checked,
        isStartupMinimize: document.getElementById('cfg-isStartupMinimize').checked,
        messageSound: document.getElementById('cfg-messageSound').checked,
        lockPassword: document.getElementById('cfg-lockPassword').value,
        openProxy: document.getElementById('cfg-openProxy').checked,
        protocal: document.getElementById('cfg-protocal').value,
        host: document.getElementById('cfg-host').value.trim(),
        port: document.getElementById('cfg-port').value.trim(),
        login: document.getElementById('cfg-login').value.trim(),
        password: document.getElementById('cfg-password').value
      };
      await window.api.config.set(configPatch);

      const accountId = accSelect.value;
      if (accountId) {
        const accountPatch = {
          name: document.getElementById('acc-name').value.trim(),
          fontSize: parseInt(document.getElementById('acc-fontSize').value, 10),
          fontColor: document.getElementById('acc-fontColor').value,
          openProxy: document.getElementById('acc-openProxy').checked,
          host: document.getElementById('acc-host').value.trim(),
          port: document.getElementById('acc-port').value.trim(),
          huser: document.getElementById('acc-huser').value.trim(),
          hpwd: document.getElementById('acc-hpwd').value
        };
        await window.api.accounts.update(accountId, accountPatch);
      }

      await loadAccounts();
      applyTheme(configPatch.theme, configPatch.accent); // 保存后立即换主题
      closeSettings();
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  };

  // ---------- 加载账号 ----------
  async function loadAccounts() {
    const r = await window.api.accounts.list();
    accounts = r?.accounts || r || [];
    activeId = r?.activeAccountId || activeId;
    // 初始化当前平台（从当前账号推断；无账号时为 null）
    if (activeId && accounts.some(a => a.id === activeId)) {
      activePlatform = familyOf(accounts.find(a => a.id === activeId).type).key;
    } else if (accounts.length) {
      activePlatform = familyOf(accounts[0].type).key;
    }
    // 清理已删除账号的 webview
    const ids = new Set(accounts.map(a => a.id));
    for (const [id, wv] of wvMap) {
      if (!ids.has(id)) { wv.remove(); wvMap.delete(id); }
    }
    renderSidebar();
    renderTabs();
    if (accounts.length) {
      // 原版多开模型：所有账号的 webview 全部常驻（同时在线收消息），
      // 切换只是显隐。逐个创建（不等待加载完成），避免启动阻塞。
      for (const a of accounts) {
        try { getWebview(a); } catch (err) { console.error('创建 webview 失败', a.id, err); }
      }
      const targetId = activeId && accounts.some(a => a.id === activeId)
        ? activeId
        : accounts[0].id;
      await switchAccount(targetId);
    } else {
      activeId = null;
      emptyState.style.display = 'flex';
    }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 主题应用 ----------
  const ACCENTS = ['green', 'blue', 'purple', 'cyan', 'orange', 'pink'];
  let currentThemeSetting = 'system';
  let systemTheme = 'dark';
  function applyTheme(theme, accent) {
    currentThemeSetting = ['system', 'dark', 'light'].includes(theme) ? theme : 'system';
    // 跟随系统：用系统当前深浅色；否则用用户选择
    const effective = currentThemeSetting === 'system' ? systemTheme : currentThemeSetting;
    document.documentElement.dataset.theme = effective === 'light' ? 'light' : 'dark';
    // accent 传 null/undefined 时保留当前强调色（系统主题变化只切深浅）
    const curAccent = document.documentElement.dataset.accent || 'green';
    document.documentElement.dataset.accent = (accent != null && ACCENTS.includes(accent)) ? accent : curAccent;
  }

  window.addEventListener('resize', resizeWebviews);

  // 定时兜底扫描未读：title 事件在启动时（页面已带未读）不触发，每 5s 扫一遍
  // 所有平台：title 数字 + DOM 未读徽章（LINE/TG 的 title 常不带数字，必须扫 DOM）
  setInterval(() => {
    wvMap.forEach((wv, id) => {
      try {
        const account = accounts.find(a => a.id === id);
        if (!account) return;
        const title = wv.getTitle ? wv.getTitle() : '';
        const m = title.match(/^[(\[（]\s*(\d+)\s*[)\]\）]/);
        const titleUnread = m ? parseInt(m[1], 10) : 0;
        wv.executeJavaScript(`(() => {
          try {
            // 精准未读徽章：badge/unread 类 + 纯数字文本（排除 count/mention 等误报类）
            const els = document.querySelectorAll('[class*="unread"], [class*="Unread"], .badge, .Badge, [class*="badge"], [class*="Badge"]');
            let total = 0;
            els.forEach(el => {
              const txt = (el.textContent || '').trim();
              if (!/^\\d{1,3}$/.test(txt)) return; // 只认纯数字（时间戳/计数不误报）
              const t = parseInt(txt, 10);
              if (!isNaN(t) && t > 0) total += t;
            });
            return String(total);
          } catch (e) { return '0'; }
        })()`).then((res) => {
          const domUnread = parseInt(String(res), 10) || 0;
          updateUnread(id, Math.max(titleUnread, domUnread));
        }).catch(() => updateUnread(id, titleUnread));
      } catch (e) { /* ignore */ }
    });
  }, 5000);

  // Line 扩展就绪后重载对应 webview（原版 onPluginInstalled 模式）
  const lineReadyPartitions = new Set();
  window.api.line.onExtensionReady((partition) => {
    let found = false;
    for (const [id, wv] of wvMap) {
      if (wv.partition === partition) {
        found = true;
        setTimeout(() => {
          try { wv.reloadIgnoringCache(); } catch (err) { console.error('reload line webview 失败', err); }
        }, 300);
        break;
      }
    }
    if (!found) lineReadyPartitions.add(partition); // webview 还没创建，待创建后 reload
  });

  (async () => {
    try {
      const initCfg = await window.api.config.get();
      config = initCfg; // 启动即初始化（设置/群发预设都要用）
      // 读取系统深浅色（跟随系统用）
      try { systemTheme = await window.api.theme.getSystem(); } catch (e) {}
      applyTheme(initCfg.theme, initCfg.accent); // 启动时应用主题
      // 系统深浅色变化 → 自动跟随
      try {
        window.api.theme.onSystemChanged((t) => {
          systemTheme = t === 'light' ? 'light' : 'dark';
          if (currentThemeSetting === 'system') applyTheme('system', null);
        });
      } catch (e) { /* 监听失败不影响 */ }
    } catch (e) { /* 主题应用失败不影响 */ }
    try { await loadPlatforms(); } catch (e) { console.error('加载平台列表失败', e); }
    await loadAccounts();
  })();
})();
