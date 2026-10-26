// Text-only broadcast for Messenger, Instagram and Telegram A.
// Chat list, open and confirmations follow the existing page scripts.
// Telegram A reports the button click as submitted, matching the old
// transport's CLICKED result. Messenger and Instagram still require the
// transcript to advance; MAYBE stays unconfirmed.
function createPageBroadcastAdapter(kind) {
  let serial = 0;
  const issue = (code) => Object.assign(new Error(code), { code });
  const targetId = (value) => {
    if (kind === 'telegram-a') return String(value || '').startsWith('tg:') ? telegramAPeer(`#${String(value).slice(3)}`) : '';
    if (kind === 'messenger') return messengerConversationId(value);
    return instagramConversationId(value);
  };
  function instagramThreadKey(node) {
    const fiberKey = Object.keys(node || {}).find((key) => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? node[fiberKey] : null;
    for (let depth = 0; fiber && depth < 16; depth += 1, fiber = fiber.return) {
      const value = fiber.memoizedProps?.threadKeyForSelection ?? fiber.pendingProps?.threadKeyForSelection;
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return '';
  }
  function clean(value) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 256);
  }
  function listMessenger() {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('a[href*="/messages/"]').forEach((anchor) => {
      let id = '';
      try {
        id = messengerConversationId(new URL(anchor.getAttribute('href') || anchor.href, window.location.href).pathname);
      } catch { id = ''; }
      const name = clean(anchor.innerText || anchor.textContent);
      if (!id || seen.has(id) || !name) return;
      seen.add(id);
      out.push({ id, name, realName: '', kind: 'contact' });
    });
    return out;
  }
  function listInstagram() {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('[role="button"]').forEach((button) => {
      const key = instagramThreadKey(button);
      if (!pageSegment(key)) return;
      const id = instagramConversationId(`/direct/t/${key}`);
      const name = clean(String(button.innerText || button.textContent || '').split(/\n+/)[0]) || 'Instagram 联系人';
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({ id, name: name.slice(0, 240), realName: '', kind: 'contact' });
    });
    return out;
  }
  function listTelegram() {
    const out = [];
    const seen = new Set();
    document.querySelectorAll('.chat-item-clickable').forEach((row) => {
      const anchor = row.querySelector('a');
      if (!anchor) return;
      const href = String(anchor.getAttribute('href') || '');
      const id = telegramAPeer(href.startsWith('#') ? href : `#${href}`);
      const title = row.querySelector('[class*="title"], .peer-title');
      const name = clean(title ? title.textContent : '');
      if (!id || seen.has(id) || !name) return;
      seen.add(id);
      out.push({ id, name, realName: name, kind: id.startsWith('tg:-') ? 'group' : 'contact' });
    });
    return out;
  }
  async function openTarget(id) {
    if (typeof document === 'undefined') return false;
    if (kind === 'telegram-a') {
      const peer = id.slice(3);
      const anchor = [...document.querySelectorAll('.chat-item-clickable a')]
        .find((node) => node.getAttribute('href') === `#${peer}`);
      if (!anchor) return false;
      pageClick(anchor);
    } else if (kind === 'messenger') {
      const anchor = [...document.querySelectorAll('a[href*="/messages/"]')].find((node) => {
        try {
          return messengerConversationId(new URL(node.getAttribute('href') || node.href, window.location.href).pathname) === id;
        } catch { return false; }
      });
      if (!anchor) return false;
      anchor.click();
    } else {
      const key = id.split('/').pop();
      const button = [...document.querySelectorAll('[role="button"]')].find((node) => instagramThreadKey(node) === key);
      if (!button) return false;
      button.click();
    }
    for (let attempt = 0; attempt < 16; attempt += 1) {
      if (pageConversationId(kind) === id) return true;
      await pageWait(250);
    }
    return pageConversationId(kind) === id;
  }
  function capabilities() {
    let text = false;
    try { text = pageOwned(kind) && typeof document !== 'undefined'; } catch { text = false; }
    return { text, scheduled: text, attachments: false, tagAll: false, groupMembers: false, vcards: false };
  }
  async function ready() {
    if (!pageOwned(kind) || typeof document === 'undefined') throw issue('ACCOUNT_UNAVAILABLE');
  }
  async function listChats() {
    await ready();
    const chats = kind === 'messenger' ? listMessenger() : kind === 'instagram' ? listInstagram() : listTelegram();
    if (chats.length > 20000) throw issue('CAPABILITY_UNAVAILABLE');
    return chats;
  }
  async function prepare(request) {
    await ready();
    const files = request?.attachments || [];
    const id = targetId(request?.targetId);
    if (!request || request.tagAll !== false || !Array.isArray(request.vcards) || request.vcards.length
      || !Array.isArray(files) || files.length || typeof request.message !== 'string' || !request.message.trim()
      || id !== request.targetId) throw issue('CAPABILITY_UNAVAILABLE');
    return { request: { targetId: id, message: request.message, tagAll: false, vcards: [], attachments: [] } };
  }
  async function dispatch(prepared, valid) {
    let clicked = false;
    try {
      if (!valid()) throw issue('CANCELLED');
      const request = prepared?.request;
      if (!request || request.attachments?.length || request.vcards?.length || request.tagAll) throw issue('CAPABILITY_UNAVAILABLE');
      const opened = await openTarget(request.targetId);
      const openedGuard = authorizeSend({ opened, currentChatId: pageConversationId(kind),
        targetChatId: request.targetId, needsComposer: false });
      if (!openedGuard.ok) throw issue('TARGET_CHANGED');
      const editor = pageEditors(kind)[0];
      const replaced = editor ? pageReplaceText(editor, request.message) : 'failed';
      if (replaced !== 'ok') {
        return replaced === 'changed'
          ? { status: 'uncertain', code: 'RUNTIME_FAILED' }
          : { status: 'notSubmitted', code: 'NOT_SUBMITTED' };
      }
      const actual = pageText(editor);
      const composerGuard = authorizeSend({ opened: true, currentChatId: pageConversationId(kind),
        targetChatId: request.targetId, needsComposer: true, composerResult: 'OK',
        expectedComposerText: request.message, actualComposerText: actual });
      if (!composerGuard.ok) return { status: 'notSubmitted', code: 'NOT_SUBMITTED' };
      const before = pageSnapshot(kind, editor, request.message);
      const button = pageSendButton(kind, editor);
      if (button) pageClick(button);
      else pagePressEnter(editor);
      clicked = true;
      if (kind === 'telegram-a' && button) {
        serial += 1;
        return { status: 'confirmed', receipt: `page:${kind}:${serial}` };
      }
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await pageWait(250);
        if (!valid() || pageConversationId(kind) !== request.targetId) return { status: 'uncertain', code: 'TARGET_CHANGED' };
        if (pageConfirmed(kind, before, pageSnapshot(kind, editor, request.message))) {
          serial += 1;
          return { status: 'confirmed', receipt: `page:${kind}:${serial}` };
        }
      }
      return { status: 'uncertain', code: 'RUNTIME_FAILED' };
    } catch (error) {
      const code = error?.code || 'RUNTIME_FAILED';
      if (!clicked && ['CAPABILITY_UNAVAILABLE', 'TARGET_CHANGED', 'NOT_SUBMITTED', 'ACCOUNT_UNAVAILABLE'].includes(code)) {
        return { status: 'notSubmitted', code };
      }
      return { status: 'uncertain', code };
    }
  }
  const unavailable = async () => { throw issue('CAPABILITY_UNAVAILABLE'); };
  return { capabilities, ready, listChats, prepare, dispatch, audienceOptions: async () => null,
    groupMembers: unavailable, labelMembers: unavailable, resolveContacts: unavailable,
    dispatchAttachment: async () => ({ status: 'notSubmitted', code: 'CAPABILITY_UNAVAILABLE' }),
    openChat: unavailable, setComposerText: unavailable, sendText: dispatch,
    getCurrentChat: () => pageConversationId(kind) };
}
