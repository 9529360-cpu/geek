'use strict';

const {
  getDebugTargets,
  evaluateTarget,
  isGeekHostTarget,
} = require('./line-auth-regression-probe.cjs');

const CONFIRMATION_ENV = 'GEEK_TELEGRAM_SEND_INTENT_SMOKE_CONFIRM';
const CONFIRMATION_VALUE = 'I_CONFIRM_ONE_TEST_MESSAGE_TO_ACTIVE_MAINTAINER_CONTROLLED_TELEGRAM_CHAT';
const ORDINARY_CONFIRMATION_ENV = 'GEEK_TELEGRAM_ORDINARY_SEND_INTENT_SMOKE_CONFIRM';
const ORDINARY_CONFIRMATION_VALUE = 'I_CONFIRM_ONE_ORDINARY_TEST_MESSAGE_TO_ACTIVE_MAINTAINER_CONTROLLED_TELEGRAM_CHAT';
const ALLOWED_SCENARIOS = new Set(['translated', 'ordinary']);
const MAX_WAIT_MS = 120000;
const POLL_INTERVAL_MS = 1500;
const SAFE_ERROR_CODES = new Set([
  'ARGUMENTS_INVALID',
  'CI_FORBIDDEN',
  'CONFIRMATION_REQUIRED',
  'DEBUG_PORT_UNAVAILABLE',
  'GEEK_HOST_TARGET_NOT_FOUND',
  'GEEK_HOST_TARGET_AMBIGUOUS',
  'ACTIVE_ACCOUNT_NOT_FOUND',
  'NOT_TELEGRAM_ACCOUNT',
  'TELEGRAM_WEBVIEW_NOT_FOUND',
  'TELEGRAM_CONTEXT_NOT_READY',
  'TRANSLATION_SEND_DISABLED',
  'ORDINARY_POLICY_NOT_READY',
  'CURRENT_CHAT_NOT_READY',
  'COMPOSER_NOT_EMPTY',
  'OWNER_RUNTIME_NOT_READY',
  'CONTEXT_CHANGED',
  'OBSERVER_INSTALL_FAILED',
  'COMPOSER_STAGE_FAILED',
  'OWNER_RESULT_INVALID',
  'CDP_COMMAND_FAILED',
  'CDP_COMMAND_TIMEOUT',
  'CDP_CONNECT_FAILED',
  'CDP_CONNECT_TIMEOUT',
  'WEBSOCKET_UNAVAILABLE',
  'DEBUG_TARGET_SOCKET_INVALID',
  'PROBE_EVALUATION_FAILED',
  'PROBE_RESULT_INVALID',
  'SMOKE_FAILED',
]);
const ALLOWED_MODES = new Set(['preflight', 'execute']);
const ALLOWED_SEND_RESULTS = new Set([
  'not-attempted',
  'waiting-for-operator',
  'sent',
  'failed',
  'ambiguous',
  'blocked',
]);
const ALLOWED_OWNER_STATES = new Set(['not-started', 'sent', 'failed', 'cancelled', 'uncertain', 'unknown']);
const ALLOWED_CODES = new Set([
  'READY',
  'PREFLIGHT_BLOCKED',
  'CI_FORBIDDEN',
  'CONFIRMATION_REQUIRED',
  'NO_ACTIVE_ACCOUNT',
  'NOT_TELEGRAM_ACCOUNT',
  'WEBVIEW_NOT_FOUND',
  'BRIDGE_NOT_READY',
  'SEND_TRANSLATION_DISABLED',
  'ORDINARY_POLICY_NOT_READY',
  'NO_CURRENT_CHAT',
  'COMPOSER_NOT_EMPTY',
  'OWNER_RUNTIME_NOT_READY',
  'CONTEXT_CHANGED',
  'OBSERVER_INSTALL_FAILED',
  'COMPOSER_STAGE_FAILED',
  'WAITING_FOR_OPERATOR',
  'OWNER_SENT',
  'OWNER_FAILED',
  'OWNER_AMBIGUOUS',
  'OWNER_CANCELLED',
  'OWNER_RESULT_INVALID',
  'OPERATOR_TIMEOUT',
  'DEBUG_PORT_UNAVAILABLE',
  'GEEK_HOST_TARGET_NOT_FOUND',
  'GEEK_HOST_TARGET_AMBIGUOUS',
  'SMOKE_FAILED',
]);
const TIMING_BUCKETS = new Set(['under-15s', '15-60s', 'over-60s', 'unknown']);

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function parseMode(argv = []) {
  if (!Array.isArray(argv) || argv.length > 1) throw codedError('ARGUMENTS_INVALID');
  if (argv.length === 0) return 'preflight';
  const value = String(argv[0] || '');
  if (value === '--preflight') return 'preflight';
  if (value === '--execute') return 'execute';
  throw codedError('ARGUMENTS_INVALID');
}

function assertExecutionAllowed(mode, env = process.env, scenario = 'translated') {
  if (!ALLOWED_MODES.has(mode) || !ALLOWED_SCENARIOS.has(scenario)) throw codedError('ARGUMENTS_INVALID');
  if (mode !== 'execute') return true;
  if (env && Object.prototype.hasOwnProperty.call(env, 'CI')) throw codedError('CI_FORBIDDEN');
  const confirmationEnv = scenario === 'ordinary' ? ORDINARY_CONFIRMATION_ENV : CONFIRMATION_ENV;
  const confirmationValue = scenario === 'ordinary' ? ORDINARY_CONFIRMATION_VALUE : CONFIRMATION_VALUE;
  if (String(env?.[confirmationEnv] || '') !== confirmationValue) {
    throw codedError('CONFIRMATION_REQUIRED');
  }
  return true;
}

function buildSmokeMessage(now = Date.now(), scenario = 'translated') {
  if (!ALLOWED_SCENARIOS.has(scenario)) throw codedError('ARGUMENTS_INVALID');
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) throw codedError('SMOKE_FAILED');
  const prefix = scenario === 'ordinary'
    ? 'GEEK TELEGRAM ORDINARY SEND INTENT SMOKE '
    : 'GEEK TELEGRAM SEND INTENT SMOKE ';
  return prefix + date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function timingBucket(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 'unknown';
  if (durationMs < 15000) return 'under-15s';
  if (durationMs <= 60000) return '15-60s';
  return 'over-60s';
}

function projectEvidence(input = {}) {
  const mode = input.mode === 'execute' ? 'execute' : 'preflight';
  const ownerState = ALLOWED_OWNER_STATES.has(String(input.ownerState || ''))
    ? String(input.ownerState)
    : 'not-started';
  const sendResult = ALLOWED_SEND_RESULTS.has(String(input.sendResult || ''))
    ? String(input.sendResult)
    : 'blocked';
  const code = ALLOWED_CODES.has(String(input.code || '')) ? String(input.code) : 'SMOKE_FAILED';
  const timing = TIMING_BUCKETS.has(String(input.durationBucket || ''))
    ? String(input.durationBucket)
    : 'unknown';
  return {
    schemaVersion: input.scenario === 'ordinary' ? 'v1-ordinary' : 'v1',
    ...(input.scenario === 'ordinary' ? {
      scenario: 'ordinary',
      ordinaryPolicyReady: input.ordinaryPolicyReady === true,
      identityTransformObserved: input.identityTransformObserved === true,
    } : {}),
    mode,
    preflightReady: input.preflightReady === true,
    telegramAccount: input.telegramAccount === true,
    webviewReady: input.webviewReady === true,
    translationBridgeReady: input.translationBridgeReady === true,
    trustedOwnerRuntimeReady: input.trustedOwnerRuntimeReady === true,
    translationSendEnabled: input.translationSendEnabled === true,
    currentChatReady: input.currentChatReady === true,
    composerEmpty: input.composerEmpty === true,
    composerPrepared: input.composerPrepared === true,
    trustedAdmission: input.trustedAdmission === true,
    transformComplete: input.transformComplete === true,
    composerWriteComplete: input.composerWriteComplete === true,
    generationRebound: input.generationRebound === true,
    commitGuardPassed: input.commitGuardPassed === true,
    nativeCommitCount: input.nativeCommitCount === 'one' ? 'one' : (input.nativeCommitCount === 'unknown' ? 'unknown' : 'zero'),
    cleanupComplete: input.cleanupComplete === true || (mode === 'preflight' && input.cleanupComplete !== false),
    ownerState,
    sendResult,
    recipientReceipt: input.recipientReceipt === 'manual-pass' || input.recipientReceipt === 'manual-fail'
      ? input.recipientReceipt
      : 'manual-pending',
    operatorActionRequired: input.operatorActionRequired === true ? 'CLICK_SEND_ONCE' : 'NONE',
    code,
    durationBucket: timing,
  };
}

function buildGuestReadinessExpression(smokeText) {
  const expected = JSON.stringify(String(smokeText || ''));
  return [
    '(() => {',
    '  const hash = String(location.hash || "").replace(/^#/, "");',
    '  const chatId = hash ? hash.split("?")[0] : "";',
    '  const config = window.__geekTranslationConfig || null;',
    '  const globalSettings = config && config.global && typeof config.global === "object" ? config.global : {};',
    '  const chatSettings = config && config.chats && typeof config.chats === "object" ? config.chats[chatId] || {} : {};',
    '  const base = { enabled: globalSettings.send === true, autoSend: globalSettings.send === true, includeZh: globalSettings.includeZh !== false };',
    '  const policy = { ...base, ...chatSettings };',
    '  const text = ' + expected + ';',
    '  const wouldTranslate = policy.enabled === true && policy.autoSend !== false && !(policy.includeZh === false && /[\u3400-\u9fff]/.test(text));',
    '  const bridgeReady = document.documentElement?.getAttribute?.("data-geek-bridge") === "1"',
    '    && typeof window.__geekTranslationRequest === "function"',
    '    && typeof window.__geekTranslationBridgeToken === "string"',
    '    && window.__geekTranslationBridgeToken.length > 0;',
    '  return { bridgeReady, wouldTranslate };',
    '})()',
  ].join('\n');
}
function buildGuestObserverExpression(smokeText) {
  const expected = JSON.stringify(String(smokeText || ''));
  return [
    '(() => {',
    '  if (window.__geekTelegramSendIntentSmokeObserver) return false;',
    '  if (typeof window.__geekTranslationRequest !== "function" || typeof window.__geekResolveTranslation !== "function") return false;',
    '  const state = { requestSeen: false, terminal: null, expected: ' + expected + ' };',
    '  const originalRequest = window.__geekTranslationRequest;',
    '  const originalResolve = window.__geekResolveTranslation;',
    '  const wrappedRequest = function(payload) {',
    '    if (payload?.intent === "outgoing-send" && payload?.text === state.expected) state.requestSeen = true;',
    '    return originalRequest.apply(this, arguments);',
    '  };',
    '  const safeState = value => ["sent", "failed", "cancelled"].includes(String(value)) ? String(value) : "unknown";',
    '  const wrappedResolve = function(id, result, error) {',
    '    const pending = window.__geekTranslationPending?.get?.(id);',
    '    const payload = pending?.payload;',
    '    if (payload?.intent === "outgoing-send" && payload?.text === state.expected && !state.terminal) {',
    '      const owner = result?.delivery?.owner === "send-intent";',
    '      const rawError = String(error || "");',
    '      state.terminal = {',
    '        owner,',
    '        state: owner ? safeState(result?.delivery?.state) : "unknown",',
    '        textReady: typeof result?.text === "string" && result.text.length > 0,',
    '        identity: result?.mode === \"identity\" && result?.rewriteComposer === false,',
    '        error: rawError === "SEND_INTENT_OUTCOME_UNCERTAIN" ? "uncertain"',
    '          : rawError === "SEND_INTENT_SEND_FAILED" ? "send-failed"',
    '            : rawError ? "other" : "none",',
    '      };',
    '    }',
    '    return originalResolve.apply(this, arguments);',
    '  };',
    '  state.originalRequest = originalRequest;',
    '  state.originalResolve = originalResolve;',
    '  state.wrappedRequest = wrappedRequest;',
    '  state.wrappedResolve = wrappedResolve;',
    '  window.__geekTelegramSendIntentSmokeObserver = state;',
    '  window.__geekTranslationRequest = wrappedRequest;',
    '  window.__geekResolveTranslation = wrappedResolve;',
    '  return true;',
    '})()',
  ].join('\n');
}

function buildHostPrepareExpression(mode, smokeText, scenario = 'translated') {
  if (!ALLOWED_SCENARIOS.has(scenario)) throw codedError('ARGUMENTS_INVALID');
  const modeValue = JSON.stringify(mode);
  const scenarioValue = JSON.stringify(scenario);
  const messageValue = JSON.stringify(String(smokeText || ''));
  const guestReady = JSON.stringify(buildGuestReadinessExpression(smokeText));
  const guestObserver = JSON.stringify(buildGuestObserverExpression(smokeText));
  return [
    '(async () => {',
    '  const scenario = ' + scenarioValue + ';',
    '  const out = { kind: "PREPARE_RESULT", mode: ' + modeValue + ', scenario, ready: false, telegramAccount: false, webviewReady: false, translationBridgeReady: false, trustedOwnerRuntimeReady: false, translationSendEnabled: false, ordinaryPolicyReady: false, currentChatReady: false, composerEmpty: false, composerPrepared: false, code: "PREFLIGHT_BLOCKED" };',
    '  try {',
    '    const activeId = String(document.querySelector(".nav-account.active[data-id]")?.dataset.id || "");',
    '    if (!activeId) return { ...out, code: "NO_ACTIVE_ACCOUNT" };',
    '    const listed = await window.api?.accounts?.list?.();',
    '    const accounts = Array.isArray(listed?.accounts) ? listed.accounts : (Array.isArray(listed) ? listed : []);',
    '    const account = accounts.find(item => String(item?.id || "") === activeId);',
    '    if (!account) return { ...out, code: "NO_ACTIVE_ACCOUNT" };',
    '    if (!["telegram-z", "telegram-k"].includes(String(account.type || ""))) return { ...out, code: "NOT_TELEGRAM_ACCOUNT" };',
    '    out.telegramAccount = true;',
    '    const partition = String(account.partition || "");',
    '    const webview = Array.from(document.querySelectorAll("webview")).find(item => String(item.partition || item.getAttribute?.("partition") || "") === partition) || null;',
    '    if (!webview || typeof webview.executeJavaScript !== "function" || typeof webview.getWebContentsId !== "function") return { ...out, code: "WEBVIEW_NOT_FOUND" };',
    '    const rect = webview.getBoundingClientRect();',
    '    const style = getComputedStyle(webview);',
    '    out.webviewReady = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";',
    '    const capabilities = window.GeekPlatformCapabilitiesRuntime;',
    '    const adapter = typeof capabilities?.forAccount === "function" ? capabilities.forAccount(account, webview) : null;',
    '    const chatId = adapter && typeof adapter.getCurrentChat === "function" ? await adapter.getCurrentChat() : null;',
    '    const composerText = adapter && typeof adapter.getComposerText === "function" ? await adapter.getComposerText() : null;',
    '    out.currentChatReady = typeof chatId === "string" && chatId.length > 0;',
    '    out.composerEmpty = typeof composerText === "string" && composerText.trim().length === 0;',
    '    const guest = await webview.executeJavaScript(' + guestReady + ', false);',
    '    out.translationBridgeReady = guest?.bridgeReady === true',
    '      && typeof window.api?.webviewInput?.insertText === "function"',
    '      && (scenario === "ordinary" || typeof window.api?.translation?.translate === "function");',
    '    out.translationSendEnabled = guest?.wouldTranslate === true;',
    '    out.ordinaryPolicyReady = guest?.wouldTranslate === false;',
    '    out.trustedOwnerRuntimeReady = typeof window.GeekTrustedSubmitRuntime?.create === "function"',
    '      && typeof window.GeekTrustedSubmitPermits?.createAuthority === "function"',
    '      && typeof window.GeekSendIntentExecutor?.create === "function"',
    '      && typeof window.GeekSendIntentCommitGuard?.create === "function"',
    '      && typeof capabilities?.forAccount === "function";',
    '    const policyReady = scenario === "ordinary" ? out.ordinaryPolicyReady : out.translationSendEnabled;',
    '    out.ready = out.telegramAccount && out.webviewReady && out.translationBridgeReady',
    '      && out.trustedOwnerRuntimeReady && policyReady && out.currentChatReady && out.composerEmpty;',
    '    if (!out.ready) {',
    '      out.code = !out.webviewReady ? "WEBVIEW_NOT_FOUND"',
    '        : !out.translationBridgeReady ? "BRIDGE_NOT_READY"',
    '          : !out.trustedOwnerRuntimeReady ? "OWNER_RUNTIME_NOT_READY"',
    '            : scenario === "ordinary" && !out.ordinaryPolicyReady ? "ORDINARY_POLICY_NOT_READY"',
    '              : scenario !== "ordinary" && !out.translationSendEnabled ? "SEND_TRANSLATION_DISABLED"',
    '                : !out.currentChatReady ? "NO_CURRENT_CHAT"',
    '                  : !out.composerEmpty ? "COMPOSER_NOT_EMPTY" : "PREFLIGHT_BLOCKED";',
    '      return out;',
    '    }',
    '    out.code = "READY";',
    '    if (' + modeValue + ' !== "execute") return out;',
    '    const activeChatId = String(chatId);',
    '    const bridgeToken = String(await webview.executeJavaScript(' + JSON.stringify('String(window.__geekTranslationBridgeToken || "")') + ', false) || "");',
    '    if (!bridgeToken) return { ...out, ready: false, code: "BRIDGE_NOT_READY" };',
    '    const installed = await webview.executeJavaScript(' + guestObserver + ', false);',
    '    if (installed !== true) return { ...out, ready: false, code: "OBSERVER_INSTALL_FAILED" };',
    '    const activeIdBeforeStage = String(document.querySelector(".nav-account.active[data-id]")?.dataset.id || "");',
    '    const currentChatBeforeStage = await adapter.getCurrentChat();',
    '    const composerBeforeStage = await adapter.getComposerText();',
    '    if (activeIdBeforeStage !== activeId || String(currentChatBeforeStage || "") !== activeChatId || String(composerBeforeStage || "").trim()) {',
    '      await webview.executeJavaScript("(() => { const s=window.__geekTelegramSendIntentSmokeObserver; if(!s)return false; if(window.__geekTranslationRequest===s.wrappedRequest)window.__geekTranslationRequest=s.originalRequest; if(window.__geekResolveTranslation===s.wrappedResolve)window.__geekResolveTranslation=s.originalResolve; delete window.__geekTelegramSendIntentSmokeObserver; return true; })()", false);',
    '      return { ...out, ready: false, code: "CONTEXT_CHANGED", context: { accountId: String(account.id), chatId: activeChatId } };',
    '    }',
    '    try { await window.api.webviewInput.insertText(account.id, webview.getWebContentsId(), ' + messageValue + ', bridgeToken); } catch { return { ...out, ready: false, composerPrepared: false, code: "COMPOSER_STAGE_FAILED", context: { accountId: String(account.id), chatId: activeChatId } }; }',
    '    const staged = String(await adapter.getComposerText() || "").trim() === ' + messageValue + '.trim();',
    '    if (!staged) return { ...out, ready: false, composerPrepared: false, code: "COMPOSER_STAGE_FAILED", context: { accountId: String(account.id), chatId: activeChatId } };',
    '    return { ...out, composerEmpty: false, composerPrepared: true, context: { accountId: String(account.id), chatId: activeChatId } };',
    '  } catch {',
    '    return { ...out, code: "SMOKE_FAILED" };',
    '  }',
    '})()',
  ].join('\n');
}
function buildHostPollExpression(context, smokeText) {
  const contextValue = JSON.stringify({ accountId: String(context?.accountId || ''), chatId: String(context?.chatId || '') });
  const messageValue = JSON.stringify(String(smokeText || ''));
  const guestStateExpression = JSON.stringify('(() => { const s=window.__geekTelegramSendIntentSmokeObserver; return s ? { requestSeen:s.requestSeen===true, terminal:s.terminal && { owner:s.terminal.owner===true, state:String(s.terminal.state||"unknown"), textReady:s.terminal.textReady===true, identity:s.terminal.identity===true, error:String(s.terminal.error||"other") } } : null; })()');
  return [
    '(async () => {',
    '  const expected = ' + contextValue + ';',
    '  const out = { kind: "POLL_RESULT", contextStable: false, requestSeen: false, terminal: null, code: "WAITING_FOR_OPERATOR" };',
    '  try {',
    '    const listed = await window.api?.accounts?.list?.();',
    '    const accounts = Array.isArray(listed?.accounts) ? listed.accounts : (Array.isArray(listed) ? listed : []);',
    '    const account = accounts.find(item => String(item?.id || "") === expected.accountId);',
    '    if (!account) return { ...out, code: "CONTEXT_CHANGED" };',
    '    const partition = String(account.partition || "");',
    '    const webview = Array.from(document.querySelectorAll("webview")).find(item => String(item.partition || item.getAttribute?.("partition") || "") === partition) || null;',
    '    if (!webview || typeof webview.executeJavaScript !== "function") return { ...out, code: "CONTEXT_CHANGED" };',
    '    const state = await webview.executeJavaScript(' + guestStateExpression + ', false);',
    '    if (state) {',
    '      out.requestSeen = state.requestSeen === true;',
    '      out.terminal = state.terminal || null;',
    '    }',
    '    const activeId = String(document.querySelector(".nav-account.active[data-id]")?.dataset.id || "");',
    '    if (activeId !== expected.accountId || !["telegram-z", "telegram-k"].includes(String(account.type || ""))) return { ...out, code: "CONTEXT_CHANGED" };',
    '    const capabilities = window.GeekPlatformCapabilitiesRuntime;',
    '    const adapter = typeof capabilities?.forAccount === "function" ? capabilities.forAccount(account, webview) : null;',
    '    const currentChatId = adapter && typeof adapter.getCurrentChat === "function" ? await adapter.getCurrentChat() : null;',
    '    if (String(currentChatId || "") !== expected.chatId) return { ...out, code: "CONTEXT_CHANGED" };',
    '    if (!state) return { ...out, code: "OWNER_RESULT_INVALID" };',
    '    out.contextStable = true;',
    '    out.code = state.terminal ? "OWNER_RESULT" : "WAITING_FOR_OPERATOR";',
    '    return out;',
    '  } catch { return { ...out, code: "SMOKE_FAILED" }; }',
    '})()',
  ].join('\n');
}

function buildHostCleanupExpression(context, smokeText, clearStaged) {
  const contextValue = JSON.stringify({ accountId: String(context?.accountId || ''), chatId: String(context?.chatId || '') });
  const messageValue = JSON.stringify(String(smokeText || ''));
  const shouldClear = clearStaged === true ? 'true' : 'false';
  return [
    '(async () => {',
    '  const expected = ' + contextValue + ';',
    '  const shouldClear = ' + shouldClear + ';',
    '  try {',
    '    const listed = await window.api?.accounts?.list?.();',
    '    const accounts = Array.isArray(listed?.accounts) ? listed.accounts : (Array.isArray(listed) ? listed : []);',
    '    const account = accounts.find(item => String(item?.id || "") === expected.accountId);',
    '    const partition = String(account?.partition || "");',
    '    const webview = Array.from(document.querySelectorAll("webview")).find(item => String(item.partition || item.getAttribute?.("partition") || "") === partition) || null;',
    '    if (!webview || typeof webview.executeJavaScript !== "function") return { kind: "CLEANUP_RESULT", cleared: false, observerRemoved: false, composerVerified: false, stagedTextPresent: false, requestSeen: false };',
    '    const guestCleanup = await webview.executeJavaScript("(() => { const s=window.__geekTelegramSendIntentSmokeObserver; if(!s)return {removed:false,requestSeen:false}; const requestSeen=s.requestSeen===true; if(window.__geekTranslationRequest===s.wrappedRequest)window.__geekTranslationRequest=s.originalRequest; if(window.__geekResolveTranslation===s.wrappedResolve)window.__geekResolveTranslation=s.originalResolve; delete window.__geekTelegramSendIntentSmokeObserver; return {removed:true,requestSeen}; })()", false);',
    '    let cleared = false;',
    '    let composerVerified = false;',
    '    let stagedTextPresent = false;',
    '    if (shouldClear && guestCleanup?.requestSeen !== true && String(document.querySelector(".nav-account.active[data-id]")?.dataset.id || "") === expected.accountId) {',
    '      const capabilities = window.GeekPlatformCapabilitiesRuntime;',
    '      const adapter = typeof capabilities?.forAccount === "function" ? capabilities.forAccount(account, webview) : null;',
    '      const currentChatId = adapter && typeof adapter.getCurrentChat === "function" ? await adapter.getCurrentChat() : null;',
    '      const composerText = adapter && typeof adapter.getComposerText === "function" ? await adapter.getComposerText() : null;',
    '      if (String(currentChatId || "") === expected.chatId && typeof composerText === "string") {',
    '        composerVerified = true;',
    '        stagedTextPresent = composerText.trim() === ' + messageValue + '.trim();',
    '        if (stagedTextPresent) cleared = await adapter.clearComposerText() === true;',
    '      }',
    '    }',
    '    return { kind: "CLEANUP_RESULT", cleared, observerRemoved: guestCleanup?.removed === true, composerVerified, stagedTextPresent, requestSeen: guestCleanup?.requestSeen === true };',
    '  } catch { return { kind: "CLEANUP_RESULT", cleared: false, observerRemoved: false, composerVerified: false, stagedTextPresent: false, requestSeen: false }; }',
    '})()',
  ].join('\n');
}

function classifyUnobservedExecution(operatorWindowOpened) {
  return operatorWindowOpened
    ? { sendResult: 'ambiguous', ownerState: 'uncertain', nativeCommitCount: 'unknown', code: 'OWNER_AMBIGUOUS' }
    : { sendResult: 'blocked', ownerState: 'not-started', nativeCommitCount: 'zero', code: 'OPERATOR_TIMEOUT' };
}

function isCleanupComplete(clearRequested, cleanupState) {
  if (cleanupState?.kind !== 'CLEANUP_RESULT' || cleanupState.observerRemoved !== true) return false;
  if (clearRequested !== true) return true;
  return cleanupState.composerVerified === true
    && (cleanupState.stagedTextPresent !== true || cleanupState.cleared === true);
}

function classifyOwnerTerminal(terminal, scenario = 'translated') {
  if (!terminal || typeof terminal !== 'object' || !ALLOWED_SCENARIOS.has(scenario)) return null;
  const ordinary = scenario === 'ordinary';
  if (ordinary && terminal.owner === true && terminal.state === 'sent' && terminal.identity !== true) return null;
  const rewriteEvidence = {
    composerWriteComplete: ordinary ? false : true,
    generationRebound: ordinary ? false : true,
    ...(ordinary ? { identityTransformObserved: terminal.identity === true } : {}),
  };
  if (terminal.owner === true && terminal.state === 'sent' && terminal.textReady === true && terminal.error === 'none') {
    return {
      sendResult: 'sent',
      ownerState: 'sent',
      trustedAdmission: true,
      transformComplete: true,
      ...rewriteEvidence,
      commitGuardPassed: true,
      nativeCommitCount: 'one',
      code: 'OWNER_SENT',
    };
  }
  if (terminal.error === 'uncertain') {
    return {
      sendResult: 'ambiguous',
      ownerState: 'uncertain',
      trustedAdmission: terminal.owner === true,
      transformComplete: terminal.owner === true && terminal.textReady === true,
      ...rewriteEvidence,
      commitGuardPassed: true,
      nativeCommitCount: 'one',
      code: 'OWNER_AMBIGUOUS',
    };
  }
  if (terminal.error === 'send-failed') {
    return {
      sendResult: 'failed',
      ownerState: 'failed',
      trustedAdmission: terminal.owner === true,
      transformComplete: terminal.owner === true && terminal.textReady === true,
      ...rewriteEvidence,
      commitGuardPassed: true,
      nativeCommitCount: 'one',
      code: 'OWNER_FAILED',
    };
  }
  if (terminal.owner === true && terminal.state === 'cancelled') {
    return {
      sendResult: 'blocked',
      ownerState: 'cancelled',
      trustedAdmission: true,
      transformComplete: false,
      composerWriteComplete: false,
      generationRebound: false,
      ...(ordinary ? { identityTransformObserved: false } : {}),
      commitGuardPassed: false,
      nativeCommitCount: 'zero',
      code: 'OWNER_CANCELLED',
    };
  }
  return {
    sendResult: 'ambiguous',
    ownerState: 'uncertain',
    trustedAdmission: terminal.owner === true,
    transformComplete: terminal.owner === true && terminal.textReady === true,
    composerWriteComplete: false,
    generationRebound: false,
    ...(ordinary ? { identityTransformObserved: terminal.identity === true } : {}),
    commitGuardPassed: false,
    nativeCommitCount: 'unknown',
    code: 'OWNER_AMBIGUOUS',
  };
}
async function runSmoke(mode = 'preflight', env = process.env, scenario = 'translated') {
  assertExecutionAllowed(mode, env, scenario);
  const targets = await getDebugTargets();
  const hostTargets = Array.isArray(targets) ? targets.filter(isGeekHostTarget) : [];
  if (hostTargets.length === 0) throw codedError('GEEK_HOST_TARGET_NOT_FOUND');
  if (hostTargets.length !== 1) throw codedError('GEEK_HOST_TARGET_AMBIGUOUS');

  const startedAt = Date.now();
  const smokeText = (mode === 'execute' || scenario === 'ordinary') ? buildSmokeMessage(startedAt, scenario) : '';
  const hostTarget = hostTargets[0];
  let prepared = null;
  let finalState = null;
  let cleanupState = null;
  let outputEvidence = null;
  let operatorWindowOpened = false;
  let cleanupRequested = false;

  try {
    prepared = await evaluateTarget(hostTarget, buildHostPrepareExpression(mode, smokeText, scenario));
    if (!prepared || prepared.kind !== 'PREPARE_RESULT') throw codedError('PROBE_RESULT_INVALID');
    const base = {
      mode,
      scenario,
      ordinaryPolicyReady: prepared.ordinaryPolicyReady === true,
      preflightReady: prepared.ready === true,
      telegramAccount: prepared.telegramAccount === true,
      webviewReady: prepared.webviewReady === true,
      translationBridgeReady: prepared.translationBridgeReady === true,
      trustedOwnerRuntimeReady: prepared.trustedOwnerRuntimeReady === true,
      translationSendEnabled: prepared.translationSendEnabled === true,
      currentChatReady: prepared.currentChatReady === true,
      composerEmpty: mode === 'preflight' ? prepared.composerEmpty === true : false,
      composerPrepared: prepared.composerPrepared === true,
      operatorActionRequired: mode === 'execute' && prepared.composerPrepared === true,
      sendResult: mode === 'preflight' ? 'not-attempted' : (prepared.composerPrepared ? 'waiting-for-operator' : 'blocked'),
      ownerState: 'not-started',
      code: prepared.code,
    };
    if (mode === 'preflight' || prepared.ready !== true || prepared.composerPrepared !== true) {
      return projectEvidence({ ...base, cleanup: 'not-needed', durationBucket: timingBucket(Date.now() - startedAt) });
    }

    const context = prepared.context;
    if (!context || typeof context.accountId !== 'string' || typeof context.chatId !== 'string') {
      throw codedError('PROBE_RESULT_INVALID');
    }
    const deadline = Date.now() + MAX_WAIT_MS;
    let lastPoll = null;
    operatorWindowOpened = true;
    process.stdout.write(JSON.stringify(projectEvidence({ ...base, sendResult: 'waiting-for-operator', code: 'WAITING_FOR_OPERATOR' })) + '\n');

    while (Date.now() < deadline) {
      lastPoll = await evaluateTarget(hostTarget, buildHostPollExpression(context, smokeText));
      if (!lastPoll || lastPoll.kind !== 'POLL_RESULT') throw codedError('PROBE_RESULT_INVALID');
      if (lastPoll.terminal) {
        const owner = classifyOwnerTerminal(lastPoll.terminal, scenario);
        if (!owner) throw codedError('OWNER_RESULT_INVALID');
        finalState = { ...base, ...owner, operatorActionRequired: false };
        break;
      }
      if (lastPoll.code === 'SMOKE_FAILED' || lastPoll.code === 'OWNER_RESULT_INVALID') {
        throw codedError('CDP_COMMAND_FAILED');
      }
      if (lastPoll.code === 'CONTEXT_CHANGED') {
        finalState = {
          ...base,
          preflightReady: false,
          operatorActionRequired: false,
          ...classifyUnobservedExecution(true),
          code: 'OWNER_AMBIGUOUS',
        };
        break;
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    if (!finalState) {
      const requestSeen = lastPoll?.requestSeen === true;
      finalState = {
        ...base,
        operatorActionRequired: false,
        sendResult: requestSeen ? 'ambiguous' : 'blocked',
        ownerState: requestSeen ? 'uncertain' : 'not-started',
        nativeCommitCount: requestSeen ? 'unknown' : 'zero',
        code: requestSeen ? 'OWNER_AMBIGUOUS' : 'OPERATOR_TIMEOUT',
      };
    }

    outputEvidence = projectEvidence({
      ...finalState,
      recipientReceipt: 'manual-pending',
      durationBucket: timingBucket(Date.now() - startedAt),
    });
    return outputEvidence;
  } catch (error) {
    const outcome = classifyUnobservedExecution(operatorWindowOpened);
    outputEvidence = projectEvidence({
      mode,
      scenario,
      ordinaryPolicyReady: prepared?.ordinaryPolicyReady === true,
      ...outcome,
      code: operatorWindowOpened
        ? 'OWNER_AMBIGUOUS'
        : (SAFE_ERROR_CODES.has(error?.code) ? error.code : 'SMOKE_FAILED'),
      cleanupComplete: mode !== 'execute',
      durationBucket: timingBucket(Date.now() - startedAt),
    });
    return outputEvidence;
  } finally {
    if (mode === 'execute' && prepared?.context && typeof smokeText === 'string' && smokeText) {
      const requestSeen = finalState?.sendResult === 'sent'
        || finalState?.sendResult === 'failed'
        || finalState?.sendResult === 'ambiguous';
      try {
        cleanupRequested = !requestSeen && (!operatorWindowOpened || finalState?.sendResult === 'blocked');
        cleanupState = await evaluateTarget(
          hostTarget,
          buildHostCleanupExpression(prepared.context, smokeText, cleanupRequested),
        );
      } catch {
        cleanupState = null;
      }
      if (outputEvidence) {
        if (cleanupState?.requestSeen === true && finalState?.code === 'OPERATOR_TIMEOUT') {
          Object.assign(outputEvidence, projectEvidence({
            ...outputEvidence,
            sendResult: 'ambiguous',
            ownerState: 'uncertain',
            nativeCommitCount: 'unknown',
            code: 'OWNER_AMBIGUOUS',
          }));
        }
        outputEvidence.cleanupComplete = isCleanupComplete(cleanupRequested, cleanupState);
      }
      // Cleanup evidence is intentionally kept in memory only; it contains no account/chat data.
    }
  }
}

async function main(argv = process.argv.slice(2), env = process.env) {
  let mode = 'preflight';
  try {
    mode = parseMode(argv);
    assertExecutionAllowed(mode, env);
    const result = await runSmoke(mode, env);
    process.stdout.write(JSON.stringify(projectEvidence(result)) + '\n');
    return result;
  } catch (error) {
    const code = SAFE_ERROR_CODES.has(error?.code) ? error.code : 'SMOKE_FAILED';
    process.stderr.write(JSON.stringify(projectEvidence({ mode, code, sendResult: 'blocked' })) + '\n');
    process.exitCode = 1;
    return null;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildHostPrepareExpression,
  CONFIRMATION_ENV,
  CONFIRMATION_VALUE,
  ORDINARY_CONFIRMATION_ENV,
  ORDINARY_CONFIRMATION_VALUE,
  assertExecutionAllowed,
  buildSmokeMessage,
  classifyOwnerTerminal,
  parseMode,
  projectEvidence,
  timingBucket,
  classifyUnobservedExecution,
  isCleanupComplete,
  runSmoke,
};
