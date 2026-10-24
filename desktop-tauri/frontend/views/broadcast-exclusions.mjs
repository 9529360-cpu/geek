import { element, button, wire, hidden } from './broadcast-elements.mjs';

// Persistence feedback stays beside the original two exclusion selectors.
export function createBroadcastExclusionsView({ document, onSave, onReload }) {
  const controls = ['contact', 'group'].map((kind) => {
    const host = document.getElementById(`broadcast-update-exclude-${kind}`).parentElement;
    const status = element(document, 'span', 'bc-preset-status');
    status.id = `broadcast-exclusions-${kind}-status`;
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const save = button(document, '重试保存', onSave, 'bc-btn bc-btn--small bc-pill');
    save.id = `broadcast-exclusions-${kind}-save`;
    const reload = button(document, '重新读取', onReload, 'bc-btn bc-btn--small bc-pill');
    reload.id = `broadcast-exclusions-${kind}-reload`;
    host.append(status, save, reload);
    return { status, save, reload,
      select: document.getElementById(`bc-exclude-${kind === 'contact' ? 'contacts' : 'groups'}-select`) };
  });
  let feedback = { text: '', state: 'ready', save: false, reload: false };

  function render(value) {
    const blocked = !value.available || !value.open || value.blocked || value.busy;
    for (const control of controls) {
      control.status.textContent = feedback.text;
      control.status.dataset.state = feedback.state;
      hidden(control.status, !value.available || !feedback.text);
      hidden(control.save, !value.available || !feedback.save);
      hidden(control.reload, !value.available || !feedback.reload);
      control.reload.textContent = value.dirty ? '使用已保存' : '重新读取';
      wire(control.save, blocked || !value.ready || value.conflict);
      wire(control.reload, blocked);
      // Audience rendering owns directory readiness. This final gate adds the
      // shared durable revision: an unresolved load/write cannot accept edits.
      if (value.available) wire(control.select, blocked || !value.ready || value.conflict || !value.directoryReady);
    }
  }

  return {
    render,
    feedback(text = '', state = 'ready', actions = {}) { feedback = { text, state, save: false, reload: false, ...actions }; },
  };
}
