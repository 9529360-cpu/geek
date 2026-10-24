export function element(document, tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function wire(node, unavailable = false) {
  node.dataset.wired = 'true';
  node.dataset.unavailable = String(unavailable);
  node.disabled = unavailable;
  return node;
}

export function button(document, text, handler, className = 'bc-btn bc-btn--small') {
  const node = element(document, 'button', className, text);
  node.type = 'button';
  wire(node);
  node.addEventListener('click', handler);
  return node;
}

export function hidden(node, value) {
  node.classList.toggle('hidden', value);
  node.setAttribute('aria-hidden', String(value));
}

export function unavailable(node, reason = '尚未迁移') {
  wire(node, true);
  node.title = reason;
  node.setAttribute('aria-label', `${node.textContent || node.getAttribute('aria-label') || '此功能'} · ${reason}`);
}

export function statusNode(document, id, className) {
  const node = element(document, 'div', className);
  node.id = id;
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  node.setAttribute('aria-atomic', 'true');
  return node;
}
