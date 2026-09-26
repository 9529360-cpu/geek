'use strict';

const {
  OUTPUT_KEYS,
  buildProbeExpression,
  getDebugTargets,
  evaluateTarget,
  isGeekHostTarget,
} = require('./line-auth-regression-probe.cjs');

const CONFIRMATION_ENV = 'GEEK_LINE_CONTROLLED_SEND_CONFIRM';
const CONFIRMATION_VALUE = 'I_CONFIRM_ACTIVE_LINE_CHAT_IS_MAINTAINER_CONTROLLED';
const SMOKE_PREFIX = 'GEEK LINE CANDIDATE TEXT SEND SMOKE';
const ALLOWED_RESULT_CODES = new Set([
  'READY',
  'NO_ACTIVE_ACCOUNT',
  'ACCOUNT_NOT_FOUND',
  'NOT_LINE_ACCOUNT',
  'WEBVIEW_NOT_FOUND',
  'WEBVIEW_NOT_EXTENSION',
  'AUTH_NOT_READY',
  'CANDIDATE_NOT_READY',
  'TRANSPORT_NOT_READY',
  'CHAT_NOT_READY',
  'COMPOSER_NOT_EMPTY',
  'ACCOUNT_CHANGED',
  'SET_FAILED',
  'CONTEXT_CHANGED',
  'SEND_UNCONFIRMED',
  'EVALUATION_FAILED',
]);
const ALLOWED_SEND_RESULTS = new Set(['not-attempted', 'sent', 'unconfirmed', 'blocked']);

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function parseMode(raw) {
  const value = String(raw || '--preflight').trim().toLowerCase();
  if (value === 'preflight' || value === '--preflight') return 'preflight';
  if (value === 'execute' || value === '--execute') return 'execute';
  throw codedError('CONTROLLED_SEND_MODE_INVALID');
}

function assertExecutionAllowed(mode, env = process.env) {
  if (mode !== 'execute') return true;
  if (String(env?.CI || '').trim()) throw codedError('CONTROLLED_SEND_CI_FORBIDDEN');
  if (String(env?.[CONFIRMATION_ENV] || '') !== CONFIRMATION_VALUE) {
    throw codedError('CONTROLLED_SEND_CONFIRMATION_REQUIRED');
  }
  return true;
}

function buildSmokeMessage(now = Date.now()) {
  const stamp = new Date(now);
  if (!Number.isFinite(stamp.getTime())) throw codedError('CONTROLLED_SEND_TIME_INVALID');
  return `${SMOKE_PREFIX} ${stamp.toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
}

function projectControlledSendResult(input, mode = 'preflight') {
  const code = ALLOWED_RESULT_CODES.has(String(input?.code || '')) ? String(input.code) : 'EVALUATION_FAILED';
  const sendResult = ALLOWED_SEND_RESULTS.has(String(input?.sendResult || ''))
    ? String(input.sendResult)
    : 'blocked';
  return {
    mode: mode === 'execute' ? 'execute' : 'preflight',
    ready: input?.ready === true,
    lineAccount: input?.lineAccount === true,
    candidateMode: input?.candidateMode === true,
    authReady: input?.authReady === true,
    webviewVisible: input?.webviewVisible === true,
    transportReady: input?.transportReady === true,
    chatReady: input?.chatReady === true,
    composerEmpty: input?.composerEmpty === true,
    accountStable: input?.accountStable === true,
    messagePrepared: input?.messagePrepared === true,
    sendAttempted: input?.sendAttempted === true,
    sendConfirmed: input?.sendConfirmed === true,
    sendResult,
    code,
  };
}

function buildHostExpression({ execute = false, message = '' } = {}) {
  const guestProbe = JSON.stringify(buildProbeExpression());
  const outputKeys = JSON.stringify(OUTPUT_KEYS);
  const smokeText = JSON.stringify(String(message || ''));
  const shouldExecute = execute === true ? 'true' : 'false';

  return `(async () => {
    const extensionId = 'ophjlpahpchlmihnnnihgmmeilfjmjjc';
    const extensionPage = '/index.html';
    const outputKeys = ${outputKeys};
    const execute = ${shouldExecute};
    const smokeText = ${smokeText};
    const result = {
      kind: 'CONTROLLED_SEND_RESULT',
      ready: false,
      lineAccount: false,
      candidateMode: false,
      authReady: false,
      webviewVisible: false,
      transportReady: false,
      chatReady: false,
      composerEmpty: false,
      accountStable: false,
      messagePrepared: false,
      sendAttempted: false,
      sendConfirmed: false,
      sendResult: 'not-attempted',
      code: 'EVALUATION_FAILED',
    };
    const activeId = () => String(document.querySelector('.nav-account.active[data-id]')?.dataset.id || '');

    try {
      const initialAccountId = activeId();
      if (!initialAccountId) return { ...result, code: 'NO_ACTIVE_ACCOUNT' };

      const listed = await window.api?.accounts?.list?.();
      const accounts = Array.isArray(listed?.accounts) ? listed.accounts : (Array.isArray(listed) ? listed : []);
      const account = accounts.find((item) => String(item?.id || '') === initialAccountId);
      if (!account) return { ...result, code: 'ACCOUNT_NOT_FOUND' };

      const accountType = String(account.type || '');
      if (accountType !== 'line' && accountType !== 'line-business') {
        return { ...result, code: 'NOT_LINE_ACCOUNT' };
      }
      result.lineAccount = true;

      const partition = String(account.partition || '');
      const webview = [...document.querySelectorAll('webview')].find((candidate) =>
        String(candidate.partition || candidate.getAttribute?.('partition') || '') === partition
      ) || null;
      if (!webview) return { ...result, code: 'WEBVIEW_NOT_FOUND' };

      let currentUrl = '';
      try { currentUrl = typeof webview.getURL === 'function' ? webview.getURL() : ''; } catch {}
      if (!currentUrl) {
        try { currentUrl = webview.getAttribute('src') || ''; } catch {}
      }
      try {
        const parsed = new URL(currentUrl);
        if (parsed.protocol !== 'chrome-extension:' || parsed.hostname !== extensionId || parsed.pathname !== extensionPage) {
          return { ...result, code: 'WEBVIEW_NOT_EXTENSION' };
        }
      } catch {
        return { ...result, code: 'WEBVIEW_NOT_EXTENSION' };
      }

      const rect = webview.getBoundingClientRect();
      const style = getComputedStyle(webview);
      result.webviewVisible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';

      let authState = null;
      try { authState = await webview.executeJavaScript(${guestProbe}, false); } catch {}
      result.authReady = !!authState && outputKeys.every((key) => authState[key] === true);
      if (!result.authReady) return { ...result, code: 'AUTH_NOT_READY' };

      try {
        result.candidateMode = await webview.executeJavaScript(
          "(() => typeof window.GeekLineDownloads?.saveBlob === 'function')()",
          false,
        ) === true;
      } catch {}
      if (!result.candidateMode) return { ...result, code: 'CANDIDATE_NOT_READY' };

      const factory = window.GeekPlatformTransports?.forAccount;
      if (typeof factory !== 'function') return { ...result, code: 'TRANSPORT_NOT_READY' };
      let transport = null;
      try { transport = factory(account, webview); } catch {}
      result.transportReady = !!transport
        && typeof transport.getCurrentChat === 'function'
        && typeof transport.getComposerText === 'function'
        && typeof transport.clearComposerText === 'function'
        && typeof transport.setComposerText === 'function'
        && typeof transport.sendText === 'function';
      if (!result.transportReady) return { ...result, code: 'TRANSPORT_NOT_READY' };

      const initialChat = String(await transport.getCurrentChat() || '');
      result.chatReady = initialChat.length > 0;
      if (!result.chatReady) return { ...result, code: 'CHAT_NOT_READY' };

      const initialComposer = String(await transport.getComposerText() || '');
      result.composerEmpty = initialComposer.trim().length === 0;
      if (!result.composerEmpty) return { ...result, code: 'COMPOSER_NOT_EMPTY' };

      result.accountStable = activeId() === initialAccountId;
      if (!result.accountStable) return { ...result, code: 'ACCOUNT_CHANGED' };

      result.ready = result.lineAccount
        && result.candidateMode
        && result.authReady
        && result.webviewVisible
        && result.transportReady
        && result.chatReady
        && result.composerEmpty
        && result.accountStable;
      result.code = result.ready ? 'READY' : 'EVALUATION_FAILED';
      if (!execute || !result.ready) return result;

      const setResult = await transport.setComposerText(smokeText);
      if (setResult !== 'OK') {
        try { await transport.clearComposerText(); } catch {}
        result.sendResult = 'blocked';
        result.code = 'SET_FAILED';
        return result;
      }
      result.messagePrepared = true;

      const activeStill = activeId() === initialAccountId;
      const currentChat = String(await transport.getCurrentChat() || '');
      const actualComposer = String(await transport.getComposerText() || '').trim();
      if (!activeStill || currentChat !== initialChat || actualComposer !== smokeText.trim()) {
        try { await transport.clearComposerText(); } catch {}
        result.accountStable = activeStill;
        result.sendResult = 'blocked';
        result.code = 'CONTEXT_CHANGED';
        return result;
      }

      result.sendAttempted = true;
      const sendResult = await transport.sendText(smokeText);
      result.sendConfirmed = sendResult === 'SENT';
      result.sendResult = result.sendConfirmed ? 'sent' : 'unconfirmed';
      result.code = result.sendConfirmed ? 'READY' : 'SEND_UNCONFIRMED';
      result.composerEmpty = String(await transport.getComposerText() || '').trim().length === 0;
      result.accountStable = activeId() === initialAccountId;
      return result;
    } catch {
      return { ...result, code: 'EVALUATION_FAILED', sendResult: result.sendAttempted ? 'unconfirmed' : 'blocked' };
    }
  })()`;
}

async function runControlledSend(mode, options = {}) {
  const normalizedMode = parseMode(mode);
  assertExecutionAllowed(normalizedMode, options.env || process.env);
  const targets = options.targets || await (options.getDebugTargets || getDebugTargets)();
  const hostTarget = Array.isArray(targets) ? targets.find(isGeekHostTarget) : null;
  if (!hostTarget) throw codedError('GEEK_HOST_TARGET_NOT_FOUND');

  const message = normalizedMode === 'execute'
    ? buildSmokeMessage(options.now ?? Date.now())
    : '';
  const evaluator = options.evaluateTarget || evaluateTarget;
  const raw = await evaluator(
    hostTarget,
    buildHostExpression({ execute: normalizedMode === 'execute', message }),
    options.evaluateOptions || {},
  );
  if (raw?.kind !== 'CONTROLLED_SEND_RESULT') throw codedError('CONTROLLED_SEND_RESULT_INVALID');
  return projectControlledSendResult(raw, normalizedMode);
}

async function main(argv = process.argv.slice(2)) {
  const mode = parseMode(argv[0]);
  const result = await runControlledSend(mode);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  const success = mode === 'execute' ? result.sendConfirmed : result.ready;
  if (!success) process.exitCode = 2;
}

if (require.main === module) {
  main().catch((error) => {
    const code = /^[A-Z0-9_]+$/.test(String(error?.code || ''))
      ? String(error.code)
      : 'CONTROLLED_SEND_UNKNOWN_FAILURE';
    process.stderr.write(`LINE_CONTROLLED_SEND_SMOKE_FAILED:${code}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CONFIRMATION_ENV,
  CONFIRMATION_VALUE,
  SMOKE_PREFIX,
  parseMode,
  assertExecutionAllowed,
  buildSmokeMessage,
  projectControlledSendResult,
  buildHostExpression,
  runControlledSend,
};
