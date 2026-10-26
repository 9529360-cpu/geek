// View binding for the original contact-notes popover; the markup ships in the
// composed original index.html and the styling in ui/contact-notes.css.
import { EMPTY_PROFILE, MAX_NOTE_LENGTH, summary } from '../models/contact-notes.mjs';

const FIELDS = {
  name: 'contact-notes-name', country: 'contact-notes-country', source: 'contact-notes-source',
  followStatus: 'contact-notes-follow-status', nextFollowUp: 'contact-notes-next-follow-up',
  notes: 'contact-notes-text',
};

export function createContactNotesView(document, actions) {
  const $ = (id) => document.getElementById(id);
  const popover = $('contact-notes-popover');
  const button = $('btn-contact-notes');
  const chat = $('contact-notes-chat');
  const fields = Object.fromEntries(Object.entries(FIELDS).map(([key, id]) => [key, $(id)]));
  const count = $('contact-notes-count');
  const status = $('contact-notes-status');
  const listeners = [];
  const bind = (node, event, action) => {
    node.dataset.wired = 'true';
    node.addEventListener(event, action);
    listeners.push(() => node.removeEventListener(event, action));
  };
  button.setAttribute('aria-controls', 'contact-notes-popover');
  button.setAttribute('aria-haspopup', 'dialog');
  button.title = '联系人备注';
  button.setAttribute('aria-label', '联系人备注');
  bind(button, 'click', actions.toggle);
  bind($('contact-notes-close'), 'click', actions.close);
  for (const field of Object.values(fields)) {
    bind(field, 'input', () => { updateCount(); setStatus('', 'idle'); });
  }
  bind($('contact-notes-save'), 'click', actions.save);
  bind($('contact-notes-delete'), 'click', actions.remove);
  status.setAttribute('aria-live', 'polite');

  function updateCount() { count.textContent = `${fields.notes.value.length} / ${MAX_NOTE_LENGTH}`; }
  function setStatus(message, state) {
    status.textContent = message || '';
    status.dataset.state = state || 'idle';
  }
  function renderForm(profile) {
    for (const [key, element] of Object.entries(fields)) element.value = profile[key] || '';
    updateCount();
  }
  function readForm() {
    return Object.fromEntries(Object.entries(fields).map(([key, element]) => [key, element.value]));
  }
  function render({ identity, profile, open, connected, shellBusy, saving, noteError, saved }) {
    const enabled = connected && !shellBusy && Boolean(identity) && !saving;
    button.disabled = !connected || shellBusy;
    button.setAttribute('aria-expanded', String(open));
    for (const element of Object.values(fields)) element.disabled = !enabled;
    $('contact-notes-save').disabled = !enabled;
    $('contact-notes-delete').disabled = !enabled || !profile
      || !Object.values(profile).some(Boolean);
    chat.textContent = summary(profile || EMPTY_PROFILE, identity);
    chat.dataset.state = identity ? 'ready' : 'idle';
    setStatus(noteError ? (saved ? '客户资料已保存' : noteError) : saved ? '客户资料已保存' : '',
      saved ? 'success' : noteError ? 'error' : 'idle');
    if (saved && !identity) setStatus('', 'idle');
  }
  return {
    render, readForm, renderForm,
    setStatus, updateCount,
    popover, button, fields,
    dispose: () => listeners.forEach((remove) => remove()),
  };
}
