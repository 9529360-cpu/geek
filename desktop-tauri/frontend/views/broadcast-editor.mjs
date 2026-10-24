import { pending, formatTime, messageLimit } from '../models/broadcast.mjs';
import { element, button, wire, hidden, unavailable } from './broadcast-elements.mjs';
import { createAudienceView } from './broadcast-audience.mjs';
import { createWorkbenchView } from './broadcast-workbench.mjs';

export function createBroadcastEditor({ document, onChange, onSubmit, onClose, onRetry, onControl,
  onPickAttachments, onRemoveAttachment, onImportContacts, onResolveSource }) {
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
  let attachments = [];
  const audience = createAudienceView(document, onChange, onResolveSource);
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
  bind('broadcast-add-file', 'change', () => {
    const input = $('broadcast-add-file');
    if (input.checked) onPickAttachments();
    input.checked = false;
  });
  bind('broadcast-dropzone', 'click', onPickAttachments);
  bind('broadcast-import-csv', 'click', onImportContacts);
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
  for (const id of ['bc-delete-message', 'bc-saved-messages', 'broadcast-show-all-groups',
    'broadcast-saved-groups', 'broadcast-delete-group',
    'bc-saved-lists', 'bc-save-list', 'bc-delete-list', 'broadcast-export']) unavailable($(id));
  const fileLabel = $('broadcast-add-file').closest('label')?.querySelector('.bc-switch-label');
  if (fileLabel) fileLabel.textContent = '添加附件，最多 10 个';
  $('broadcast-add-file').closest('label')?.classList.add('bc-action-trigger');
  $('broadcast-add-file').setAttribute('aria-label', '添加附件');
  $('broadcast-dropzone').querySelector('strong').textContent = '点击选择图片、视频或文件';
  $('broadcast-dropzone').querySelector('small').textContent = '单个 512 MiB，总计 1 GiB';

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
      attachments: attachments.map((file) => ({ ...file })),
      tagAll: $('broadcast-tagall').checked, intervalMin: Number($('broadcast-interval-min').value),
      intervalMax: Number($('broadcast-interval-max').value), scheduleEnabled: $('broadcast-schedule-toggle').checked,
      scheduleTime: $('broadcast-schedule-time').value };
  }

  function renderAttachments() {
    const list = $('broadcast-files');
    list.replaceChildren();
    for (const file of attachments) {
      const item = element(document, 'span', 'bf-item'); item.title = file.name;
      item.dataset.attachmentId = file.id;
      const remove = button(document, '×', () => onRemoveAttachment(file.id), 'bf-remove');
      remove.setAttribute('aria-label', `移除附件 ${file.name}`);
      const kind = { image: '图片', video: '视频', audio: '音频', document: '文件' }[file.kind];
      const name = catalog?.platformId === 'telegram-k' ? `${file.name}（${kind}）` : file.name;
      item.append(element(document, 'span', 'bf-name', name), remove); list.append(item);
    }
    setAvailability(availability);
  }

  function setAvailability(next) {
    availability = next;
    const blocked = Boolean(next.shellBusy || next.creating || !next.apiAvailable);
    const ready = Boolean(catalog?.ready && !next.loading && !next.mismatch);
    const filesBlocked = blocked || next.attachmentBusy || next.importBusy || next.mismatch || !next.attachmentsAvailable;
    const canPick = ready && catalog?.capabilities.attachments;
    const imports = ['whatsapp', 'whatsapp-pure', 'telegram-k'].includes(catalog?.platformId);
    $('broadcast-message').maxLength = messageLimit(catalog?.platformId, attachments.length);
    $('broadcast-message').title = catalog?.platformId === 'telegram-k'
      ? attachments.length ? '附件说明最多 1024 字符，插入姓名和问候语后的完整内容也受此限制。'
        : '每条消息最多 4096 字符，插入姓名和问候语后的完整内容也受此限制。' : '';
    audience.availability(blocked || !ready || next.importBusy || next.attachmentBusy, next.importAvailable && imports,
      { canPaste: next.resolveAvailable && imports, canAudience: next.audienceAvailable && imports,
        editable: !blocked && ready && !next.attachmentBusy });
    workbench.availability(blocked);
    for (const id of ['broadcast-message', 'broadcast-insert-sa', 'broadcast-insert-var', 'broadcast-insert-nr',
      'bc-multiversion', 'bc-range-min', 'bc-range-max', 'broadcast-close', 'broadcast-cancel']) wire($(id), blocked);
    wire($('broadcast-schedule-toggle'), blocked || !catalog?.capabilities.scheduled);
    wire($('broadcast-schedule-time'), blocked || !catalog?.capabilities.scheduled);
    wire($('broadcast-tagall'), blocked || !ready || !catalog?.capabilities.tagAll || attachments.length > 0);
    $('broadcast-tagall').title = attachments.length ? '附件任务不支持@全体，请先移除附件。'
      : catalog?.capabilities.tagAll ? '@全体群成员' : '当前账号的 @全体能力尚未就绪';
    for (const id of ['broadcast-add-file', 'broadcast-dropzone']) {
      wire($(id), filesBlocked || !canPick);
      $(id).title = canPick && next.attachmentsAvailable ? next.attachmentBusy ? '正在处理附件…' : '选择要群发的附件' : '当前账号的附件发送尚未就绪';
    }
    for (const node of $('broadcast-files').querySelectorAll('button')) wire(node, filesBlocked);
    wire($('broadcast-send'), blocked || !ready || next.attachmentBusy || next.importBusy);
    wire($('broadcast-add-schedule'), blocked || !ready || next.attachmentBusy || next.importBusy
      || !$('broadcast-schedule-toggle').checked || !catalog?.capabilities.scheduled);
    for (const node of $('broadcast-schedule-list').querySelectorAll('button')) {
      wire(node, blocked || next.pendingControls?.has(node.dataset.jobId));
    }
  }

  function renderSchedules(jobs) {
    const scheduled = jobs.filter((job) => job.accountId === accountId && pending.has(job.state))
      .sort((a, b) => (a.scheduledAt || a.createdAt) - (b.scheduledAt || b.createdAt));
    const signature = JSON.stringify(scheduled.map((job) => [job.id, job.state, job.scheduledAt, job.total, job.attachments?.length || 0]));
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
      const files = job.attachments?.length || 0;
      const text = `${formatTime(job.scheduledAt)}，${job.total} 个对象${files ? `，${files} 个附件` : ''}，${job.state === 'queued' ? '等待当前任务结束' : '已定时'}`;
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
      attachments = (draft.attachments || []).map((file) => ({ ...file }));
      $('broadcast-dropzone').dataset.open = String(attachments.length > 0);
      $('broadcast-add-file').checked = false;
      renderAttachments();
      $('broadcast-message').value = draft.message;
      $('broadcast-tagall').checked = draft.tagAll;
      $('bc-range-min').value = String(draft.intervalMin); $('bc-range-max').value = String(draft.intervalMax);
      $('broadcast-schedule-toggle').checked = draft.scheduleEnabled;
      $('broadcast-schedule-time').value = draft.scheduleTime;
      audience.set(catalog, draft); audience.resetSearch();
      syncRanges(); scheduleVisibility(); pendingSignature = '';
      workbench.setStep('content');
    },
    catalog(next) { catalog = next; audience.set(next); },
    imported(result) { catalog = result.catalog; audience.imported(result); },
    resolved(kind, result, revision) { catalog = result.catalog; audience.resolved(kind, result, revision); },
    restored(result) { catalog = result.catalog; audience.restored(result); },
    message(value) { $('broadcast-message').value = value; $('broadcast-message').focus(); onChange(); },
    importStatus: audience.importStatus,
    sourceStatus: audience.sourceStatus,
    attachments(next) { attachments = next.map((file) => ({ ...file })); renderAttachments(); },
    showAttachments() { $('broadcast-dropzone').dataset.open = 'true'; },
    render(jobs, activeJob) { workbench.render(read(), catalog, owner, activeJob); renderSchedules(jobs); scheduleVisibility(); },
    setStep: workbench.setStep,
    status: workbench.status,
    availability: setAvailability,
    clearMessage() {
      $('broadcast-message').value = '';
      attachments = []; renderAttachments();
      audience.clearCards();
      $('broadcast-message').focus();
    },
    focusError(code) {
      if (/SCHEDULE/.test(code)) { workbench.setStep('settings'); $('broadcast-schedule-time').focus(); }
      else if (/AUDIENCE|CATALOG|ACCOUNT|IMPORT|PASTE|SOURCE/.test(code)) {
        const mode = read().audienceMode;
        const target = mode === 'excel' ? 'broadcast-import-csv' : mode === 'paste' ? 'bc-paste-numbers'
          : mode === 'group-members' || mode === 'label' || mode.startsWith('exclude-') ? `bc-${mode}-select` : 'broadcast-search';
        workbench.setStep('audience'); $(target).focus();
      }
      else if (/INTERVAL/.test(code)) { workbench.setStep('settings'); $('bc-range-min').focus(); }
      else { workbench.setStep('content'); $(/ATTACHMENT|FILE/.test(code) ? 'broadcast-dropzone' : 'broadcast-message').focus(); }
    },
    dispose() { for (const remove of listeners) remove(); audience.dispose(); },
  };
}
