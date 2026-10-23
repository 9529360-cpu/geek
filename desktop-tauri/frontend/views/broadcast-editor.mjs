import { pending, formatTime } from '../models/broadcast.mjs';
import { element, button, wire, hidden, unavailable } from './broadcast-elements.mjs';
import { createAudienceView } from './broadcast-audience.mjs';
import { createWorkbenchView } from './broadcast-workbench.mjs';

export function createBroadcastEditor({ document, onChange, onSubmit, onClose, onRetry, onControl }) {
  const $ = (id) => document.getElementById(id);
  const listeners = [];
  const bind = (id, event, fn) => {
    const node = $(id); wire(node);
    node.addEventListener(event, fn);
    listeners.push(() => node.removeEventListener(event, fn));
  };
  let accountId = '';
  let catalog = null;
  let owner = null;
  let pendingSignature = '';
  let availability = {};
  const audience = createAudienceView(document, onChange);
  const workbench = createWorkbenchView(document, onRetry, onChange);
  $('broadcast-close').setAttribute('aria-label', '关闭群发编辑器');
  $('broadcast-message').setAttribute('aria-label', '群发消息内容');
  $('broadcast-message').placeholder = '输入要发送的完整消息，可用下方变量插入联系人名称或问候语';
  $('broadcast-schedule-time').setAttribute('aria-label', '定时发送日期与时间');
  $('bc-range-min').setAttribute('aria-label', '最小随机间隔（秒）');
  $('bc-range-max').setAttribute('aria-label', '最大随机间隔（秒）');
  $('bc-schedule-time-wrap').removeAttribute('data-original-style');
  $('broadcast-add-schedule').textContent = '＋ 保存此条定时任务';
  $('broadcast-add-schedule').title = '保存当前消息为独立定时任务，并继续编辑下一条';
  for (const id of ['broadcast-message', 'broadcast-schedule-time']) bind(id, 'input', onChange);
  bind('broadcast-schedule-toggle', 'change', () => { scheduleVisibility(); onChange(); });
  bind('broadcast-tagall', 'change', onChange);
  bind('broadcast-send', 'click', () => onSubmit(false));
  bind('broadcast-add-schedule', 'click', () => onSubmit(true));
  bind('broadcast-close', 'click', onClose);
  bind('broadcast-cancel', 'click', onClose);
  bind('broadcast-overlay', 'click', (event) => { if (event.target === $('broadcast-overlay')) onClose(); });
  for (const [id, value] of [['broadcast-insert-sa', '%sa'], ['broadcast-insert-var', '%nc'],
    ['broadcast-insert-nr', '%nr'], ['bc-multiversion', ' {版本1|版本2|版本3}']]) {
    bind(id, 'click', () => {
      const input = $('broadcast-message');
      const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
      const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
      input.value = input.value.slice(0, start) + value + input.value.slice(end);
      input.focus(); input.setSelectionRange?.(start + value.length, start + value.length);
      onChange();
    });
  }
  for (const bound of ['min', 'max']) bind(`bc-range-${bound}`, 'input', () => {
    const value = Number($(`bc-range-${bound}`).value);
    if (bound === 'min' && value > Number($('bc-range-max').value)) $('bc-range-max').value = String(value);
    if (bound === 'max' && value < Number($('bc-range-min').value)) $('bc-range-min').value = String(value);
    syncRanges(); onChange();
  });
  for (const id of ['broadcast-add-file', 'broadcast-dropzone', 'bc-save-message', 'bc-delete-message',
    'bc-saved-accordion-toggle', 'bc-saved-messages', 'broadcast-save-group', 'broadcast-show-all-groups',
    'broadcast-saved-groups', 'broadcast-delete-group', 'broadcast-import-csv', 'bc-paste-numbers',
    'bc-group-members-select', 'bc-label-select', 'bc-exclude-contacts-select', 'bc-exclude-groups-select',
    'bc-saved-lists', 'bc-save-list', 'bc-delete-list', 'broadcast-export']) unavailable($(id));
  const fileLabel = $('broadcast-add-file').closest('label')?.querySelector('.bc-switch-label');
  if (fileLabel) fileLabel.textContent = '添加图片/视频/文件 · 附件传输尚未迁移';
  $('broadcast-dropzone').title = '附件传输尚未迁移';
  $('bc-group-tag-list').textContent = '自定义标签尚未迁移';
  $('broadcast-save-group').textContent = '保存为标签 · 尚未迁移';
  $('bc-saved-message-list').textContent = '常用消息存储尚未迁移';

  function syncRanges() {
    const min = Number($('bc-range-min').value);
    const max = Number($('bc-range-max').value);
    $('broadcast-interval-min').value = String(min);
    $('broadcast-interval-max').value = String(max);
    $('bc-range-value').textContent = `${min} 至 ${max} 秒`;
    $('bc-range-fill').style.left = `${(min - 5) / 55 * 100}%`;
    $('bc-range-fill').style.width = `${(max - min) / 55 * 100}%`;
  }

  function scheduleVisibility() {
    hidden($('bc-schedule-time-wrap'), !$('broadcast-schedule-toggle').checked);
  }

  function read() {
    return { accountId, ...audience.values(), message: $('broadcast-message').value,
      tagAll: $('broadcast-tagall').checked, intervalMin: Number($('broadcast-interval-min').value),
      intervalMax: Number($('broadcast-interval-max').value), scheduleEnabled: $('broadcast-schedule-toggle').checked,
      scheduleTime: $('broadcast-schedule-time').value };
  }

  function setAvailability(next) {
    availability = next;
    const blocked = Boolean(next.shellBusy || next.creating || !next.apiAvailable);
    const ready = Boolean(catalog?.ready && !next.loading && !next.mismatch);
    audience.availability(blocked || !ready);
    workbench.availability(blocked);
    for (const id of ['broadcast-message', 'broadcast-insert-sa', 'broadcast-insert-var', 'broadcast-insert-nr',
      'bc-multiversion', 'bc-range-min', 'bc-range-max', 'broadcast-close', 'broadcast-cancel']) wire($(id), blocked);
    wire($('broadcast-schedule-toggle'), blocked || !catalog?.capabilities.scheduled);
    wire($('broadcast-schedule-time'), blocked || !catalog?.capabilities.scheduled);
    wire($('broadcast-tagall'), blocked || !ready || !catalog?.capabilities.tagAll);
    $('broadcast-tagall').title = catalog?.capabilities.tagAll ? '@全体群成员' : '当前账号的 @全体能力尚未就绪';
    wire($('broadcast-send'), blocked || !ready);
    wire($('broadcast-add-schedule'), blocked || !ready || !$('broadcast-schedule-toggle').checked || !catalog?.capabilities.scheduled);
    for (const node of $('broadcast-schedule-list').querySelectorAll('button')) {
      wire(node, blocked || next.pendingControls?.has(node.dataset.jobId));
    }
  }

  function renderSchedules(jobs) {
    const scheduled = jobs.filter((job) => job.accountId === accountId && pending.has(job.state))
      .sort((a, b) => (a.scheduledAt || a.createdAt) - (b.scheduledAt || b.createdAt));
    const signature = JSON.stringify(scheduled.map((job) => [job.id, job.state, job.scheduledAt, job.total]));
    if (signature === pendingSignature) return;
    pendingSignature = signature;
    const list = $('broadcast-schedule-list');
    list.replaceChildren();
    if (!scheduled.length) {
      list.append(element(document, 'div', 'bc-safe-schedule-status', '尚未添加定时任务；可连续保存多条不同时间的消息。'));
      return;
    }
    const summary = element(document, 'div', 'bc-safe-schedule-summary');
    summary.append(element(document, 'strong', '', `待发送 ${scheduled.length} 条`),
      element(document, 'span', '', '每条任务独立保存，可单独取消'));
    list.append(summary);
    for (const job of scheduled) {
      const row = element(document, 'div', 'bc-safe-schedule-row');
      row.dataset.jobId = job.id;
      const text = `${formatTime(job.scheduledAt)} · ${job.total} 个对象 · ${job.state === 'queued' ? '等待当前任务结束' : '已定时'}`;
      const cancel = button(document, '取消', () => onControl(job.id, 'stop'), '');
      cancel.dataset.jobId = job.id;
      cancel.setAttribute('aria-label', `取消 ${formatTime(job.scheduledAt)} 的定时任务`);
      row.append(element(document, 'span', '', text), cancel); list.append(row);
    }
    setAvailability(availability);
  }

  return {
    read,
    fill(draft, nextCatalog, nextOwner) {
      accountId = draft.accountId; owner = nextOwner; catalog = nextCatalog;
      $('broadcast-message').value = draft.message;
      $('broadcast-tagall').checked = draft.tagAll;
      $('bc-range-min').value = String(draft.intervalMin); $('bc-range-max').value = String(draft.intervalMax);
      $('broadcast-schedule-toggle').checked = draft.scheduleEnabled;
      $('broadcast-schedule-time').value = draft.scheduleTime;
      audience.set(catalog, draft.recipientIds, draft.vcardIds); audience.resetSearch();
      syncRanges(); scheduleVisibility(); pendingSignature = '';
      workbench.setStep('content');
    },
    catalog(next) { catalog = next; audience.set(next); },
    render(jobs, activeJob) { workbench.render(read(), catalog, owner, activeJob); renderSchedules(jobs); scheduleVisibility(); },
    setStep: workbench.setStep,
    status: workbench.status,
    availability: setAvailability,
    clearMessage() {
      $('broadcast-message').value = '';
      audience.set(catalog, undefined, []);
      $('broadcast-message').focus();
    },
    focusError(code) {
      if (/SCHEDULE/.test(code)) { workbench.setStep('settings'); $('broadcast-schedule-time').focus(); }
      else if (/AUDIENCE|CATALOG|ACCOUNT/.test(code)) { workbench.setStep('audience'); $('broadcast-search').focus(); }
      else if (/INTERVAL/.test(code)) { workbench.setStep('settings'); $('bc-range-min').focus(); }
      else { workbench.setStep('content'); $('broadcast-message').focus(); }
    },
    dispose() { for (const remove of listeners) remove(); audience.dispose(); },
  };
}
