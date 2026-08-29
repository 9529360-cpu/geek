(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekAdvancedToolsWorkbench = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const BACKUP_SCHEMA = 'geek-account-settings';
  const BACKUP_VERSION = 2;
  const SAFE_BACKUP_KEYS = Object.freeze([
    'savedMessages',
    'savedLists',
    'broadcastExclude',
    'broadcastExcludeContacts',
    'broadcastExcludeGroups',
    'broadcastGroups',
    'savedGroups',
    'groupLinks',
    'gtAutoCfg',
    'gtCmdCfg',
    'gtCmdNames',
    'translationGlobal',
    'translationChats',
  ]);
  const LEGACY_EXECUTION_KEYS = Object.freeze(['scheduleTasks', 'broadcastJobSchedules']);
  let installed = false;

  function parseJson(raw, fallback) {
    if (raw == null || raw === '') return fallback;
    if (typeof raw !== 'string') return raw;
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  function csvCell(value) {
    const text = String(value == null ? '' : value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function activeAccountId(doc = document) {
    return String(doc.querySelector('.nav-account.active[data-id]')?.dataset.id || '');
  }

  async function activeContext(doc = document) {
    const accountId = activeAccountId(doc);
    if (!accountId) throw new Error('请先选择账号');
    const listed = await window.api.accounts.list();
    const accounts = listed?.accounts || listed || [];
    const account = accounts.find(item => String(item.id) === accountId);
    if (!account) throw new Error('当前账号不存在或已移除');
    const webview = [...doc.querySelectorAll('webview')].find(wv =>
      String(wv.partition || wv.getAttribute?.('partition') || '') === String(account.partition || '')
    ) || null;
    return { accountId, account, webview };
  }

  function buildBackupRecord(data, account = {}, now = Date.now()) {
    const payload = {};
    for (const key of SAFE_BACKUP_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(data || {}, key)) continue;
      const parsed = parseJson(data[key], undefined);
      if (parsed !== undefined) payload[key] = parsed;
    }
    return {
      schema: BACKUP_SCHEMA,
      version: BACKUP_VERSION,
      exportedAt: new Date(now).toISOString(),
      account: {
        name: String(account.name || ''),
        type: String(account.type || ''),
      },
      data: payload,
      excludes: ['sendHistory', ...LEGACY_EXECUTION_KEYS],
    };
  }

  function normalizeBackupRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('备份文件格式无效');
    const source = record.schema === BACKUP_SCHEMA && Number(record.version) >= 2
      ? (record.data && typeof record.data === 'object' ? record.data : {})
      : record;
    const entries = [];
    for (const key of SAFE_BACKUP_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      const encoded = JSON.stringify(source[key]);
      if (typeof encoded !== 'string' || BufferByteLength(encoded) > 2 * 1024 * 1024) {
        throw new Error(`备份项目过大或无效：${key}`);
      }
      entries.push([key, encoded]);
    }
    const ignoredExecutionKeys = LEGACY_EXECUTION_KEYS.filter(key => Object.prototype.hasOwnProperty.call(source, key));
    if (!entries.length) throw new Error('备份中没有可恢复的账号设置');
    return { entries, ignoredExecutionKeys };
  }

  function BufferByteLength(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(String(text)).length;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(String(text), 'utf8');
    return unescape(encodeURIComponent(String(text))).length;
  }

  async function restoreBackup(accountId, record) {
    const normalized = normalizeBackupRecord(record);
    const before = await window.api.accountData.getAll(accountId);
    const written = [];
    try {
      for (const [key, value] of normalized.entries) {
        await window.api.accountData.set(accountId, key, value);
        written.push(key);
      }
      return { restored: written.length, ignoredExecutionKeys: normalized.ignoredExecutionKeys };
    } catch (error) {
      for (const key of written.reverse()) {
        try {
          if (Object.prototype.hasOwnProperty.call(before || {}, key)) await window.api.accountData.set(accountId, key, String(before[key]));
          else await window.api.accountData.remove(accountId, key);
        } catch (_) {}
      }
      throw error;
    }
  }

  function normalizeHistory(raw) {
    const history = parseJson(raw, []);
    return (Array.isArray(history) ? history : []).map(item => ({
      t: Number(item?.t) || 0,
      total: Math.max(0, Number(item?.total) || 0),
      ok: Math.max(0, Number(item?.ok) || 0),
      fail: Math.max(0, Number(item?.fail) || 0),
      files: Math.max(0, Number(item?.files) || 0),
      msgLen: Math.max(0, Number(item?.msgLen) || 0),
      jobId: String(item?.jobId || ''),
    })).filter(item => item.t > 0);
  }

  function summarizeHistory(value) {
    const rows = Array.isArray(value) ? value : normalizeHistory(value);
    return rows.reduce((sum, row) => ({
      jobs: sum.jobs + 1,
      total: sum.total + row.total,
      ok: sum.ok + row.ok,
      fail: sum.fail + row.fail,
      files: sum.files + row.files,
    }), { jobs: 0, total: 0, ok: 0, fail: 0, files: 0 });
  }

  function isGroupChat(chat) {
    return chat?.isGroup === true || ['群组', 'group'].includes(String(chat?.type || '').toLowerCase());
  }

  function ensureStyles(doc = document) {
    if (doc.getElementById('advanced-tools-workbench-style')) return;
    const style = doc.createElement('style');
    style.id = 'advanced-tools-workbench-style';
    style.textContent = `
      #advanced-tools-overlay{z-index:1200}
      #advanced-tools-overlay .at-dialog{width:min(760px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:hidden;border:1px solid var(--border-standard);border-radius:14px;background:var(--bg-surface);box-shadow:0 24px 72px rgba(0,0,0,.36)}
      #advanced-tools-overlay .at-head{display:flex;align-items:center;gap:12px;min-height:58px;padding:0 18px;border-bottom:1px solid var(--border-standard);background:var(--bg-surface)}
      #advanced-tools-overlay .at-head-copy{flex:1;min-width:0}
      #advanced-tools-overlay .at-head-copy strong{display:block;color:var(--text-primary);font-size:15px}
      #advanced-tools-overlay .at-head-copy small{display:block;margin-top:3px;color:var(--text-tertiary);font-size:11.5px}
      #advanced-tools-overlay .at-close{width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--text-secondary);font-size:20px;cursor:pointer}
      #advanced-tools-overlay .at-close:hover{background:var(--bg-hover);color:var(--text-primary)}
      #advanced-tools-overlay .at-body{max-height:calc(100vh - 148px);overflow:auto;padding:16px 18px}
      #advanced-tools-overlay .at-card{padding:14px;border:1px solid var(--border-standard);border-radius:12px;background:var(--bg-elevated)}
      #advanced-tools-overlay .at-card+.at-card{margin-top:10px}
      #advanced-tools-overlay .at-card-title{margin-bottom:5px;color:var(--text-primary);font-size:13px;font-weight:650}
      #advanced-tools-overlay .at-card-copy{color:var(--text-secondary);font-size:12px;line-height:1.6}
      #advanced-tools-overlay .at-actions{display:flex;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap}
      #advanced-tools-overlay .at-btn{min-height:34px;padding:7px 12px;border:1px solid var(--border-standard);border-radius:9px;background:var(--bg-surface);color:var(--text-primary);font-size:12px;cursor:pointer}
      #advanced-tools-overlay .at-btn:hover{background:var(--bg-hover)}
      #advanced-tools-overlay .at-btn--primary{border-color:color-mix(in srgb,var(--accent) 70%,var(--border-standard));background:var(--accent);color:#fff}
      #advanced-tools-overlay .at-btn:disabled{opacity:.55;cursor:default}
      #advanced-tools-overlay .at-status{min-height:22px;margin-top:10px;color:var(--text-secondary);font-size:11.5px;line-height:1.5}
      #advanced-tools-overlay .at-status[data-state=success]{color:#36a269}
      #advanced-tools-overlay .at-status[data-state=error]{color:#d85c5c}
      #advanced-tools-overlay .at-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px}
      #advanced-tools-overlay .at-stat{padding:12px;border:1px solid var(--border-standard);border-radius:11px;background:var(--bg-elevated)}
      #advanced-tools-overlay .at-stat span{display:block;color:var(--text-tertiary);font-size:10.5px}
      #advanced-tools-overlay .at-stat strong{display:block;margin-top:5px;color:var(--text-primary);font-size:18px}
      #advanced-tools-overlay .at-table-wrap{max-height:320px;overflow:auto;border:1px solid var(--border-standard);border-radius:10px}
      #advanced-tools-overlay table{width:100%;border-collapse:collapse;font-size:11.5px}
      #advanced-tools-overlay th,#advanced-tools-overlay td{padding:8px 10px;border-bottom:1px solid var(--border-subtle);text-align:left;white-space:nowrap}
      #advanced-tools-overlay th{position:sticky;top:0;background:var(--bg-surface);color:var(--text-secondary);font-weight:600}
      #advanced-tools-overlay td{color:var(--text-primary)}
      #advanced-tools-overlay .at-empty{padding:24px;text-align:center;color:var(--text-tertiary);font-size:12px}
      @media(max-width:620px){#advanced-tools-overlay .at-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;
    doc.head.appendChild(style);
  }

  function ensureShell(doc = document) {
    ensureStyles(doc);
    let overlay = doc.getElementById('advanced-tools-overlay');
    if (overlay) return overlay;
    overlay = doc.createElement('div');
    overlay.id = 'advanced-tools-overlay';
    overlay.className = 'overlay hidden';
    overlay.innerHTML = '<div class="at-dialog"><div class="at-head"><div class="at-head-copy"><strong id="at-title"></strong><small id="at-subtitle"></small></div><button type="button" class="at-close" aria-label="关闭">×</button></div><div id="at-body" class="at-body"></div></div>';
    overlay.querySelector('.at-close').onclick = () => overlay.classList.add('hidden');
    overlay.addEventListener('click', event => { if (event.target === overlay) overlay.classList.add('hidden'); });
    doc.body.appendChild(overlay);
    return overlay;
  }

  function openShell(title, subtitle, doc = document) {
    const overlay = ensureShell(doc);
    const titleNode = overlay.querySelector('#at-title');
    const subtitleNode = overlay.querySelector('#at-subtitle');
    const body = overlay.querySelector('#at-body');
    if (titleNode) titleNode.textContent = title;
    if (subtitleNode) subtitleNode.textContent = subtitle;
    body?.replaceChildren();
    overlay.classList.remove('hidden');
    return { overlay, body };
  }

  function addStatus(card, doc = document) {
    const status = doc.createElement('div');
    status.className = 'at-status';
    status.setAttribute('role', 'status');
    card.appendChild(status);
    return status;
  }

  function setStatus(status, text, state = '') {
    if (!status) return;
    status.textContent = text;
    status.dataset.state = state;
  }

  function button(label, primary = false, doc = document) {
    const node = doc.createElement('button');
    node.type = 'button';
    node.className = `at-btn${primary ? ' at-btn--primary' : ''}`;
    node.textContent = label;
    return node;
  }

  async function showContactExport(doc = document) {
    const { body } = openShell('导出联系人', '从当前账号读取可用聊天联系人并导出为本地 CSV，不上传任何数据。', doc);
    const card = doc.createElement('section');
    card.className = 'at-card';
    card.innerHTML = '<div class="at-card-title">联系人 CSV</div><div class="at-card-copy">导出字段为名称、账号 ID、平台。群组会自动排除；不同平台的账号 ID 格式可能不同。</div>';
    const actions = doc.createElement('div');
    actions.className = 'at-actions';
    const exportButton = button('导出联系人 CSV', true, doc);
    actions.appendChild(exportButton);
    card.appendChild(actions);
    const status = addStatus(card, doc);
    body.appendChild(card);

    exportButton.onclick = async () => {
      exportButton.disabled = true;
      setStatus(status, '正在读取当前账号联系人…');
      try {
        const { account, webview } = await activeContext(doc);
        if (!webview) throw new Error('当前账号页面尚未就绪');
        const factory = window.GeekPlatformTransports?.forAccount;
        if (typeof factory !== 'function') throw new Error('平台联系人适配器尚未就绪');
        const platform = factory(account, webview);
        const chats = await platform.listChats();
        const contacts = (Array.isArray(chats) ? chats : []).filter(chat => !isGroupChat(chat));
        if (!contacts.length) throw new Error('当前账号没有可导出的联系人');
        const rows = [['名称', '账号ID', '平台'], ...contacts.map(chat => [chat.name || '', chat.id || '', platform.family || account.type || ''])];
        const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
        const saved = await window.api.file.save({ defaultName: '联系人导出.csv', content: csv });
        if (!saved) { setStatus(status, '已取消导出。'); return; }
        setStatus(status, `已导出 ${contacts.length} 个联系人。`, 'success');
      } catch (error) {
        setStatus(status, `导出失败：${String(error?.message || error)}`, 'error');
      } finally {
        exportButton.disabled = false;
      }
    };
  }

  async function showBackup(doc = document) {
    const { body } = openShell('备份与恢复', '只备份可复用账号设置；定时发送任务与发送历史不会进入备份，避免恢复后重复执行。', doc);
    const exportCard = doc.createElement('section');
    exportCard.className = 'at-card';
    exportCard.innerHTML = '<div class="at-card-title">导出设置备份</div><div class="at-card-copy">包含保存消息、收件人标签、群组集合、排除项、群组工具设置和翻译设置。不会包含 Cookie、Token、密码、聊天正文、发送历史或可执行定时任务。</div>';
    const exportActions = doc.createElement('div');
    exportActions.className = 'at-actions';
    const exportButton = button('导出备份', true, doc);
    exportActions.appendChild(exportButton);
    exportCard.appendChild(exportActions);
    const exportStatus = addStatus(exportCard, doc);

    const importCard = doc.createElement('section');
    importCard.className = 'at-card';
    importCard.innerHTML = '<div class="at-card-title">恢复设置备份</div><div class="at-card-copy">支持新版备份及旧版配置文件。旧文件里的 scheduleTasks 会被明确忽略，不会重新启用旧定时器。</div>';
    const importActions = doc.createElement('div');
    importActions.className = 'at-actions';
    const importButton = button('选择备份文件', false, doc);
    const fileInput = doc.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.hidden = true;
    importActions.append(importButton, fileInput);
    importCard.appendChild(importActions);
    const importStatus = addStatus(importCard, doc);
    body.append(exportCard, importCard);

    exportButton.onclick = async () => {
      exportButton.disabled = true;
      setStatus(exportStatus, '正在整理当前账号设置…');
      try {
        const { accountId, account } = await activeContext(doc);
        const data = await window.api.accountData.getAll(accountId);
        const backup = buildBackupRecord(data || {}, account);
        const saved = await window.api.file.save({ defaultName: '极客账号设置备份.json', content: JSON.stringify(backup, null, 2) });
        if (!saved) { setStatus(exportStatus, '已取消导出。'); return; }
        setStatus(exportStatus, `备份完成，共 ${Object.keys(backup.data).length} 类设置。`, 'success');
      } catch (error) {
        setStatus(exportStatus, `备份失败：${String(error?.message || error)}`, 'error');
      } finally {
        exportButton.disabled = false;
      }
    };

    importButton.onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) { setStatus(importStatus, '备份文件过大，已拒绝导入。', 'error'); return; }
      importButton.disabled = true;
      setStatus(importStatus, '正在校验并恢复设置…');
      try {
        const { accountId } = await activeContext(doc);
        const text = await file.text();
        const record = JSON.parse(text);
        const result = await restoreBackup(accountId, record);
        if (activeAccountId(doc) !== accountId) throw new Error('恢复期间账号已切换，请重新操作');
        const ignored = result.ignoredExecutionKeys.length ? `；已忽略旧定时执行数据 ${result.ignoredExecutionKeys.join('、')}` : '';
        setStatus(importStatus, `已恢复 ${result.restored} 类设置${ignored}。`, 'success');
        setTimeout(() => doc.querySelector('.nav-account.active .nav-account-main')?.click(), 0);
      } catch (error) {
        setStatus(importStatus, `恢复失败，已尽力回滚本次写入：${String(error?.message || error)}`, 'error');
      } finally {
        importButton.disabled = false;
      }
    };
  }

  async function showReport(doc = document) {
    const { body } = openShell('群发数据报表', '只读取当前账号本地发送历史，不展示或恢复消息正文。', doc);
    try {
      const { accountId } = await activeContext(doc);
      const data = await window.api.accountData.getAll(accountId);
      const rows = normalizeHistory(data?.sendHistory);
      const summary = summarizeHistory(rows);
      const stats = doc.createElement('div');
      stats.className = 'at-stats';
      [['群发任务', summary.jobs], ['发送对象', summary.total], ['成功', summary.ok], ['失败', summary.fail]].forEach(([label, value]) => {
        const stat = doc.createElement('div');
        stat.className = 'at-stat';
        const span = doc.createElement('span');
        span.textContent = label;
        const strong = doc.createElement('strong');
        strong.textContent = String(value);
        stat.append(span, strong);
        stats.appendChild(stat);
      });
      body.appendChild(stats);

      const card = doc.createElement('section');
      card.className = 'at-card';
      const title = doc.createElement('div');
      title.className = 'at-card-title';
      title.textContent = '最近发送记录';
      card.appendChild(title);
      if (!rows.length) {
        const empty = doc.createElement('div');
        empty.className = 'at-empty';
        empty.textContent = '当前账号还没有群发历史。';
        card.appendChild(empty);
      } else {
        const wrap = doc.createElement('div');
        wrap.className = 'at-table-wrap';
        const table = doc.createElement('table');
        table.innerHTML = '<thead><tr><th>时间</th><th>对象</th><th>成功</th><th>失败</th><th>附件</th></tr></thead>';
        const tbody = doc.createElement('tbody');
        [...rows].reverse().slice(0, 100).forEach(row => {
          const tr = doc.createElement('tr');
          [new Date(row.t).toLocaleString(), row.total, row.ok, row.fail, row.files].forEach(value => {
            const td = doc.createElement('td');
            td.textContent = String(value);
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        card.appendChild(wrap);
      }
      const actions = doc.createElement('div');
      actions.className = 'at-actions';
      const exportButton = button('导出报表 CSV', false, doc);
      exportButton.disabled = !rows.length;
      actions.appendChild(exportButton);
      card.appendChild(actions);
      const status = addStatus(card, doc);
      body.appendChild(card);

      exportButton.onclick = async () => {
        exportButton.disabled = true;
        try {
          const csvRows = [['时间', '发送对象', '成功', '失败', '附件数', '消息长度', '任务ID'], ...rows.map(row => [new Date(row.t).toISOString(), row.total, row.ok, row.fail, row.files, row.msgLen, row.jobId])];
          const csv = '\uFEFF' + csvRows.map(row => row.map(csvCell).join(',')).join('\r\n');
          const saved = await window.api.file.save({ defaultName: '群发数据报表.csv', content: csv });
          setStatus(status, saved ? `已导出 ${rows.length} 条历史记录。` : '已取消导出。', saved ? 'success' : '');
        } catch (error) {
          setStatus(status, `导出报表失败：${String(error?.message || error)}`, 'error');
        } finally {
          exportButton.disabled = !rows.length;
        }
      };
    } catch (error) {
      const card = doc.createElement('section');
      card.className = 'at-card';
      const status = addStatus(card, doc);
      setStatus(status, `读取报表失败：${String(error?.message || error)}`, 'error');
      body.appendChild(card);
    }
  }

  function decorateGroupTools(doc = document) {
    const overlay = doc.getElementById('gt-overlay');
    if (!overlay) return false;
    const title = overlay.querySelector('.gt-original-title');
    if (title && !doc.getElementById('gt-product-subtitle')) {
      const subtitle = doc.createElement('small');
      subtitle.id = 'gt-product-subtitle';
      subtitle.textContent = '自动管理、群链接、克隆、编辑与退出操作集中在当前账号内';
      title.querySelector('span')?.appendChild(subtitle);
    }
    const status = doc.getElementById('gt-status');
    if (status) status.setAttribute('role', 'status');
    const buttonLabels = {
      'gt-settings-save': '保存设置',
      'gt-cmd-save': '保存指令',
      'gt-edit-save': '保存修改',
      'gt-destroy': '销毁选中群组',
      'gt-leave': '退出选中群组',
    };
    for (const [id, label] of Object.entries(buttonLabels)) {
      const node = doc.getElementById(id);
      if (node) node.textContent = label;
    }
    overlay.querySelectorAll('.gt-pane>.bc-card>div[style*="display:flex"]').forEach(row => row.classList.add('gt-workbench-row'));
    return true;
  }

  function install(doc = document) {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    ensureStyles(doc);
    doc.addEventListener('click', event => {
      const exportContacts = event.target?.closest?.('#bc-menu-export');
      if (exportContacts) {
        event.preventDefault(); event.stopImmediatePropagation();
        void showContactExport(doc);
        return;
      }
      const backup = event.target?.closest?.('#bc-menu-backup');
      if (backup) {
        event.preventDefault(); event.stopImmediatePropagation();
        void showBackup(doc);
        return;
      }
      const report = event.target?.closest?.('#bc-menu-report');
      if (report) {
        event.preventDefault(); event.stopImmediatePropagation();
        void showReport(doc);
        return;
      }
      const groupTools = event.target?.closest?.('#bc-menu-grouptools');
      if (groupTools) setTimeout(() => decorateGroupTools(doc), 0);
    }, true);
    decorateGroupTools(doc);
    window.GeekAdvancedToolsWorkbenchInstance = Object.freeze({
      showContactExport: () => showContactExport(doc),
      showBackup: () => showBackup(doc),
      showReport: () => showReport(doc),
      decorateGroupTools: () => decorateGroupTools(doc),
    });
  }

  return Object.freeze({
    BACKUP_SCHEMA,
    BACKUP_VERSION,
    SAFE_BACKUP_KEYS,
    LEGACY_EXECUTION_KEYS,
    parseJson,
    csvCell,
    buildBackupRecord,
    normalizeBackupRecord,
    restoreBackup,
    normalizeHistory,
    summarizeHistory,
    isGroupChat,
    install,
  });
});

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.GeekAdvancedToolsWorkbench.install(), { once: true });
  else window.GeekAdvancedToolsWorkbench.install();
}
