'use strict';

const { createInternalCdp, storagePathLeaf } = require('./internal-cdp.cjs');

const SUPPORTED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif']);
const SELECTORS = Object.freeze({
  editor: '#editable-message-text-modal',
  attachButton: '#attach-menu-button',
  photoMenuIcon: '#attach-menu-controls .MenuItem .icon-photo',
  sendIcon: '.icon-new-send',
  cancelButton: 'button[aria-label="Cancel attachments"]',
  preview: '.modal-content img[draggable="false"], .modal-content video',
});

function createCodeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function fingerprint(value) {
  const text = normalizeText(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Object.freeze({ length: text.length, hash: hash >>> 0 });
}

function normalizeCdpValue(response) {
  return response && response.result ? response.result.value : undefined;
}

async function evaluateValue(send, expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true });
  return normalizeCdpValue(result);
}

async function waitForValue(send, expression, predicate, options = {}) {
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const attempts = Number.isSafeInteger(options.attempts) ? options.attempts : 80;
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : 250;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await evaluateValue(send, expression);
    if (predicate(value)) return value;
    if (attempt + 1 < attempts) await sleep(intervalMs);
  }
  throw createCodeError(options.errorCode || 'TG_NATIVE_ATTACH_STATE_TIMEOUT');
}

async function realClick(send, point) {
  if (!point || point.ok !== true || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw createCodeError('TG_NATIVE_ATTACH_TARGET_NOT_READY');
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1,
  });
}

const ROUTE_FINGERPRINT_EXPRESSION = `(() => { /* TG_ROUTE_FINGERPRINT */
  const text = String(location.hash || '').replace(/^#/, '').split('?')[0].replace(/\\r\\n/g, '\\n').trim();
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return { length: text.length, hash: hash >>> 0 };
})()`;

const ATTACHMENT_STATE_EXPRESSION = `(() => { /* TG_ATTACHMENT_STATE */
  const editor = document.querySelector(${JSON.stringify(SELECTORS.editor)});
  const modal = editor?.closest('.Modal');
  const sendButton = modal?.querySelector(${JSON.stringify(SELECTORS.sendIcon)})?.closest('button');
  const previewCount = modal ? modal.querySelectorAll(${JSON.stringify(SELECTORS.preview)}).length : 0;
  return {
    editor: !!editor,
    previewCount,
    sendReady: !!(sendButton && !sendButton.disabled && sendButton.getBoundingClientRect().width > 0),
  };
})()`;

const CAPTION_FINGERPRINT_EXPRESSION = `(() => { /* TG_CAPTION_FINGERPRINT */
  const editor = document.querySelector(${JSON.stringify(SELECTORS.editor)});
  if (!editor) return { editor: false, length: 0, hash: 0 };
  const text = String(editor.innerText || '').replace(/\\r\\n/g, '\\n').trim();
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return { editor: true, length: text.length, hash: hash >>> 0 };
})()`;

const CLEAR_CAPTION_EXPRESSION = `(() => { /* TG_CLEAR_CAPTION */
  const editor = document.querySelector(${JSON.stringify(SELECTORS.editor)});
  if (!editor) return true;
  editor.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand('delete', false, null);
  return true;
})()`;

function pointExpression(kind) {
  if (kind === 'attach') {
    return `(() => { /* TG_POINT_ATTACH */
      const el = document.querySelector(${JSON.stringify(SELECTORS.attachButton)});
      if (!el) return { ok: false };
      const rect = el.getBoundingClientRect();
      return { ok: rect.width > 0 && rect.height > 0, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`;
  }
  if (kind === 'photo') {
    return `(() => { /* TG_POINT_PHOTO */
      const icon = document.querySelector(${JSON.stringify(SELECTORS.photoMenuIcon)});
      const el = icon?.closest('.MenuItem');
      if (!el) return { ok: false };
      const rect = el.getBoundingClientRect();
      return { ok: rect.width > 0 && rect.height > 0, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`;
  }
  if (kind === 'send') {
    return `(() => { /* TG_POINT_SEND */
      const editor = document.querySelector(${JSON.stringify(SELECTORS.editor)});
      const modal = editor?.closest('.Modal');
      const el = modal?.querySelector(${JSON.stringify(SELECTORS.sendIcon)})?.closest('button');
      if (!el || el.disabled) return { ok: false };
      const rect = el.getBoundingClientRect();
      return { ok: rect.width > 0 && rect.height > 0, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`;
  }
  if (kind === 'cancel') {
    return `(() => { /* TG_POINT_CANCEL */
      const editor = document.querySelector(${JSON.stringify(SELECTORS.editor)});
      const modal = editor?.closest('.Modal');
      const el = modal?.querySelector(${JSON.stringify(SELECTORS.cancelButton)});
      if (!el) return { ok: false };
      const rect = el.getBoundingClientRect();
      return { ok: rect.width > 0 && rect.height > 0, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`;
  }
  throw createCodeError('TG_NATIVE_ATTACH_SELECTOR_INVALID');
}

function waitForFileChooser({ send, onEvent, files, timeoutMs = 10000 }) {
  let off = () => {};
  let timer = null;
  let settled = false;
  const promise = new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      off();
      callback(value);
    };
    off = onEvent((method, params) => {
      if (method !== 'Page.fileChooserOpened') return;
      const backendNodeId = params && params.backendNodeId;
      if (!backendNodeId) {
        finish(reject, createCodeError('TG_NATIVE_ATTACH_CHOOSER_NODE_MISSING'));
        return;
      }
      if (files.length > 1 && params.mode && params.mode !== 'selectMultiple') {
        finish(reject, createCodeError('TG_NATIVE_ATTACH_CHOOSER_NOT_MULTIPLE'));
        return;
      }
      Promise.resolve(send('DOM.setFileInputFiles', { backendNodeId, files }))
        .then(() => finish(resolve, true))
        .catch(() => finish(reject, createCodeError('TG_NATIVE_ATTACH_FILE_SET_FAILED')));
    });
    timer = setTimeout(() => finish(reject, createCodeError('TG_NATIVE_ATTACH_CHOOSER_TIMEOUT')), timeoutMs);
  });
  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      off();
    },
  };
}

async function clearAndCancelAttachment(send, options = {}) {
  try { await evaluateValue(send, CLEAR_CAPTION_EXPRESSION); } catch { /* best-effort cleanup */ }
  try {
    const point = await evaluateValue(send, pointExpression('cancel'));
    if (point?.ok === true) await realClick(send, point);
  } catch { /* best-effort cleanup */ }
  try {
    await waitForValue(send, ATTACHMENT_STATE_EXPRESSION, (value) => value?.editor !== true, {
      sleep: options.sleep,
      attempts: options.cleanupAttempts || 20,
      intervalMs: options.intervalMs || 100,
      errorCode: 'TG_NATIVE_ATTACH_CLEANUP_TIMEOUT',
    });
  } catch { /* cleanup timeout must not mask the original failure */ }
}

async function sendTelegramAttachmentsViaCdp(ctx, payload, options = {}) {
  const { send, onEvent } = ctx || {};
  if (typeof send !== 'function' || typeof onEvent !== 'function') {
    throw new TypeError('CDP send/onEvent are required');
  }
  const filePaths = Array.isArray(payload?.filePaths) ? payload.filePaths : [];
  if (!filePaths.length || filePaths.length > 10 || filePaths.some((value) => typeof value !== 'string' || !value)) {
    throw createCodeError('TG_NATIVE_ATTACH_FILES_INVALID');
  }
  const caption = String(payload?.caption || '');
  const targetFingerprint = fingerprint(payload?.targetChatId || '');
  if (!targetFingerprint.length) throw createCodeError('TG_NATIVE_ATTACH_TARGET_INVALID');

  await send('Page.enable');
  await send('DOM.enable');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  let chooser = null;
  let completed = false;
  try {
    const currentRoute = await evaluateValue(send, ROUTE_FINGERPRINT_EXPRESSION);
    if (currentRoute?.length !== targetFingerprint.length || currentRoute?.hash !== targetFingerprint.hash) {
      throw createCodeError('TG_NATIVE_ATTACH_TARGET_MISMATCH');
    }

    const staleState = await evaluateValue(send, ATTACHMENT_STATE_EXPRESSION);
    if (staleState?.editor === true) {
      await clearAndCancelAttachment(send, options);
      const cleared = await evaluateValue(send, ATTACHMENT_STATE_EXPRESSION);
      if (cleared?.editor === true) throw createCodeError('TG_NATIVE_ATTACH_STALE_EDITOR');
    }

    chooser = waitForFileChooser({
      send,
      onEvent,
      files: filePaths,
      timeoutMs: options.chooserTimeoutMs,
    });

    const attachPoint = await waitForValue(send, pointExpression('attach'), (value) => value?.ok === true, {
      sleep: options.sleep,
      attempts: options.menuAttempts || 50,
      intervalMs: options.intervalMs || 100,
      errorCode: 'TG_NATIVE_ATTACH_BUTTON_TIMEOUT',
    });
    await realClick(send, attachPoint);

    const photoPoint = await waitForValue(send, pointExpression('photo'), (value) => value?.ok === true, {
      sleep: options.sleep,
      attempts: options.menuAttempts || 50,
      intervalMs: options.intervalMs || 100,
      errorCode: 'TG_NATIVE_ATTACH_PHOTO_MENU_TIMEOUT',
    });
    await realClick(send, photoPoint);
    await chooser.promise;

    await waitForValue(send, ATTACHMENT_STATE_EXPRESSION, (value) => (
      value?.editor === true && value?.sendReady === true && Number(value?.previewCount || 0) >= filePaths.length
    ), {
      sleep: options.sleep,
      attempts: options.readyAttempts || 120,
      intervalMs: options.readyIntervalMs || 250,
      errorCode: 'TG_NATIVE_ATTACH_EDITOR_NOT_READY',
    });

    await evaluateValue(send, CLEAR_CAPTION_EXPRESSION);
    const empty = await waitForValue(send, CAPTION_FINGERPRINT_EXPRESSION, (value) => value?.editor === true && value?.length === 0, {
      sleep: options.sleep,
      attempts: options.captionAttempts || 20,
      intervalMs: options.intervalMs || 100,
      errorCode: 'TG_NATIVE_ATTACH_CAPTION_CLEAR_FAILED',
    });
    if (!empty?.editor) throw createCodeError('TG_NATIVE_ATTACH_EDITOR_LOST');

    if (caption) await send('Input.insertText', { text: caption });
    const expectedCaption = fingerprint(caption);
    await waitForValue(send, CAPTION_FINGERPRINT_EXPRESSION, (value) => (
      value?.editor === true && value?.length === expectedCaption.length && value?.hash === expectedCaption.hash
    ), {
      sleep: options.sleep,
      attempts: options.captionAttempts || 30,
      intervalMs: options.intervalMs || 100,
      errorCode: 'TG_NATIVE_ATTACH_CAPTION_NOT_READY',
    });

    const sendPoint = await waitForValue(send, pointExpression('send'), (value) => value?.ok === true, {
      sleep: options.sleep,
      attempts: options.sendButtonAttempts || 40,
      intervalMs: options.intervalMs || 100,
      errorCode: 'TG_NATIVE_ATTACH_SEND_BUTTON_TIMEOUT',
    });
    await realClick(send, sendPoint);

    await waitForValue(send, ATTACHMENT_STATE_EXPRESSION, (value) => value?.editor !== true, {
      sleep: options.sleep,
      attempts: options.sentAttempts || 120,
      intervalMs: options.sentIntervalMs || 250,
      errorCode: 'TG_NATIVE_ATTACH_SUBMIT_NOT_CONSUMED',
    });
    completed = true;
    return 'SENT';
  } catch (error) {
    if (!completed) await clearAndCancelAttachment(send, options);
    if (error && typeof error.code === 'string' && error.code.startsWith('TG_NATIVE_ATTACH_')) throw error;
    throw createCodeError('TG_NATIVE_ATTACH_CDP_FAILED');
  } finally {
    if (chooser) chooser.cancel();
    try { await send('Page.setInterceptFileChooserDialog', { enabled: false }); } catch { /* ignore */ }
  }
}

function isTelegramAUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.hostname === 'web.telegram.org' && (url.pathname === '/a' || url.pathname.startsWith('/a/'));
  } catch {
    return false;
  }
}

function createTelegramNativeAttachmentHandler(options = {}) {
  const getAllWebContents = options.getAllWebContents;
  if (typeof getAllWebContents !== 'function') throw new TypeError('getAllWebContents is required');
  const internalCdp = options.internalCdp || createInternalCdp({
    getAllWebContents,
    timeoutMs: options.timeoutMs || 15000,
    externalDebugging: false,
  });

  function findTelegramAGuest(partition, preferredGuestId) {
    const partitionLeaf = String(partition || '').split(':').pop();
    if (!partitionLeaf || !Number.isSafeInteger(Number(preferredGuestId))) return null;
    const candidate = getAllWebContents().find((guest) => Number(guest?.id) === Number(preferredGuestId));
    if (!candidate) return null;
    return storagePathLeaf(candidate?.session?.storagePath) === partitionLeaf && isTelegramAUrl(candidate.getURL?.())
      ? candidate : null;
  }

  async function send(payload = {}) {
    const partition = String(payload.partition || '');
    const guestId = Number(payload.guestId);
    const selectedFiles = Array.isArray(payload.files) ? payload.files : [];
    if (!partition || !Number.isSafeInteger(guestId)) throw createCodeError('TG_NATIVE_ATTACH_CONTEXT_INVALID');
    if (!selectedFiles.length || selectedFiles.length > 10) throw createCodeError('TG_NATIVE_ATTACH_FILES_INVALID');
    if (selectedFiles.some((file) => !SUPPORTED_IMAGE_MIMES.has(String(file?.mime || '').toLowerCase()))) {
      throw createCodeError('TG_NATIVE_ATTACH_IMAGE_TYPE_UNSUPPORTED');
    }
    const filePaths = selectedFiles.map((file) => String(file?.filePath || ''));
    if (filePaths.some((filePath) => !filePath)) throw createCodeError('TG_NATIVE_ATTACH_FILES_INVALID');
    const guest = findTelegramAGuest(partition, guestId);
    if (!guest) throw createCodeError('TG_NATIVE_ATTACH_A_GUEST_NOT_FOUND');
    try {
      return await internalCdp.run(partition, 'telegram-z', (ctx) => sendTelegramAttachmentsViaCdp(ctx, {
        filePaths,
        caption: String(payload.caption || ''),
        targetChatId: String(payload.targetChatId || ''),
      }, options), guest.id);
    } catch (error) {
      if (error && typeof error.code === 'string' && error.code.startsWith('TG_NATIVE_ATTACH_')) throw error;
      throw createCodeError('TG_NATIVE_ATTACH_CDP_FAILED');
    }
  }

  return Object.freeze({ send });
}

module.exports = {
  SELECTORS,
  SUPPORTED_IMAGE_MIMES,
  fingerprint,
  isTelegramAUrl,
  sendTelegramAttachmentsViaCdp,
  createTelegramNativeAttachmentHandler,
};
