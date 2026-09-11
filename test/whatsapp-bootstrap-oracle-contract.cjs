'use strict';

const assert = require('node:assert/strict');
const {
  WHATSAPP_WEB_ORIGIN,
  classifyWhatsAppBootstrap,
} = require('../e2e/support/whatsapp-bootstrap-oracle.cjs');

const terminalState = Object.freeze({
  platform: 'win32',
  found: true,
  mainUrl: `${WHATSAPP_WEB_ORIGIN}/`,
  url: `${WHATSAPP_WEB_ORIGIN}/`,
  readyState: 'complete',
  rendererProbeOk: true,
  loginShellPresent: true,
  loginShellVisible: true,
  progressCount: 1,
  visibleProgressCount: 1,
});

function classify(patch = {}) {
  return classifyWhatsAppBootstrap({ ...terminalState, ...patch });
}

const ordinaryProgress = classify();
assert.equal(ordinaryProgress.ready, true, 'an unrelated progress element must not fail an already-visible login terminal state');
assert.equal(ordinaryProgress.reason, 'ready');
assert.equal(ordinaryProgress.summary.loadingProgress, 1, 'progress count should remain bounded diagnostic telemetry');
assert.equal(ordinaryProgress.summary.visibleLoadingProgress, 1, 'visible progress telemetry should remain available without becoming acceptance');

const missingTerminal = classify({ loginShellPresent: false, loginShellVisible: false, progressCount: 0, visibleProgressCount: 0 });
assert.equal(missingTerminal.ready, false, 'official origin without a terminal login shell must fail');
assert.equal(missingTerminal.reason, 'login-shell-missing');

const rendererTimeout = classify({ rendererProbeOk: false, rendererProbeTimedOut: true });
assert.equal(rendererTimeout.ready, false, 'renderer probe timeout must fail');
assert.equal(rendererTimeout.reason, 'renderer-timeout');

const rendererFailure = classify({ rendererProbeOk: false, rendererProbeFailed: true });
assert.equal(rendererFailure.ready, false, 'renderer execute failure must fail');
assert.equal(rendererFailure.reason, 'renderer-execute-failure');

const wrongMainOrigin = classify({ mainUrl: 'https://example.com/' });
assert.equal(wrongMainOrigin.ready, false, 'wrong main-process guest origin must fail');
assert.equal(wrongMainOrigin.reason, 'wrong-origin');

const wrongRendererOrigin = classify({ url: 'https://example.com/' });
assert.equal(wrongRendererOrigin.ready, false, 'wrong renderer origin must fail');
assert.equal(wrongRendererOrigin.reason, 'wrong-origin');

const incompleteDocument = classify({ readyState: 'interactive' });
assert.equal(incompleteDocument.ready, false, 'document that has not completed must fail');
assert.equal(incompleteDocument.reason, 'document-incomplete');

const blockingTerminal = classify({ loginShellPresent: true, loginShellVisible: false, progressCount: 1, visibleProgressCount: 1 });
assert.equal(blockingTerminal.summary.terminalBlocked, true, 'present but occluded terminal evidence must be classified as blocked');
assert.equal(blockingTerminal.ready, false, 'a loading/overlay stall that blocks terminal evidence must fail');
assert.equal(blockingTerminal.reason, 'terminal-occluded');

const missingGuest = classify({ found: false });
assert.equal(missingGuest.ready, false, 'missing synthetic guest must fail');
assert.equal(missingGuest.reason, 'guest-missing');

console.log('WHATSAPP_BOOTSTRAP_ORACLE_CONTRACT_OK');
