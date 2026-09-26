'use strict';

const LINE_CONTEXT_ISOLATION_CANDIDATE_ENV = 'GEEK_LINE_CONTEXT_ISOLATION_CANDIDATE';
const LINE_WEBPREFERENCES_SHARED = 'sandbox=true,nativeWindowOpen=yes,spellcheck=no,backgroundThrottling=false';

function isLineContextIsolationCandidateEnabled(options = {}) {
  if (options.isPackaged === true) return false;
  const env = options.env || process.env;
  return String(env?.[LINE_CONTEXT_ISOLATION_CANDIDATE_ENV] || '').trim() === '1';
}

function applyLineContextIsolationPolicy(options = {}) {
  const webPreferences = options.webPreferences;
  if (!webPreferences || typeof webPreferences !== 'object') {
    throw new TypeError('webPreferences is required');
  }

  if (options.candidateEnabled === true) {
    const candidatePreloadPath = String(options.candidatePreloadPath || '').trim();
    if (!candidatePreloadPath) throw new TypeError('candidatePreloadPath is required');
    webPreferences.preload = candidatePreloadPath;
    webPreferences.contextIsolation = true;
    return Object.freeze({ candidateEnabled: true, contextIsolation: true });
  }

  const legacyPreloadPath = String(options.legacyPreloadPath || '').trim();
  if (!legacyPreloadPath) throw new TypeError('legacyPreloadPath is required');
  webPreferences.preload = legacyPreloadPath;
  webPreferences.contextIsolation = false;
  return Object.freeze({ candidateEnabled: false, contextIsolation: false });
}

function lineWebPreferencesAttribute(candidateEnabled) {
  return `contextIsolation=${candidateEnabled === true ? 'yes' : 'no'},${LINE_WEBPREFERENCES_SHARED}`;
}

module.exports = {
  LINE_CONTEXT_ISOLATION_CANDIDATE_ENV,
  isLineContextIsolationCandidateEnabled,
  applyLineContextIsolationPolicy,
  lineWebPreferencesAttribute,
};
