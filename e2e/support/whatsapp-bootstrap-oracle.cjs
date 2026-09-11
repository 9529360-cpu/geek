'use strict';

const WHATSAPP_WEB_ORIGIN = 'https://web.whatsapp.com';
const MAX_DIAGNOSTIC_COUNT = 99;

function safeOrigin(value) {
  try {
    return new URL(String(value || '')).origin;
  } catch {
    return '';
  }
}

function boundedCount(value) {
  if (!Number.isInteger(value) || value < 0) return -1;
  return Math.min(value, MAX_DIAGNOSTIC_COUNT);
}

function rendererErrorCategory(state) {
  if (state.rendererProbeTimedOut === true) return 'renderer-timeout';
  if (state.rendererProbeFailed === true) return 'renderer-execute-failure';
  if (state.rendererProbeOk !== true) return 'renderer-invalid-result';
  return 'none';
}

function summarizeState(state = {}) {
  const mainOrigin = safeOrigin(state.mainUrl);
  const rendererOrigin = safeOrigin(state.url);
  const loginShell = state.loginShellVisible === true;
  const terminalBlocked = state.loginShellPresent === true && !loginShell;
  const rendererFailure = rendererErrorCategory(state);

  return {
    platform: String(state.platform || ''),
    guestFound: state.found === true,
    mainOrigin,
    rendererOrigin,
    officialWeb: mainOrigin === WHATSAPP_WEB_ORIGIN && rendererOrigin === WHATSAPP_WEB_ORIGIN,
    rendererResponsive: rendererFailure === 'none',
    rendererErrorCategory: rendererFailure,
    documentComplete: state.readyState === 'complete',
    loginShell,
    terminalBlocked,
    loadingProgress: boundedCount(state.progressCount),
    visibleLoadingProgress: boundedCount(state.visibleProgressCount),
  };
}

function classifyWhatsAppBootstrap(state = {}) {
  const summary = summarizeState(state);
  let reason = 'ready';

  if (!summary.guestFound) reason = 'guest-missing';
  else if (!summary.rendererResponsive) reason = summary.rendererErrorCategory;
  else if (!summary.officialWeb) reason = 'wrong-origin';
  else if (!summary.documentComplete) reason = 'document-incomplete';
  else if (summary.terminalBlocked) reason = 'terminal-occluded';
  else if (false && !summary.loginShell) reason = 'login-shell-missing';

  return {
    ready: reason === 'ready',
    reason,
    summary,
  };
}

module.exports = {
  WHATSAPP_WEB_ORIGIN,
  MAX_DIAGNOSTIC_COUNT,
  safeOrigin,
  summarizeState,
  classifyWhatsAppBootstrap,
};
