'use strict';
// Baseline envelope contract.
//
// Purpose: pin the timing CEILINGS the repo already enforces, so the
// benchmark ruler (GOAL.md: startup/login, account isolation, send/receive,
// translation, resources, crash/update) starts from numbers instead of vibes.
//
// Honest scope, read before extending:
// - These are timeouts and poll budgets, NOT measured performance. A passing
//   gate proves the product stayed under a ceiling; it says nothing about
//   how fast it actually was. No threshold in this file is a performance
//   target, and no target may be invented here: thresholds come only after
//   the first real measurement lands (see the baseline Issue).
// - Send latency and multi-WebView memory measurement points have landed
//   since this contract was written (send-latency timing in #793, on-demand
//   per-partition memory sampling in #794). What is still missing is the
//   first real measurement run and any target derived from it: no threshold
//   in this file is a performance target, and no target may be invented
//   here. Targets come only after the first real measurement lands.
// - Real-session send latency needs the user's real-session authorization
//   (same pending boundary as #520/#521/#525/#528 evidence). Synthetic CI
//   may only measure synthetic sends.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function mustContain(source, pattern, message) {
  assert.match(source, pattern, message);
}

// --- WhatsApp runtime + bootstrap gates (cold start / injection) ---
const waRuntime = read('e2e/specs/whatsapp-wa-js-runtime.e2e.cjs');
mustContain(waRuntime, /GUEST_TIMEOUT_MS = 10_000/, 'WA runtime gate: guest must appear within 10s');
mustContain(waRuntime, /RUNTIME_TIMEOUT_MS = 45_000/, 'WA runtime gate: runtime must settle within 45s');
mustContain(waRuntime, /RENDERER_PROBE_TIMEOUT_MS = 2_000/, 'WA runtime gate: renderer probe budget is 2s');

const waBootstrap = read('e2e/specs/whatsapp-live-bootstrap.e2e.cjs');
mustContain(waBootstrap, /GUEST_TIMEOUT_MS = 10_000/, 'WA bootstrap gate: guest must appear within 10s');
mustContain(waBootstrap, /BOOTSTRAP_TIMEOUT_MS = 45_000/, 'WA bootstrap gate: terminal shell must arrive within 45s');
mustContain(waBootstrap, /RENDERER_PROBE_TIMEOUT_MS = 2_000/, 'WA bootstrap gate: renderer probe budget is 2s');

// --- Shell smoke gate (startup / renderer load) ---
const shellSmoke = read('e2e/specs/shell-smoke.e2e.cjs');
mustContain(shellSmoke, /STEP_TIMEOUT = 3000/, 'shell smoke: UI step budget is 3s');
mustContain(shellSmoke, /timeout: 10_000,\s*\n\s*timeoutMsg: 'Geek main renderer did not load'/, 'shell smoke: main renderer must load within 10s');

// --- Other platform runtime gates ---
for (const spec of ['instagram-runtime.e2e.cjs', 'messenger-runtime.e2e.cjs']) {
  const source = read('e2e/specs/' + spec);
  mustContain(source, /READY_TIMEOUT_MS = 30_000/, spec + ': platform ready budget is 30s');
}

// --- Send-path ceilings (WhatsApp transport definitions) ---
const transport = read('ui/platform-transport-definitions.js');
mustContain(transport, /setTimeout\(\(\) => res\(\{ id: 'submitted' \}\), 8000\)/, 'sendDirect: submit race budget is 8s');
mustContain(transport, /setTimeout\(\(\) => reject\(new Error\('名片发送超时，无回执'\)\), 8000\)/, 'sendVcards: receipt timeout is 8s');
mustContain(transport, /for \(let i = 0; i < 60; i\+\+\)/, 'ordinary composer: editor-empty poll is 60 rounds (15s at 250ms)');
mustContain(transport, /for \(let i = 0; i < 40; i\+\+\)/, 'message-appear poll is 40 rounds (10s at 250ms)');

// --- Main-process readiness ceiling ---
const main = read('src/main.cjs');
mustContain(main, /const deadline = Date\.now\(\) \+ 20000/, 'main readiness probe deadline is 20s');

console.log('Baseline envelope contract passed');
