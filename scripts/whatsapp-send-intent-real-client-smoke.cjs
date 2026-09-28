'use strict';

const {
  getDebugTargets,
  evaluateTarget,
  isGeekHostTarget,
} = require('./line-auth-regression-probe.cjs');

const SAFE_CODES = new Set([
  'READY',
  'GEEK_HOST_TARGET_NOT_FOUND',
  'GEEK_HOST_TARGET_AMBIGUOUS',
  'WHATSAPP_ACCOUNT_NOT_FOUND',
  'WHATSAPP_ACCOUNT_AMBIGUOUS',
  'WEBVIEW_NOT_FOUND',
  'WEBVIEW_HIDDEN',
  'WPP_NOT_READY',
  'CHAT_LIST_NOT_READY',
  'CHAT_LIST_READY_NO_ACTIVE_CHAT',
  'NO_COMPOSER',
  'COMPOSER_NOT_EMPTY',
  'BRIDGE_NOT_READY',
  'OWNER_RUNTIME_NOT_READY',
  'PROBE_FAILED',
]);

function projectEvidence(input = {}) {
  const code = SAFE_CODES.has(String(input.code || '')) ? String(input.code) : 'PROBE_FAILED';
  return {
    schemaVersion: 'v1-preflight',
    whatsappAccount: input.whatsappAccount === true,
    accountActive: input.accountActive === true,
    webviewReady: input.webviewReady === true,
    wppReady: input.wppReady === true,
    chatListReady: input.chatListReady === true,
    chatListPopulated: input.chatListPopulated === true,
    currentChatReady: input.currentChatReady === true,
    composerPresent: input.composerPresent === true,
    composerEmpty: input.composerPresent === true && input.composerEmpty === true,
    translationBridgeReady: input.translationBridgeReady === true,
    trustedOwnerRuntimeReady: input.trustedOwnerRuntimeReady === true,
    directComposerVersion: Number(input.directComposerVersion || 0),
    preflightReady: input.preflightReady === true,
    code,
  };
}

async function guestPreflightProbe() {
  const selector = '#main footer [contenteditable="true"], #main [data-testid="conversation-compose-box-input"], #main [contenteditable="true"][data-tab="10"]';
  const W = window.__geekPickWpp?.(['chat.list', 'chat.getActiveChat']) || window.WPP || null;
  let chatListReady = false;
  let chatListPopulated = false;
  try {
    if (typeof W?.chat?.list === 'function') {
      const raw = await W.chat.list();
      const chats = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? Object.values(raw) : []);
      chatListReady = true;
      chatListPopulated = chats.length > 0;
    }
  } catch {}
  let active = null;
  try { active = W?.chat?.getActiveChat?.() || window.W?.chat?.getActive?.() || null; } catch {}
  const editor = document.querySelector(selector);
  const composerText = String(editor?.innerText || editor?.textContent || '').replace(/\u200b/g, '').trim();
  const controller = window.__geekWhatsAppDirectComposerController;
  return {
    wppReady: window.WPP?.isInjected === true && window.WPP?.isReady === true,
    chatListReady,
    chatListPopulated,
    currentChatReady: !!active,
    composerPresent: !!editor,
    composerEmpty: !!editor && composerText.length === 0,
    translationBridgeReady: document.documentElement?.getAttribute?.('data-geek-bridge') === '1'
      && typeof window.__geekTranslationRequest === 'function'
      && typeof window.__geekTranslationBridgeToken === 'string'
      && window.__geekTranslationBridgeToken.length > 0,
    directComposerVersion: Number(controller?.version || 0),
    directComposerActive: controller?.active === true,
    directComposerOwnerReady: typeof controller?.submitThroughOwner === 'function',
  };
}

async function hostPreflightProbe(guestSource) {
  const out = { kind: 'WHATSAPP_PREFLIGHT', code: 'PROBE_FAILED' };
  try {
    const listed = await window.api?.accounts?.list?.();
    const accounts = Array.isArray(listed?.accounts) ? listed.accounts : (Array.isArray(listed) ? listed : []);
    const activeId = String(document.querySelector('.nav-account.active[data-id]')?.dataset.id || '');
    const whatsapp = accounts.filter(item => ['whatsapp', 'whatsapp-pure'].includes(String(item?.type || '')));
    const activeWhatsApp = whatsapp.find(item => String(item?.id || '') === activeId) || null;
    const account = activeWhatsApp || (whatsapp.length === 1 ? whatsapp[0] : null);
    out.whatsappAccount = !!account;
    out.accountActive = !!account && String(account.id || '') === activeId;
    if (!account) return { ...out, code: whatsapp.length > 1 ? 'WHATSAPP_ACCOUNT_AMBIGUOUS' : 'WHATSAPP_ACCOUNT_NOT_FOUND' };

    const partition = String(account.partition || '');
    const webview = Array.from(document.querySelectorAll('webview')).find(
      item => String(item.partition || item.getAttribute?.('partition') || '') === partition,
    ) || null;
    if (!webview || typeof webview.executeJavaScript !== 'function') return { ...out, code: 'WEBVIEW_NOT_FOUND' };

    const rect = webview.getBoundingClientRect();
    const style = getComputedStyle(webview);
    out.webviewReady = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    const guest = await webview.executeJavaScript('(' + guestSource + ')()', false);
    Object.assign(out, guest || {});

    const capabilities = window.GeekPlatformCapabilitiesRuntime;
    const adapter = typeof capabilities?.forAccount === 'function' ? capabilities.forAccount(account, webview) : null;
    const adapterChat = adapter && typeof adapter.getCurrentChat === 'function' ? await adapter.getCurrentChat() : null;
    out.currentChatReady = out.currentChatReady === true && typeof adapterChat === 'string' && adapterChat.length > 0;
    out.trustedOwnerRuntimeReady = typeof window.GeekTrustedSubmitRuntime?.create === 'function'
      && typeof window.GeekTrustedSubmitPermits?.createAuthority === 'function'
      && typeof window.GeekSendIntentExecutor?.create === 'function'
      && out.directComposerVersion === 9
      && out.directComposerActive === true
      && out.directComposerOwnerReady === true;

    out.preflightReady = out.webviewReady === true
      && out.wppReady === true
      && out.chatListReady === true
      && out.currentChatReady === true
      && out.composerPresent === true
      && out.composerEmpty === true
      && out.translationBridgeReady === true
      && out.trustedOwnerRuntimeReady === true;

    out.code = out.preflightReady ? 'READY'
      : !out.webviewReady ? 'WEBVIEW_HIDDEN'
        : !out.wppReady ? 'WPP_NOT_READY'
          : !out.chatListReady ? 'CHAT_LIST_NOT_READY'
            : !out.currentChatReady ? 'CHAT_LIST_READY_NO_ACTIVE_CHAT'
              : !out.composerPresent ? 'NO_COMPOSER'
                : !out.composerEmpty ? 'COMPOSER_NOT_EMPTY'
                  : !out.translationBridgeReady ? 'BRIDGE_NOT_READY'
                    : !out.trustedOwnerRuntimeReady ? 'OWNER_RUNTIME_NOT_READY' : 'PROBE_FAILED';
    return out;
  } catch {
    return { ...out, code: 'PROBE_FAILED' };
  }
}

function buildHostPreflightExpression() {
  return '(' + hostPreflightProbe.toString() + ')(' + JSON.stringify(guestPreflightProbe.toString()) + ')';
}

async function runPreflight() {
  const targets = await getDebugTargets();
  const hosts = Array.isArray(targets) ? targets.filter(isGeekHostTarget) : [];
  if (hosts.length === 0) return projectEvidence({ code: 'GEEK_HOST_TARGET_NOT_FOUND' });
  if (hosts.length !== 1) return projectEvidence({ code: 'GEEK_HOST_TARGET_AMBIGUOUS' });
  try {
    return projectEvidence(await evaluateTarget(hosts[0], buildHostPreflightExpression()));
  } catch {
    return projectEvidence({ code: 'PROBE_FAILED' });
  }
}

async function main() {
  const result = await runPreflight();
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.preflightReady) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write(JSON.stringify(projectEvidence({ code: 'PROBE_FAILED' })) + '\n');
    process.exit(1);
  });
}

module.exports = {
  SAFE_CODES,
  projectEvidence,
  guestPreflightProbe,
  hostPreflightProbe,
  buildHostPreflightExpression,
  runPreflight,
  main,
};
