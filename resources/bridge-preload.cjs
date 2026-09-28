'use strict';
const { ipcRenderer } = require('electron');

const HOST_CHANNEL = 'geek-bridge';
const TRUSTED_SUBMIT_CHANNEL = 'geek-trusted-submit';
const TRUSTED_COMPOSER_CHANNEL = 'geek-trusted-composer-context';
const TRUSTED_SUBMIT_PROTOCOL_VERSION = 1;
const MARKER = 'data-geek-bridge';
const NATIVE_COMMIT_MARKER = 'data-geek-native-submit-commit';

function markReady() {
  try {
    const root = document.documentElement || (document.head && document.head.parentElement) || document;
    root.setAttribute(MARKER, '1');
    return true;
  } catch { return false; }
}
markReady();
document.addEventListener('readystatechange', markReady);
document.addEventListener('DOMContentLoaded', markReady);
setTimeout(markReady, 50);

function eventElement(event) {
  const target = event && event.target;
  return target && target.nodeType === 1 && typeof target.closest === 'function' ? target : null;
}

function createTrustedSubmitObserver({ isPage, platform, composerSelector, sendSelector, sendIconSelector = '' }) {
  let composerGeneration = 0;
  let composerElement = null;
  const observeComposer = (element, advance = false) => {
    if (!element) return composerGeneration;
    if (composerElement !== element) { composerElement = element; composerGeneration += 1; }
    else if (advance) composerGeneration += 1;
    return composerGeneration;
  };
  const emitComposer = generation => { try { ipcRenderer.sendToHost(TRUSTED_COMPOSER_CHANNEL, { protocolVersion: TRUSTED_SUBMIT_PROTOCOL_VERSION, platform, composerGeneration: generation }); } catch {} };
  const emitSubmit = (kind, generation) => { try { ipcRenderer.sendToHost(TRUSTED_SUBMIT_CHANNEL, { protocolVersion: TRUSTED_SUBMIT_PROTOCOL_VERSION, platform, kind, composerGeneration: generation }); } catch {} };

  document.addEventListener('focusin', event => {
    if (!isPage() || event?.isTrusted !== true) return;
    const composer = eventElement(event)?.closest(composerSelector);
    if (composer) emitComposer(observeComposer(composer, false));
  }, true);
  document.addEventListener('beforeinput', event => {
    if (document.documentElement?.getAttribute?.(NATIVE_COMMIT_MARKER) === '1' || !isPage() || event?.isTrusted !== true) return;
    const composer = eventElement(event)?.closest(composerSelector);
    if (composer) emitComposer(observeComposer(composer, true));
  }, true);
  document.addEventListener('keydown', event => {
    if (document.documentElement?.getAttribute?.(NATIVE_COMMIT_MARKER) === '1' || !isPage() || event?.isTrusted !== true) return;
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing || event.repeat) return;
    const composer = eventElement(event)?.closest(composerSelector);
    if (composer) emitSubmit('keyboard', observeComposer(composer, false));
  }, true);
  document.addEventListener('click', event => {
    if (document.documentElement?.getAttribute?.(NATIVE_COMMIT_MARKER) === '1' || !isPage() || event?.isTrusted !== true) return;
    const target = eventElement(event); if (!target) return;
    const direct = target.closest(sendSelector);
    const iconButton = sendIconSelector && target.closest('button')?.querySelector?.(sendIconSelector) ? target.closest('button') : null;
    if (!direct && !iconButton) return;
    const composer = document.querySelector?.(composerSelector) || composerElement;
    if (composer) emitSubmit('button', observeComposer(composer, false));
  }, true);
}

createTrustedSubmitObserver({
  isPage: () => { try { return window.location.protocol === 'https:' && String(window.location.hostname || '').toLowerCase() === 'web.telegram.org'; } catch { return false; } },
  platform: 'telegram',
  composerSelector: '#editable-message-text, .input-message-input[contenteditable="true"]:not(.input-field-input-fake)',
  sendSelector: 'button.Button.send.main-button, button[aria-label="Send"], .btn-send',
});

createTrustedSubmitObserver({
  isPage: () => { try { return window.location.protocol === 'https:' && String(window.location.hostname || '').toLowerCase() === 'web.whatsapp.com'; } catch { return false; } },
  platform: 'whatsapp',
  composerSelector: '#main footer [contenteditable="true"], #main [data-testid="conversation-compose-box-input"], #main [contenteditable="true"][data-tab="10"]',
  sendSelector: 'button[aria-label="Send"], button[aria-label="发送"], [data-testid="compose-btn-send"]',
  sendIconSelector: '[data-icon="send"]',
});

window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || data.__geekBridge !== true) return;
  try { ipcRenderer.sendToHost(HOST_CHANNEL, data.payload); } catch {}
});
