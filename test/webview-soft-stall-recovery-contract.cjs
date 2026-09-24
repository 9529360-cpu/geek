'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.join(__dirname, '../ui/webview-crash-feedback.js');
const source = fs.readFileSync(modulePath, 'utf8');
const api = require(modulePath);

function classify(overrides = {}) {
  return api.classifyWhatsAppStartupProbe({
    probeOk: true,
    origin: api.WHATSAPP_WEB_ORIGIN,
    readyState: 'complete',
    visibleProgressCount: 1,
    terminalEvidenceCount: 0,
    wppReady: false,
    ...overrides,
  });
}

assert.equal(classify().stalled, true, 'a completed WhatsApp shell with only a persistent loading indicator is a soft stall');
assert.equal(classify().reason, 'bootstrap-progress-stalled');
assert.equal(classify({ wppReady: true }).stalled, true, 'WA-JS readiness must not override a user-visible splash stall');
assert.equal(classify({ terminalEvidenceCount: 1 }).stalled, false, 'visible login/chat controls are terminal evidence');
assert.equal(classify({ visibleProgressCount: 0 }).stalled, true, 'a completed WhatsApp document with no terminal UI is still a stalled UI');
assert.equal(classify({ visibleProgressCount: 0 }).reason, 'bootstrap-ui-stalled');
assert.equal(classify({ readyState: 'interactive' }).stalled, false, 'incomplete documents are still legitimately loading');
assert.equal(classify({ origin: 'https://example.com' }).stalled, false, 'watchdog is WhatsApp-origin scoped');
assert.equal(classify({ probeOk: false, probeFailed: true }).stalled, false, 'renderer probe failures must not trigger destructive guessing');
assert.equal(classify({ probeOk: false, probeTimedOut: true }).stalled, false, 'renderer probe timeouts must not trigger recovery');

let now = 0;
const limiter = api.createAccountRecoveryLimiter({
  now: () => now,
  windowMs: 600_000,
  limit: 1,
});
assert.equal(limiter.allow('account-a'), true);
assert.equal(limiter.allow('account-a'), false, 'same account may auto-recover only once per window');
assert.equal(limiter.allow('account-b'), true, 'one account must not consume another account recovery budget');
now = 600_001;
assert.equal(limiter.allow('account-a'), true, 'account budget must recover after the window');

const tracker = api.createTracker();
const blocked = tracker.forceBlocked('account-a', 'soft-stall');
assert.equal(blocked.phase, 'blocked');
assert.equal(blocked.stage, 'soft-stall');
tracker.remove('account-a');

assert.equal(api.WHATSAPP_BOOTSTRAP_GRACE_MS, 45_000);
assert.equal(api.WHATSAPP_BOOTSTRAP_CONFIRM_MS, 5_000);
assert.equal(api.WHATSAPP_PROBE_TIMEOUT_MS, 2_500);
assert.equal(api.WHATSAPP_AUTO_RECOVERY_LIMIT, 1);
assert.equal(api.WHATSAPP_AUTO_RECOVERY_WINDOW_MS, 600_000);

assert.match(source, /account\?\.type === 'whatsapp' \|\| account\?\.type === 'whatsapp-pure'/);
assert.match(source, /WHATSAPP_BOOTSTRAP_GRACE_MS = 45000/);
assert.match(source, /WHATSAPP_BOOTSTRAP_CONFIRM_MS = 5000/);
assert.match(source, /visibleProgressCount/);
assert.match(source, /terminalEvidenceCount/);
assert.match(source, /link-device-qr-code/, 'QR readiness must use WhatsApp-specific terminal evidence');
assert.match(source, /#pane-side/, 'logged-in chat readiness must use WhatsApp-specific terminal evidence');
assert.match(source, /loading-spinner/, 'QR spinner must be treated as loading evidence');
assert.match(source, /serviceWorkerControlled/, 'watchdog diagnostics must expose Service Worker control state');
assert.match(source, /serviceWorkerRegistrationCount/, 'watchdog diagnostics must expose Service Worker registration state');
assert.doesNotMatch(source, /querySelectorAll\('button,\[role=\\"button\\"\]/, 'generic buttons must not mark the WhatsApp QR page healthy');
assert.match(source, /reloadIgnoringCache\(\)/, 'soft-stall recovery must request fresh application resources');
assert.match(source, /webviewRecovery\?\.repairWhatsAppRuntime/, 'soft-stall repair must delegate persistent-partition cleanup to main');
assert.match(source, /repairWhatsAppRuntime\(accountId\)/, 'soft-stall repair must remain account-scoped');
assert.match(source, /softRecoveryLimiter\.allow\(accountId\)/, 'automatic reloads must be account-scoped and bounded');
assert.match(source, /tracker\.forceBlocked\(accountId, 'soft-stall'\)/, 'repeat stalls must stop automatic reload loops');
assert.match(source, /did-stop-loading/);
assert.match(source, /did-fail-load/);
assert.match(source, /webview\.isLoading\?\.\(\) === true/, 'late-bound WebViews must arm the watchdog even after lifecycle events were missed');
assert.doesNotMatch(source, /\[data-ref\]/, 'generic WhatsApp data-ref nodes must not be treated as terminal UI');
assert.doesNotMatch(
  source,
  /clearStorageData|clearCache\(|\.cookies\.|indexedDB\.|localStorage\.|removeAccount|session\.clear/,
  'renderer soft recovery must not clear identity-bearing stores or own session cleanup'
);
assert.doesNotMatch(
  source,
  /innerText|textContent.*probe|chatId|messageBody|Authorization|Cookie/,
  'startup probe must not inspect or retain chat/auth content'
);

console.log('WEBVIEW_SOFT_STALL_RECOVERY_CONTRACT_OK');
