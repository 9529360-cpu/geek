'use strict';
// guest 页面桥（WA/TG webview preload）：运行在隔离世界。
// 页面脚本通过 window.postMessage({__geekBridge:true, payload}) 上报，
// preload 校验同窗口来源后经 sendToHost('geek-bridge') 转发宿主。
// documentElement 上的 data-geek-bridge 标记供页面检测桥是否可用（DOM 属性跨世界共享）。
const { ipcRenderer } = require('electron');

const HOST_CHANNEL = 'geek-bridge';
const TRUSTED_SUBMIT_CHANNEL = 'geek-trusted-submit';
const TRUSTED_COMPOSER_CHANNEL = 'geek-trusted-composer-context';
const TRUSTED_SUBMIT_PROTOCOL_VERSION = 1;
const MARKER = 'data-geek-bridge';

// preload 时机 documentElement 可能尚未就绪：先标记 document，元素就绪后再补标记
// （DOM 属性跨世界共享，页面脚本可检测）。
function markReady() {
  try {
    const root = document.documentElement || (document.head && document.head.parentElement) || document;
    root.setAttribute(MARKER, '1');
    return true;
  } catch {
    return false;
  }
}
markReady();
document.addEventListener('readystatechange', () => markReady());
document.addEventListener('DOMContentLoaded', () => markReady());
setTimeout(markReady, 50);

const TELEGRAM_COMPOSER_SELECTOR = '#editable-message-text, .input-message-input[contenteditable="true"]:not(.input-field-input-fake)';
const TELEGRAM_SEND_SELECTOR = 'button.Button.send.main-button, button[aria-label="Send"], .btn-send';

function isTelegramPage() {
  try {
    return window.location.protocol === 'https:' && String(window.location.hostname || '').toLowerCase() === 'web.telegram.org';
  } catch {
    return false;
  }
}

function eventElement(event) {
  const target = event && event.target;
  return target && target.nodeType === 1 && typeof target.closest === 'function' ? target : null;
}

let telegramComposerGeneration = 0;
let telegramComposerElement = null;

function observeTelegramComposer(element, advance = false) {
  if (!element) return telegramComposerGeneration;
  if (telegramComposerElement !== element) {
    telegramComposerElement = element;
    telegramComposerGeneration += 1;
  } else if (advance) {
    telegramComposerGeneration += 1;
  }
  return telegramComposerGeneration;
}

function emitTrustedComposerContext(composerGeneration) {
  try {
    ipcRenderer.sendToHost(TRUSTED_COMPOSER_CHANNEL, {
      protocolVersion: TRUSTED_SUBMIT_PROTOCOL_VERSION,
      platform: 'telegram',
      composerGeneration,
    });
  } catch { /* trusted composer observation must never break native page behavior */ }
}

function emitTrustedSubmit(kind, composerGeneration) {
  try {
    ipcRenderer.sendToHost(TRUSTED_SUBMIT_CHANNEL, {
      protocolVersion: TRUSTED_SUBMIT_PROTOCOL_VERSION,
      platform: 'telegram',
      kind,
      composerGeneration,
    });
  } catch { /* trusted gesture observation must never break native page behavior */ }
}

document.addEventListener('focusin', (event) => {
  if (!isTelegramPage() || event?.isTrusted !== true) return;
  const target = eventElement(event);
  const composer = target?.closest(TELEGRAM_COMPOSER_SELECTOR);
  if (!composer) return;
  emitTrustedComposerContext(observeTelegramComposer(composer, false));
}, true);

document.addEventListener('beforeinput', (event) => {
  if (document.documentElement?.getAttribute?.('data-geek-native-submit-commit') === '1') return;
  if (!isTelegramPage() || event?.isTrusted !== true) return;
  const target = eventElement(event);
  const composer = target?.closest(TELEGRAM_COMPOSER_SELECTOR);
  if (!composer) return;
  emitTrustedComposerContext(observeTelegramComposer(composer, true));
}, true);

document.addEventListener('keydown', (event) => {
  if (document.documentElement?.getAttribute?.('data-geek-native-submit-commit') === '1') return;
  if (!isTelegramPage() || event?.isTrusted !== true) return;
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.isComposing || event.repeat) return;
  const target = eventElement(event);
  const composer = target?.closest(TELEGRAM_COMPOSER_SELECTOR);
  if (!composer) return;
  const composerGeneration = observeTelegramComposer(composer, false);
  emitTrustedSubmit('keyboard', composerGeneration);
}, true);

document.addEventListener('click', (event) => {
  if (!isTelegramPage() || event?.isTrusted !== true) return;
  const target = eventElement(event);
  if (!target || !target.closest(TELEGRAM_SEND_SELECTOR)) return;
  const composer = document.querySelector?.(TELEGRAM_COMPOSER_SELECTOR) || telegramComposerElement;
  const composerGeneration = observeTelegramComposer(composer, false);
  emitTrustedSubmit('button', composerGeneration);
}, true);

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || data.__geekBridge !== true) return;
  try {
    ipcRenderer.sendToHost(HOST_CHANNEL, data.payload);
  } catch { /* 转发失败不影响页面 */ }
});
