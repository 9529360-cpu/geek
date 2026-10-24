import { element, wire } from './broadcast-elements.mjs';
import { jobLabel } from '../models/broadcast.mjs';
import { advancedError, backupKeyLabel, previewCounts } from '../models/advanced-tools.mjs';

const modes = {
  contacts: ['导出联系人', '从当前账号读取可用聊天联系人并导出为本地 CSV，不上传任何数据。'],
  report: ['群发数据报表', '本地保留任务的统计，包含定时和进行中的任务，不展示消息正文。'],
  backup: ['备份与恢复', '只备份可复用账号设置，定时发送任务与发送历史不会恢复。'],
};
const menus = { contacts: 'bc-menu-export', report: 'bc-menu-report', backup: 'bc-menu-backup' };

export function createAdvancedToolsView(document, actions) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('advanced-tools-overlay');
  const body = $('at-body');
  const close = overlay.querySelector('.at-close');
  close.id = 'at-close';
  const dialog = overlay.querySelector('.at-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'at-title');
  const listeners = [];
  const bind = (node, action) => {
    node.addEventListener('click', action);
    listeners.push(() => node.removeEventListener('click', action));
  };
  bind(close, actions.close);
  for (const [mode, id] of Object.entries(menus)) bind($(id), () => actions.open(mode));
  let controls = {};
  let statuses = {};
  let reportStats = null;
  let reportRows = null;
  let reportExtra = null;
  let preview = null;
  let results = null;

  function button(id, label, action, primary = false) {
    const node = element(document, 'button', `at-btn${primary ? ' at-btn--primary' : ''}`, label);
    node.id = id; node.type = 'button'; wire(node);
    node.addEventListener('click', action);
    controls[id] = node;
    return node;
  }
  function card(title, copy = '') {
    const node = element(document, 'section', 'at-card');
    node.append(element(document, 'div', 'at-card-title', title));
    if (copy) node.append(element(document, 'div', 'at-card-copy', copy));
    body.append(node);
    return node;
  }
  function statusNode(parent, key) {
    const node = element(document, 'div', 'at-status');
    node.id = `at-status-${key}`;
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    parent.append(node); statuses[key] = node;
    return node;
  }
  function actionRow(parent, ...buttons) {
    const row = element(document, 'div', 'at-actions');
    row.append(...buttons); parent.append(row);
  }
  function stat(label, value, detail = '') {
    const node = element(document, 'div', 'at-stat');
    node.append(element(document, 'span', '', label), element(document, 'strong', '', String(value)));
    if (detail) node.append(element(document, 'span', '', detail));
    return node;
  }
  function contacts() {
    const node = card('联系人 CSV', '导出字段为名称、账号 ID、平台。群组会自动排除，不同平台的账号 ID 格式可能不同。');
    actionRow(node, button('at-export-contacts', '导出联系人 CSV', actions.exportContacts, true));
    statusNode(node, 'contacts');
  }
  function report() {
    reportStats = element(document, 'div', 'at-stats');
    body.append(reportStats);
    const node = card('任务记录');
    reportExtra = element(document, 'div', 'at-card-copy'); node.append(reportExtra);
    reportRows = element(document, 'div'); node.append(reportRows);
    actionRow(node, button('at-export-report', '导出报表 CSV', actions.exportReport),
      button('at-refresh-report', '重新读取', actions.loadReport));
    statusNode(node, 'report');
    renderHistory(null);
  }
  function backup() {
    const exportCard = card('导出设置备份', '备份常用消息、自定义标签、联系人和群组排除项及翻译设置。群工具配置暂不支持恢复。');
    actionRow(exportCard, button('at-export-backup', '导出备份', actions.exportBackup, true));
    statusNode(exportCard, 'backup-export');
    const importCard = card('恢复设置备份', '先选择备份并核对范围。文件中存在的项目会替换当前设置，空集合会清空，未包含的项目保持现有。');
    actionRow(importCard, button('at-pick-backup', '选择备份文件', actions.pickBackup));
    preview = element(document, 'div'); preview.id = 'at-backup-preview'; importCard.append(preview);
    results = element(document, 'div'); results.id = 'at-restore-results'; importCard.append(results);
    actionRow(importCard, button('at-restore-backup', '恢复设置', actions.restoreBackup, true));
    statusNode(importCard, 'backup-import');
  }
  function renderHistory(history) {
    reportStats.replaceChildren(...[['群发任务', 'jobs'], ['发送对象', 'total'], ['成功', 'ok'], ['失败', 'fail']]
      .map(([label, key]) => stat(label, history ? history.summary[key] : '—')));
    reportExtra.textContent = history ? `结果不确定 ${history.summary.uncertain}，未处理 ${history.summary.pending}` : '';
    reportRows.replaceChildren();
    if (!history || !history.rows.length) {
      reportRows.append(element(document, 'div', 'at-empty', history ? '当前账号没有保留的群发任务。' : '正在读取任务记录…'));
      return;
    }
    const wrap = element(document, 'div', 'at-table-wrap');
    const table = element(document, 'table');
    const head = element(document, 'thead'); const headings = element(document, 'tr');
    for (const label of ['时间', '对象', '成功', '失败', '结果不确定', '未处理', '附件', '状态']) {
      const cell = element(document, 'th', '', label); cell.setAttribute('scope', 'col'); headings.append(cell);
    }
    head.append(headings); table.append(head);
    const rows = element(document, 'tbody');
    for (const item of history.rows.slice(0, 100)) {
      const row = element(document, 'tr');
      for (const value of [new Date(item.createdAt).toLocaleString('zh-CN'), item.total, item.ok, item.fail,
        item.uncertain, item.pending, item.attachments, jobLabel(item)]) {
        row.append(element(document, 'td', '', String(value)));
      }
      rows.append(row);
    }
    table.append(rows); wrap.append(table); reportRows.append(wrap);
    if (history.rows.length > 100) reportRows.append(element(document, 'div', 'at-card-copy', '显示最近 100 条，CSV 包含全部保留任务。'));
  }
  function renderBackup(value, sections = {}) {
    preview.replaceChildren(); results.replaceChildren();
    if (value) {
      const source = value.backup;
      preview.append(element(document, 'div', 'at-card-copy', `备份来源：${source.account.name}，${source.account.type}，版本 ${source.version}`));
      const stats = element(document, 'div', 'at-stats');
      stats.append(...previewCounts(source.data).map((item) => stat(item.label, item.size === null ? '—' : item.size, item.action)));
      preview.append(stats);
      if (source.reportedUnsupported.length) preview.append(element(document, 'div', 'at-card-copy',
        `暂不支持，保持现有：${source.reportedUnsupported.map(backupKeyLabel).join('、')}`));
      if (source.ignoredKeys.length) preview.append(element(document, 'div', 'at-card-copy',
        `不会恢复：${source.ignoredKeys.map(backupKeyLabel).join('、')}`));
    }
    for (const [kind, label] of [['presets', '群发资料'], ['translation', '翻译设置']]) {
      const result = sections[kind];
      if (!result) continue;
      const success = ['restored', 'unchanged'].includes(result.status);
      const detail = result.status === 'restored' ? '已恢复' : result.status === 'unchanged' ? '内容一致，无需更改'
        : result.status === 'notAttempted' ? '尚未完成，请重试' : advancedError(result.code);
      const node = element(document, 'div', 'at-status', `${label}：${detail}`);
      node.id = `at-result-${kind}`; node.dataset.state = success ? 'success' : 'error'; results.append(node);
    }
  }

  return {
    open(mode, account) {
      controls = {}; statuses = {}; body.replaceChildren();
      $('at-title').textContent = modes[mode][0];
      $('at-subtitle').textContent = `${account.name}，${modes[mode][1]}`;
      ({ contacts, report, backup })[mode]();
    },
    menu({ account, disabled, available }) {
      for (const [mode, id] of Object.entries(menus)) {
        const node = $(id); wire(node, disabled || !account || !available[mode]);
        node.title = !available[mode] ? '高级工具尚未就绪' : !account ? '请先选择账号' : '';
        node.setAttribute('aria-label', node.textContent.trim());
      }
    },
    availability({ busy, invalidated, history, canRestore, available }) {
      const blocked = busy || invalidated;
      for (const control of Object.values(controls)) wire(control, blocked);
      if (controls['at-export-report']) wire(controls['at-export-report'], blocked || !history?.rows.length);
      if (controls['at-restore-backup']) wire(controls['at-restore-backup'], blocked || !canRestore);
      if (controls['at-export-backup']) wire(controls['at-export-backup'], blocked || !available.exportBackup);
      if (controls['at-pick-backup']) wire(controls['at-pick-backup'], blocked || !available.pickBackup);
      wire(close, false);
    },
    status(key, message = '', state = '') {
      if (statuses[key]) { statuses[key].textContent = message; statuses[key].dataset.state = state; }
    },
    renderHistory,
    renderBackup,
    reportUnavailable() { reportRows.replaceChildren(element(document, 'div', 'at-empty', '任务记录尚未读取，请重新读取。')); },
    dispose() { for (const remove of listeners) remove(); body.replaceChildren(); },
  };
}
