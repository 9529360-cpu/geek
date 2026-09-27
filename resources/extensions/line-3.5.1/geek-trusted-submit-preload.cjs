'use strict';

const { ipcRenderer } = require('electron');

const IS_MAIN_FRAME = process.isMainFrame === true;
const TRUSTED_SUBMIT_CHANNEL = 'geek-trusted-submit';
const TRUSTED_COMPOSER_CHANNEL = 'geek-trusted-composer-context';
const TRUSTED_SUBMIT_PROTOCOL_VERSION = 1;
const LINE_EXTENSION_ID = 'ophjlpahpchlmihnnnihgmmeilfjmjjc';
const LINE_COMPOSER_HOST_SELECTOR = 'textarea-ex[class*="chatroomEditor-module__textarea__"]';
const LINE_SEND_SELECTOR = 'button[aria-label*="send" i],button[type="submit"],[class*="chatroomEditor-module__editor_area__"] button[data-action="send"]';
const READY_MARKER = 'data-geek-line-trusted-submit';

function isLinePage() {
  if (!IS_MAIN_FRAME) return false;
  try {
    return window.location.protocol === 'chrome-extension:'
      && String(window.location.hostname || '').toLowerCase() === LINE_EXTENSION_ID;
  } catch {
    return false;
  }
}

function markReady() {
  if (!isLinePage()) return false;
  try {
    const root = document.documentElement || document;
    root.setAttribute(READY_MARKER, '1');
    return true;
  } catch { return false; }
}
markReady();
document.addEventListener('readystatechange', markReady);
document.addEventListener('DOMContentLoaded', markReady);
setTimeout(markReady, 50);

function eventPath(event) {
  try { return event?.composedPath?.() || []; } catch { return []; }
}

function composerHostFromEvent(event) {
  return eventPath(event).find(node =>
    node?.tagName === 'TEXTAREA-EX'
      && typeof node.matches === 'function'
      && node.matches(LINE_COMPOSER_HOST_SELECTOR)
  ) || null;
}

let composerGeneration = 0;
let composerHost = null;

function observeComposer(host, advance = false) {
  if (!host) return composerGeneration;
  if (composerHost !== host) {
    composerHost = host;
    composerGeneration += 1;
  } else if (advance) {
    composerGeneration += 1;
  }
  return composerGeneration;
}

function emitComposer(generation) {
  try {
    ipcRenderer.sendToHost(TRUSTED_COMPOSER_CHANNEL, {
      protocolVersion: TRUSTED_SUBMIT_PROTOCOL_VERSION,
      platform: 'line',
      composerGeneration: generation,
    });
  } catch {}
}

function emitSubmit(kind, generation) {
  try {
    ipcRenderer.sendToHost(TRUSTED_SUBMIT_CHANNEL, {
      protocolVersion: TRUSTED_SUBMIT_PROTOCOL_VERSION,
      platform: 'line',
      kind,
      composerGeneration: generation,
    });
  } catch {}
}

document.addEventListener('focusin', (event) => {
  if (document.documentElement?.getAttribute?.('data-geek-native-submit-commit') === '1') return;
  if (!isLinePage() || event?.isTrusted !== true) return;
  const host = composerHostFromEvent(event);
  if (!host) return;
  emitComposer(observeComposer(host, false));
}, true);

document.addEventListener('beforeinput', (event) => {
  if (document.documentElement?.getAttribute?.('data-geek-native-submit-commit') === '1') return;
  if (!isLinePage() || event?.isTrusted !== true) return;
  const host = composerHostFromEvent(event);
  if (!host) return;
  emitComposer(observeComposer(host, true));
}, true);

document.addEventListener('keydown', (event) => {
  if (document.documentElement?.getAttribute?.('data-geek-native-submit-commit') === '1') return;
  if (!isLinePage() || event?.isTrusted !== true) return;
  if (event.key !== 'Enter'
    || event.shiftKey
    || event.ctrlKey
    || event.altKey
    || event.metaKey
    || event.isComposing
    || event.repeat) return;
  const host = composerHostFromEvent(event);
  if (!host) return;
  emitSubmit('keyboard', observeComposer(host, false));
}, true);

document.addEventListener('click', (event) => {
  if (document.documentElement?.getAttribute?.('data-geek-native-submit-commit') === '1') return;
  if (!isLinePage() || event?.isTrusted !== true) return;
  const target = event?.target;
  const button = target && typeof target.closest === 'function'
    ? target.closest(LINE_SEND_SELECTOR)
    : null;
  if (!button || !button.closest?.('[class*="chatroomEditor-module__editor_area__"]')) return;
  const host = document.querySelector(LINE_COMPOSER_HOST_SELECTOR) || composerHost;
  emitSubmit('button', observeComposer(host, false));
}, true);
