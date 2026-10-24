import { element, button, wire, hidden } from './broadcast-elements.mjs';

export function createBroadcastPresetsView({ document, onSave, onDelete, onApplyMessage, onRestore, onRefresh, onChange }) {
  const $ = (id) => document.getElementById(id);
  const listeners = [];
  const bind = (node, event, fn) => {
    node.addEventListener(event, fn); listeners.push(() => node.removeEventListener(event, fn));
  };
  const tagRow = $('broadcast-save-group').parentElement;
  tagRow.classList.add('bc-recipient-tag-canonical-row');
  for (const id of ['broadcast-show-all-groups', 'broadcast-saved-groups', 'bc-group-tag-list', 'broadcast-delete-group']) {
    hidden($(id), true); $(id).setAttribute('aria-hidden', 'true');
  }
  hidden($('bc-saved-lists').parentElement, true);
  const tagLabel = element(document, 'strong', '', '自定义标签'); tagLabel.id = 'broadcast-recipient-tag-label';
  const tagList = element(document, 'div', 'bc-original-tag-list bc-recipient-tag-list'); tagList.id = 'broadcast-recipient-tag-list';
  tagRow.insertBefore(tagLabel, tagRow.firstElementChild); tagRow.insertBefore(tagList, $('broadcast-save-group'));
  $('broadcast-save-group').textContent = '＋ 保存为标签';
  $('broadcast-save-group').title = '保存当前最终发送对象';
  $('bc-save-message').textContent = '▣ 保存消息';
  $('bc-saved-accordion-toggle').setAttribute('aria-controls', 'bc-saved-accordion-body');
  const toggleAccordion = () => {
    const collapsed = $('bc-saved-accordion').classList.toggle('collapsed');
    $('bc-saved-accordion-toggle').setAttribute('aria-expanded', String(!collapsed));
    $('bc-saved-accordion-arrow').textContent = collapsed ? '▸' : '▾';
  };
  bind($('bc-saved-accordion-toggle'), 'click', toggleAccordion);
  const controls = {}, active = { message: null, audience: null };
  let data = null;
  let availability = { available: false, ready: false, busy: false, blocked: true, audienceReady: false, conflict: false };
  let renderKey = '';
  let renderedData;

  for (const [kind, triggerId, host, list] of [
    ['message', 'bc-save-message', $('bc-save-message').parentElement, $('bc-saved-message-list')],
    ['audience', 'broadcast-save-group', tagRow, tagList],
  ]) {
    const form = element(document, 'div', 'bc-preset-form hidden'); form.id = `broadcast-${kind}-preset-form`;
    const input = element(document, 'input', 'bc-input'); input.type = 'text'; input.maxLength = 80;
    input.id = `broadcast-${kind}-preset-name`; input.placeholder = kind === 'message' ? '消息名称' : '标签名称';
    input.setAttribute('aria-label', kind === 'message' ? '常用消息名称' : '自定义标签名称');
    const submit = button(document, '保存', () => onSave(kind), 'bc-btn bc-btn--small bc-pill');
    submit.id = `broadcast-${kind}-preset-save`;
    const cancel = button(document, '取消', () => { hidden(form, true); controls[kind].revision += 1; onChange(); }, 'bc-btn bc-btn--small');
    cancel.id = `broadcast-${kind}-preset-cancel`;
    form.append(input, submit, cancel);
    const status = element(document, 'div', 'bc-preset-status hidden'); status.id = `broadcast-${kind}-preset-status`;
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const text = element(document, 'span');
    const refresh = button(document, '刷新', onRefresh, 'bc-btn bc-btn--small bc-pill');
    refresh.id = `broadcast-${kind}-preset-refresh`; hidden(refresh, true); status.append(text, refresh);
    const confirm = element(document, 'div', 'bc-preset-confirm hidden');
    const confirmText = element(document, 'span');
    const remove = button(document, '删除', () => onDelete(kind, controls[kind].deleteId), 'bc-btn bc-btn--small');
    remove.id = `broadcast-${kind}-preset-delete`;
    const keep = button(document, '取消', () => {
      hidden(confirm, true); controls[kind].deleteId = null; controls[kind].revision += 1; onChange();
    }, 'bc-btn bc-btn--small');
    confirm.append(confirmText, remove, keep);
    if (kind === 'message') { host.after(form); form.after(confirm); confirm.after(status); }
    else host.append(form, confirm, status);
    controls[kind] = { form, input, submit, cancel, status, text, refresh, confirm, confirmText, remove, keep,
      list, trigger: $(triggerId), revision: 0, deleteId: null };
    bind($(triggerId), 'click', () => {
      hidden(form, false); input.focus(); controls[kind].revision += 1; onChange();
    });
    bind(input, 'input', () => { controls[kind].revision += 1; onChange(); });
    bind(input, 'keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); if (!submit.disabled) onSave(kind); }
    });
  }

  function render() {
    const key = JSON.stringify(active);
    if (renderedData === data && renderKey === key) { setAvailability(availability); return; }
    renderedData = data; renderKey = key;
    for (const kind of ['message', 'audience']) {
      const control = controls[kind]; control.list.replaceChildren();
      const items = data?.[kind === 'message' ? 'messages' : 'audiences'] || [];
      for (const item of items) {
        const cls = kind === 'message' ? 'bc-original-message-chip' : 'bc-original-tag';
        const chip = element(document, 'span', `${cls}${active[kind] === item.id ? ' active' : ''}`);
        chip.dataset.presetId = item.id;
        const open = button(document, item.name, () => kind === 'message' ? onApplyMessage(item.id) : onRestore(item.id), `${cls}__open`);
        open.setAttribute('aria-label', `${kind === 'message' ? '使用消息' : '恢复标签'} ${item.name}`);
        open.title = kind === 'message' ? item.message : `恢复 ${item.recipientIds.length} 个发送对象`;
        if (kind === 'audience') open.append(element(document, 'em', '', String(item.recipientIds.length)));
        const remove = button(document, '×', (event) => {
          event.stopPropagation(); control.deleteId = item.id; control.revision += 1;
          control.confirmText.textContent = `删除「${item.name}」？`; hidden(control.confirm, false);
        }, `${cls}__remove`);
        remove.setAttribute('aria-label', `删除${kind === 'message' ? '消息' : '标签'} ${item.name}`);
        open.dataset.action = 'apply'; remove.dataset.action = 'delete';
        chip.append(open, remove); control.list.append(chip);
      }
      if (!items.length) control.list.append(element(document, 'span', 'bc-original-empty',
        kind === 'message' ? '暂无已保存消息' : '暂无自定义标签'));
    }
    setAvailability(availability);
  }

  function setAvailability(next) {
    availability = next;
    const blocked = !next.available || !next.ready || next.busy || next.blocked || next.conflict;
    wire($('bc-saved-accordion-toggle'), !next.available);
    $('bc-saved-accordion-toggle').title = next.available ? '查看常用消息' : '常用消息尚不可用';
    for (const [kind, control] of Object.entries(controls)) {
      const needsCatalog = kind === 'audience' && !next.audienceReady;
      wire(control.trigger, blocked || needsCatalog); wire(control.submit, blocked || needsCatalog);
      control.trigger.title = !next.available ? '保存资料尚不可用' : needsCatalog ? '请先读取当前聊天目录' : '保存当前内容';
      wire(control.input, !next.available || next.blocked); wire(control.cancel, next.blocked);
      wire(control.refresh, !next.available || next.busy || next.blocked);
      wire(control.remove, blocked); wire(control.keep, next.blocked);
      for (const button of control.list.querySelectorAll('button')) {
        wire(button, blocked || (button.dataset.action === 'apply' && needsCatalog));
      }
    }
  }

  return {
    render(next) { data = next; render(); },
    availability: setAvailability,
    names: () => Object.fromEntries(Object.entries(controls).map(([kind, value]) => [kind, {
      name: value.input.value, open: !value.form.classList.contains('hidden'),
    }])),
    bind(saved = {}) {
      data = null; active.message = null; active.audience = null; renderKey = '';
      for (const [kind, control] of Object.entries(controls)) {
        control.input.value = saved[kind]?.name || ''; hidden(control.form, !saved[kind]?.open);
        control.revision += 1; control.deleteId = null; hidden(control.confirm, true);
        control.text.textContent = ''; hidden(control.refresh, true); hidden(control.status, true);
      }
      render();
    },
    name: (kind) => controls[kind].input.value,
    revision: (kind) => controls[kind].revision,
    selected(kind, id) { active[kind] = id; render(); },
    saved(kind) { hidden(controls[kind].form, true); },
    deleted(kind) { controls[kind].deleteId = null; hidden(controls[kind].confirm, true); active[kind] = null; render(); },
    feedback(kind, text = '', state = 'ready', refresh = false) {
      const control = controls[kind]; control.text.textContent = text; control.status.dataset.state = state;
      hidden(control.refresh, !refresh); hidden(control.status, !text && !refresh);
    },
    dispose() { for (const remove of listeners) remove(); },
  };
}
