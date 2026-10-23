// Incoming display only. No composer hook, privileged API, credential or send path.
const entries = new Map();
let binding = '';
let revoked = false;
let configuration = null;
let chatKey = '';
let needsBaseline = true;
let menu = null;
const MAX_ENTRIES = 1000;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const ROW = '[data-testid^="conv-msg-"][data-id]';
const errorText = Object.freeze({
  SESSION_REQUIRED: '请先在极客个人中心登录', SESSION_CHANGED: '登录状态已变化，请重试',
  SESSION_ACCOUNT_DISABLED: '此极客账号已停用', SESSION_PERSISTENCE: '登录状态未能保存，请检查后重试',
  TRANSLATION_QUOTA_EXHAUSTED: '翻译字符余额已用完', TRANSLATION_UNAUTHORIZED: '翻译授权失效，请重新检测登录',
  TRANSLATION_CANCELLED: '翻译已取消，点击重试', TRANSLATION_TIMEOUT: '翻译超时，点击查询同一次结果',
  TRANSLATION_LIMIT: '翻译队列已满，请稍后重试', TRANSLATION_CONFLICT: '此翻译请求有冲突，请重新打开聊天',
  TRANSLATION_RESULT_UNAVAILABLE: '此请求的译文暂不可取回，请稍后重试',
  TRANSLATION_OUTPUT_INVALID: '译文未通过校验；右键可重新翻译，将重新计费',
  TRANSLATION_UNAVAILABLE: '此消息需手动翻译，请点击翻译',
  NETWORK_UNAVAILABLE: '翻译服务暂不可达，点击查询同一次结果', NETWORK_RESPONSE_INVALID: '翻译服务返回异常，请稍后重试',
});
const validChat = (value) => /^\d[\d-]{0,39}@(c\.us|lid|g\.us)$/.test(value);
const wid = (value) => typeof value === 'string' ? value : value?._serialized || '';
const textOf = (node) => String(node?.querySelector('span[dir="ltr"],span[dir="rtl"]')?.innerText
  || node?.innerText || node?.textContent || '').replace(/\u200b/g, '').trim();

function context() {
  try {
    const chat = window.WPP?.chat?.getActiveChat?.();
    const id = wid(chat?.id);
    if (!validChat(id) || chat.isNewsletter || chat.isBroadcast || chat.isParentGroup || chat.groupMetadata?.parent) return null;
    const name = String(chat.formattedTitle || chat.name || chat.contact?.pushname || id).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 256);
    return { id, name };
  } catch { return null; }
}

const policyFor = (id) => configuration?.settings?.chats?.[id] || configuration?.settings?.global;
const entryKey = (entry) => JSON.stringify([entry.chatId, entry.messageId, entry.text, entry.sessionGeneration, entry.policyRevision]);
function semantics(settings, chatId) {
  const policy = settings?.chats?.[chatId] || settings?.global;
  return JSON.stringify([policy?.messageFrom, policy?.messageTarget, policy?.provider, policy?.route]);
}

function reconcileSettings(previous, next) {
  const retained = [...entries.values()].filter((entry) => semantics(previous, entry.chatId) === semantics(next, entry.chatId));
  entries.clear();
  for (const entry of retained) {
    entry.policyRevision = next.revision;
    entries.set(entryKey(entry), entry);
  }
}
function visible(root) {
  if (!root?.isConnected || document.visibilityState === 'hidden') return false;
  const rect = root.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight
    && rect.right > 0 && rect.left < window.innerWidth;
}

function metadata(root, chatId) {
  try {
    const id = root.getAttribute('data-id') || '';
    const message = window.WPP?.whatsapp?.MsgStore?.get?.(id);
    const remote = wid(message?.id?.remote);
    const incoming = message?.id?.fromMe === false && remote === chatId;
    return { incoming, sentAt: incoming && Number.isSafeInteger(message.t) && message.t > 0 ? message.t : 0 };
  } catch { return { incoming: false, sentAt: 0 }; }
}

function clearPresentation() {
  menu?.remove(); menu = null;
  for (const entry of entries.values()) {
    entry.box?.remove();
    entry.box = null;
    if (entry.pending) { entry.pending = false; entry.state = 'error'; entry.error = 'TRANSLATION_CANCELLED'; }
  }
}

function canUse(entry) {
  return !revoked && configuration?.active && configuration.sessionGeneration
    && window.__geekTauriPlatform?.matches(binding)
    && context()?.id === entry.chatId && entry.root?.isConnected
    && entry.node?.isConnected && entry.root.querySelector('[data-pre-plain-text]') === entry.node
    && entry.root.getAttribute('data-id') === entry.messageId && textOf(entry.node) === entry.text
    && entry.sessionGeneration === configuration.sessionGeneration
    && entry.policyRevision === configuration.settings.revision
    && policyFor(entry.chatId)?.displayTranslation === true;
}

function paint(entry) {
  const box = entry.box;
  if (!box) return;
  const policy = policyFor(entry.chatId);
  box.style.color = entry.state === 'error' ? '#ff8a8a' : policy.fontColor;
  box.style.fontSize = `${policy.fontSize}px`;
  box.style.cursor = entry.state === 'wait' || (entry.state === 'error' && !entry.receivedSuccess) ? 'pointer' : 'default';
  box.textContent = entry.state === 'done' ? entry.output : entry.pending ? '翻译中…'
    : entry.state === 'error' ? errorText[entry.error] || '翻译暂不可用，点击重试' : '点击翻译';
  box.setAttribute('aria-busy', String(entry.pending));
}

function submit(entry, manual, refresh = false) {
  if (entry.pending || !canUse(entry)) return;
  if (entry.receivedSuccess && !refresh) return;
  const policy = policyFor(entry.chatId);
  if (manual && !policy.messageAction) return;
  if (!manual && (entry.manualOnly || policy.translationMode !== 'auto' || !entry.incoming || !entry.sentAt
      || entry.sentAt < configuration.autoAfter || (entry.chatId.endsWith('@g.us') && !policy.groupAuto)
      || (policy.messageTarget === 'zh' && /[\u3400-\u9fff]/.test(entry.text)))) return;
  if ([...entries.values()].filter((item) => item.pending).length >= 10) {
    entry.state = 'error'; entry.error = 'TRANSLATION_LIMIT'; paint(entry); return;
  }
  if (!entry.id || refresh) {
    entry.id = crypto.randomUUID(); entry.attempt = 0; entry.refresh = refresh; entry.receivedSuccess = false;
  }
  entry.attempt += 1;
  if (entry.attempt > 10000) { entry.state = 'error'; entry.error = 'TRANSLATION_LIMIT'; paint(entry); return; }
  entry.manual = manual;
  entry.pending = true;
  entry.state = 'loading';
  entry.started = performance.now();
  paint(entry);
}

function mount(entry) {
  if (entry.box?.isConnected) { paint(entry); return; }
  const box = document.createElement('div');
  box.className = 'trans-wrap geek-translation-result';
  box.dataset.geekPlatform = 'whatsapp';
  box.dataset.messageId = entry.messageId;
  Object.assign(box.style, { paddingTop: '3px', lineHeight: '1.35', whiteSpace: 'pre-wrap' });
  box.setAttribute('role', 'button');
  box.tabIndex = 0;
  box.addEventListener('click', (event) => {
    if (event.isTrusted === true && ['wait', 'error'].includes(entry.state)) submit(entry, true);
  });
  box.addEventListener('keydown', (event) => {
    if (event.isTrusted === true && ['Enter', ' '].includes(event.key) && ['wait', 'error'].includes(entry.state)) {
      event.preventDefault(); submit(entry, true);
    }
  });
  entry.node.after(box);
  entry.box = box;
  paint(entry);
}

function scan() {
  const chat = context();
  if (chat?.id !== chatKey) { clearPresentation(); chatKey = chat?.id || ''; needsBaseline = true; }
  if (!configuration?.active || !chat || !configuration.sessionGeneration || revoked) return chat;
  const policy = policyFor(chat.id);
  if (!policy?.displayTranslation) return chat;
  const rows = [...document.querySelectorAll(`#main ${ROW}`)].slice(-200);
  const baseline = needsBaseline;
  needsBaseline = false;
  for (const root of rows) {
    if (!visible(root)) continue;
    const node = root.querySelector('[data-pre-plain-text]');
    const messageId = root.getAttribute('data-id') || '';
    const text = textOf(node);
    if (!node || !messageId || messageId.length > 256 || !text || text.length > 10000
        || new TextEncoder().encode(text).length > 32768 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) continue;
    const key = entryKey({ chatId: chat.id, messageId, text,
      sessionGeneration: configuration.sessionGeneration, policyRevision: configuration.settings.revision });
    let entry = entries.get(key);
    if (!entry) {
      const bytes = [...entries.values()].reduce((sum, item) => sum + item.text.length * 2 + (item.output?.length || 0) * 2, 0);
      if (entries.size >= MAX_ENTRIES || bytes + text.length * 2 > MAX_TEXT_BYTES) continue;
      const info = metadata(root, chat.id);
      entry = { chatId: chat.id, messageId, text, ...info, state: 'wait', pending: false,
        sessionGeneration: configuration.sessionGeneration, policyRevision: configuration.settings.revision };
      entries.set(key, entry);
    }
    entry.root = root; entry.node = node;
    // Entering a chat or enabling auto never bills rows already on screen.
    if (baseline) entry.manualOnly = true;
    if (entry.pending && performance.now() - entry.started > 37000) {
      entry.pending = false; entry.state = 'error'; entry.error = 'TRANSLATION_TIMEOUT';
    }
    if (policy.messageAction || entry.state !== 'wait') mount(entry);
    // Old history is manual-only. Unknown direction/time never enters paid auto work.
    if (entry.state === 'wait') submit(entry, false);
    if (entry.pending && !entry.box) mount(entry);
  }
  return chat;
}

document.addEventListener('contextmenu', (event) => {
  if (event.isTrusted !== true || !configuration?.active) return;
  const root = event.target?.closest?.(ROW);
  const entry = [...entries.values()].find((item) => item.root === root && canUse(item));
  if (!entry || !policyFor(entry.chatId)?.messageAction || entry.pending) return;
  event.preventDefault(); event.stopPropagation();
  menu?.remove();
  menu = document.createElement('div'); menu.id = 'geek-translation-menu';
  Object.assign(menu.style, { position: 'fixed', left: `${Math.max(0, Math.min(event.clientX, window.innerWidth - 130))}px`,
    top: `${Math.max(0, Math.min(event.clientY, window.innerHeight - 45))}px`, zIndex: '999999', background: '#202c33',
    border: '1px solid #3b4a54', borderRadius: '7px', padding: '5px', boxShadow: '0 8px 24px rgba(0,0,0,.35)' });
  const button = document.createElement('button'); button.type = 'button';
  button.textContent = entry.receivedSuccess ? '重新翻译' : '翻译此消息';
  Object.assign(button.style, { width: '112px', border: '0', borderRadius: '5px', background: 'transparent',
    color: '#e9edef', textAlign: 'left', padding: '7px 9px', cursor: 'pointer' });
  button.addEventListener('click', (click) => {
    if (click.isTrusted !== true) return;
    menu?.remove(); menu = null;
    submit(entry, true, entry.receivedSuccess === true);
  });
  menu.append(button); document.body.append(menu);
}, true);
document.addEventListener('mousedown', (event) => {
  if (menu && !menu.contains(event.target)) { menu.remove(); menu = null; }
}, true);

const api = Object.freeze({
  configure(value) {
    if (revoked || !value || !window.__geekTauriPlatform?.matches(value.generation)
        || (binding && binding !== value.generation)) return false;
    binding ||= value.generation;
    const sessionChanged = !configuration || configuration.sessionGeneration !== value.sessionGeneration;
    const policyChanged = configuration?.settings?.revision !== value.settings?.revision;
    if (sessionChanged || policyChanged) {
      clearPresentation(); needsBaseline = true;
      if (sessionChanged) entries.clear();
      else reconcileSettings(configuration.settings, value.settings);
    }
    if (configuration?.active !== value.active) needsBaseline = true;
    if (!value.active) clearPresentation();
    configuration = value;
    return true;
  },
  context(expected) { return expected === binding && !revoked ? context() : null; },
  poll(expected) {
    if (expected !== binding || revoked || !window.__geekTauriPlatform?.matches(binding)) return null;
    for (const entry of entries.values()) {
      if (!canUse(entry)) {
        entry.box?.remove(); entry.box = null;
        if (entry.pending) { entry.pending = false; entry.state = 'error'; entry.error = 'TRANSLATION_CANCELLED'; }
      }
    }
    const chat = scan();
    const requests = [...entries.values()].filter((entry) => entry.pending && canUse(entry)).slice(0, 10).map((entry) => ({
      id: entry.id, chatId: entry.chatId, messageId: entry.messageId, text: entry.text, manual: entry.manual,
      refresh: entry.refresh, policyRevision: entry.policyRevision, attempt: entry.attempt, sentAt: entry.sentAt,
    }));
    return { chat, requests };
  },
  deliver(expected, sessionGeneration, revision, id, attempt, result) {
    const entry = [...entries.values()].find((item) => item.id === id && item.attempt === attempt && item.pending);
    if (expected !== binding || sessionGeneration !== configuration?.sessionGeneration
        || revision !== configuration?.settings?.revision || !entry || !canUse(entry)) return false;
    entry.pending = false;
    if (result.error) { entry.state = 'error'; entry.error = result.error; }
    else {
      entry.receivedSuccess = true;
      const policy = policyFor(entry.chatId);
      const assessed = assessOutput({ source: entry.text, output: result.text, target: policy.messageTarget, sourceLanguage: policy.messageFrom });
      if (!assessed.ok) { entry.state = 'error'; entry.error = 'TRANSLATION_OUTPUT_INVALID'; }
      else { entry.state = 'done'; entry.output = assessed.text; }
    }
    paint(entry);
    return true;
  },
  revoke(expected) {
    if (binding !== expected) return;
    revoked = true; clearPresentation(); entries.clear(); configuration = null;
  },
});
Object.defineProperty(window, '__geekTauriTranslation', { value: api });
