'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const electronWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'electron-e2e.yml'), 'utf8');
const testWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'test.yml'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'e2e', 'run.cjs'), 'utf8');
const config = fs.readFileSync(path.join(root, 'e2e', 'wdio.conf.cjs'), 'utf8');
const whatsappSpec = fs.readFileSync(path.join(root, 'e2e', 'specs', 'whatsapp-live-bootstrap.e2e.cjs'), 'utf8');
const whatsappRuntimeSpec = fs.readFileSync(path.join(root, 'e2e', 'specs', 'whatsapp-wa-js-runtime.e2e.cjs'), 'utf8');
const whatsappOracle = fs.readFileSync(path.join(root, 'e2e', 'support', 'whatsapp-bootstrap-oracle.cjs'), 'utf8');
const oracleContract = fs.readFileSync(path.join(root, 'test', 'whatsapp-bootstrap-oracle-contract.cjs'), 'utf8');

function jobBlock(source, jobName) {
  const marker = `  ${jobName}:`;
  const start = source.indexOf(`\n${marker}`);
  assert.notEqual(start, -1, `workflow job missing: ${jobName}`);
  const bodyStart = start + 1;
  const tail = source.slice(bodyStart + marker.length);
  const next = tail.search(/\n  [A-Za-z0-9_-]+:\s*\n/);
  return next === -1 ? source.slice(bodyStart) : source.slice(bodyStart, bodyStart + marker.length + next);
}

function collectSourceFiles(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...collectSourceFiles(fullPath));
    else if (/\.(?:cjs|js|mjs)$/.test(entry.name)) result.push(fullPath);
  }
  return result;
}

const linuxJob = jobBlock(electronWorkflow, 'smoke');
const windowsJob = jobBlock(electronWorkflow, 'whatsapp-windows');
const gateJob = jobBlock(electronWorkflow, 'gate');
const testJob = jobBlock(testWorkflow, 'test');
const exactCandidatePattern = /ref:\s*\$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/;

assert.match(windowsJob, /runs-on:\s*windows-latest/, 'WhatsApp cold-start lane must use GitHub-hosted Windows');
assert.match(windowsJob, exactCandidatePattern, 'Windows lane must checkout the exact PR/commit candidate');
assert.match(windowsJob, /node-version:\s*'22'/, 'Windows lane must retain Node 22');
assert.match(windowsJob, /npm ci --ignore-scripts/, 'Windows lane must install dependencies without lifecycle scripts');
assert.match(windowsJob, /npm run electron:install/, 'Windows lane must prepare the real Electron runtime');
assert.match(windowsJob, /GEEK_E2E_SUITE:\s*whatsapp-bootstrap/, 'Windows lane must retain the independent WhatsApp bootstrap gate');
assert.match(windowsJob, /GEEK_E2E_SUITE:\s*whatsapp-runtime/, 'Windows lane must run the independent WA-JS runtime gate');
assert.match(windowsJob, /npm run test:e2e/, 'Windows lane must enter the canonical Electron E2E runner');
assert.doesNotMatch(windowsJob, /xvfb|dbus|gnome-keyring|libsecret|apt-get|--no-sandbox/i, 'Windows lane must not inherit Linux display/keyring setup or disable sandboxing');

assert.match(linuxJob, /runs-on:\s*ubuntu-latest/, 'existing Linux Electron E2E must remain hosted on Ubuntu');
assert.match(linuxJob, exactCandidatePattern, 'Linux Electron E2E must remain exact-candidate bound');
assert.match(linuxJob, /xvfb-run -a npm run test:e2e/, 'Linux lane must keep the existing full E2E entry');
assert.doesNotMatch(linuxJob, /GEEK_E2E_SUITE/, 'default Linux E2E must not be narrowed by the Windows selector');

assert.match(gateJob, /needs:\s*\[whitespace, smoke, whatsapp-windows\]/, 'final electron-e2e gate must require whitespace, Linux smoke, and Windows WhatsApp');
assert.match(gateJob, /WINDOWS_WHATSAPP_RESULT:\s*\$\{\{ needs\.whatsapp-windows\.result \}\}/, 'gate must read the Windows WhatsApp result');
assert.match(gateJob, /WINDOWS_WHATSAPP_RESULT[^\n]*success|\$WINDOWS_WHATSAPP_RESULT[^\n]*success/s, 'gate must fail when the Windows WhatsApp lane is not successful');

assert.match(testJob, exactCandidatePattern, 'npm test CI must also checkout the exact PR/commit candidate');

assert.match(runner, /const requestedSuite = String\(process\.env\.GEEK_E2E_SUITE \|\| ''\)\.trim\(\)/, 'targeted selector must default to disabled');
assert.match(runner, /'whatsapp-bootstrap':\s*path\.join\(root, 'e2e', 'specs', 'whatsapp-live-bootstrap\.e2e\.cjs'\)/, 'selector must retain the WhatsApp bootstrap spec');
assert.match(runner, /'whatsapp-runtime':\s*path\.join\(root, 'e2e', 'specs', 'whatsapp-wa-js-runtime\.e2e\.cjs'\)/, 'selector must expose the independent WA-JS runtime spec');
assert.match(runner, /args\.push\('--spec', specPath\)/, 'targeted selection must use WebdriverIO test-only spec selection');
assert.match(runner, /delete baseEnv\.GEEK_E2E_SUITE/, 'selector must not be forwarded as product runtime configuration');
assert.match(runner, /if \(requestedSuite\)[\s\S]*runWdio\('wdio\.conf\.cjs', undefined, selectedSpec\)/, 'targeted mode must run only the canonical WDIO config with the selected spec');
assert.match(runner, /else \{[\s\S]*runWdio\('wdio\.scheduled-restart\.conf\.cjs', 'seed'\)[\s\S]*runWdio\('wdio\.scheduled-restart\.conf\.cjs', 'verify'\)[\s\S]*runWdio\('wdio\.conf\.cjs'\)/, 'selector-off behavior must preserve the existing full E2E chain');
assert.match(runner, /mkdtempSync\(path\.join\(os\.tmpdir\(\), 'geek-e2e-'\)\)/, 'all E2E modes must use a random OS-temp Geek profile');
assert.match(runner, /e2e-account-a/, 'Windows gate must retain the synthetic WhatsApp account');
assert.match(runner, /fs\.rmSync\(tempDir, \{ recursive: true, force: true/, 'isolated profile must be deleted after the run');

assert.match(config, /appEntryPoint:\s*path\.join\(__dirname, '\.\.', 'src', 'main-entry\.cjs'\)/, 'Windows and Linux must launch the real Electron entry');
assert.match(config, /GEEK_USER_DATA_DIR/, 'canonical config must consume the isolated E2E userData path');
assert.match(config, /path\.basename\(e2eUserDataDir\)\.startsWith\('geek-e2e-'\)/, 'canonical config must fail closed outside geek-e2e-* temp profiles');
assert.match(config, /appArgs:\s*\[\]/, 'Electron service must preserve the real sandbox');
assert.doesNotMatch(config, /--no-sandbox|nodeIntegration\s*:\s*true|contextIsolation\s*:\s*false|webSecurity\s*:\s*false/, 'E2E portability must not weaken Electron/WebView security');

assert.match(whatsappSpec, /WHATSAPP_WEB_ORIGIN.*classifyWhatsAppBootstrap.*whatsapp-bootstrap-oracle\.cjs/, 'live spec must delegate deterministic readiness to the test-only oracle');
assert.match(whatsappSpec, /LIVE_URL = WHATSAPP_WEB_ORIGIN \+ '\/'/, 'bootstrap integration must stay pinned to current official WhatsApp Web');
assert.doesNotMatch(whatsappSpec, /browser\.pause\(/, 'bootstrap readiness must use bounded predicates instead of fixed sleeps');
assert.match(whatsappSpec, /BOOTSTRAP_TIMEOUT_MS = 45_000/, 'bootstrap polling must retain the bounded 45 second timeout');
assert.match(whatsappSpec, /document\.createTreeWalker/, 'login-shell evidence must use user-facing rendered text rather than full-page text dumps');
assert.match(whatsappSpec, /document\.elementsFromPoint/, 'login-shell evidence must verify that terminal content is actually observable rather than merely present in DOM');
assert.doesNotMatch(whatsappSpec, /document\.body\?\.innerText/, 'bootstrap probe must not treat full body text as the readiness oracle');
assert.match(whatsappSpec, /loginShellPresent/, 'probe must distinguish terminal evidence existing from terminal evidence being observable');
assert.match(whatsappSpec, /loginShellVisible/, 'probe must return observable login-shell evidence');
assert.match(whatsappSpec, /progressCount:\s*boundedCount\(progressElements\.length\)/, 'raw progress elements may remain bounded diagnostic telemetry');
assert.match(whatsappSpec, /visibleProgressCount:\s*boundedCount\(visibleProgressCount\)/, 'visible progress elements may remain bounded diagnostic telemetry');
assert.match(whatsappSpec, /rendererProbeOk:\s*true/, 'successful renderer execution must be explicit');
assert.match(whatsappSpec, /rendererProbeFailed:\s*true/, 'renderer execute failure must be explicit');
assert.match(whatsappSpec, /rendererProbeTimedOut:\s*true/, 'renderer probe timeout must be explicit');
assert.match(whatsappSpec, /return classification\.ready[\s\S]{0,260}state\.qrCodeVisible === true[\s\S]{0,260}state\.serviceWorkerControlled === true[\s\S]{0,260}serviceWorkerRegistrationCount/, 'bounded waitUntil polling must require the pure classifier plus an actual QR and controlling Service Worker');
assert.match(whatsappSpec, /sessionUserAgent:\s*guest\.session\?\.getUserAgent/, 'live gate must capture the account Session UA used by Service Worker requests');
assert.match(whatsappSpec, /assert\.equal\(state\.sessionUserAgent, state\.rendererUserAgent/, 'live gate must require Session and renderer UA identity to match');
assert.match(whatsappSpec, /assert\.doesNotMatch\(state\.sessionUserAgent, \/Electron\\\//, 'live gate must reject Electron product tokens in the WhatsApp Session UA');
assert.match(whatsappSpec, /WA_WINDOWS_BOOTSTRAP platform=win32 guestFound=\$\{summary\.guestFound\} officialWeb=\$\{summary\.officialWeb\} rendererResponsive=\$\{summary\.rendererResponsive\} documentComplete=\$\{summary\.documentComplete\} loginShell=\$\{summary\.loginShell\} terminalBlocked=\$\{summary\.terminalBlocked\} loadingProgress=\$\{summary\.loadingProgress\} visibleLoadingProgress=\$\{summary\.visibleLoadingProgress\}/, 'Windows gate must emit stable non-sensitive acceptance plus progress telemetry');
assert.doesNotMatch(whatsappSpec, /console\.(?:log|error)\([^\n]*(?:document\.cookie|localStorage|sessionStorage|Authorization|qrData|innerText|textContent)/i, 'bootstrap logs must not expose credentials, QR payloads, or page bodies');
assert.doesNotMatch(whatsappSpec, /getAttribute\(['"]data-ref['"]\)|\.dataset\.ref\b/, 'QR payload values must never be read by the bootstrap gate');

assert.match(whatsappOracle, /WHATSAPP_WEB_ORIGIN = 'https:\/\/web\.whatsapp\.com'/, 'pure oracle must use the exact official WhatsApp Web origin');
assert.match(whatsappOracle, /mainOrigin === WHATSAPP_WEB_ORIGIN && rendererOrigin === WHATSAPP_WEB_ORIGIN/, 'both main-process and renderer origins must be official');
assert.match(whatsappOracle, /state\.rendererProbeOk !== true/, 'renderer responsiveness must fail closed on malformed probe results');
assert.match(whatsappOracle, /state\.loginShellVisible === true/, 'terminal success must come from observable login-shell evidence');
assert.match(whatsappOracle, /state\.loginShellPresent === true && !loginShell/, 'present but unobservable terminal evidence must be marked blocked');
assert.doesNotMatch(whatsappOracle, /WPP|WAPLUS|metaRequire/, 'WPP/WAPLUS diagnostics must not enter the bootstrap oracle');

const classifierStart = whatsappOracle.indexOf('function classifyWhatsAppBootstrap');
const classifierEnd = whatsappOracle.indexOf('\nmodule.exports', classifierStart);
assert.ok(classifierStart >= 0 && classifierEnd > classifierStart, 'pure classifier source must be recoverable for contract checks');
const classifierSource = whatsappOracle.slice(classifierStart, classifierEnd);
assert.match(classifierSource, /!summary\.guestFound/, 'pure oracle must reject missing guest');
assert.match(classifierSource, /!summary\.rendererResponsive/, 'pure oracle must reject renderer failure');
assert.match(classifierSource, /!summary\.officialWeb/, 'pure oracle must reject wrong origin');
assert.match(classifierSource, /!summary\.documentComplete/, 'pure oracle must reject incomplete document');
assert.match(classifierSource, /summary\.terminalBlocked/, 'pure oracle must reject present-but-unobservable terminal evidence');
assert.match(classifierSource, /!summary\.loginShell/, 'pure oracle must reject missing observable login shell');
assert.doesNotMatch(classifierSource, /loadingProgress|progressCount|visibleLoadingProgress/, 'progress element counts must never decide bootstrap acceptance');

const acceptanceAssertions = whatsappSpec.split('\n').filter(line => /assert\.(?:equal|ok|deepEqual)/.test(line)).join('\n');
assert.doesNotMatch(acceptanceAssertions, /wpp|waplus|metaRequire/i, 'white-screen acceptance must stay independent of WPP/WAPLUS readiness');
assert.match(acceptanceAssertions, /summary\.guestFound/, 'startup oracle must require the exact synthetic guest');
assert.match(acceptanceAssertions, /summary\.rendererResponsive/, 'startup oracle must require a responsive renderer');
assert.match(acceptanceAssertions, /summary\.officialWeb/, 'startup oracle must require official WhatsApp Web');
assert.match(acceptanceAssertions, /summary\.documentComplete/, 'startup oracle must require document completion');
assert.match(acceptanceAssertions, /summary\.terminalBlocked/, 'startup oracle must reject an unobservable terminal shell');
assert.match(acceptanceAssertions, /summary\.loginShell/, 'startup oracle must require the user-visible QR/login shell');
assert.doesNotMatch(acceptanceAssertions, /summary\.loadingProgress|summary\.visibleLoadingProgress/, 'progress telemetry must not be asserted as readiness');

assert.match(oracleContract, /progressCount:\s*1/, 'deterministic oracle contract must include ordinary progress on a valid terminal state');
assert.match(oracleContract, /ordinaryProgress\.ready, true/, 'ordinary progress alongside a visible login shell must pass');
assert.match(oracleContract, /missingTerminal\.ready, false/, 'missing login terminal state must fail deterministically');
assert.match(oracleContract, /rendererTimeout\.ready, false/, 'renderer timeout must fail deterministically');
assert.match(oracleContract, /rendererFailure\.ready, false/, 'renderer execute failure must fail deterministically');
assert.match(oracleContract, /wrongMainOrigin\.ready, false/, 'wrong main origin must fail deterministically');
assert.match(oracleContract, /wrongRendererOrigin\.ready, false/, 'wrong renderer origin must fail deterministically');
assert.match(oracleContract, /incompleteDocument\.ready, false/, 'incomplete document must fail deterministically');
assert.match(oracleContract, /blockingTerminal\.ready, false/, 'blocked terminal evidence must fail deterministically');

for (const sourcePath of collectSourceFiles(path.join(root, 'src'))) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.equal(source.includes('GEEK_E2E_SUITE'), false, `test-only selector leaked into product runtime: ${path.relative(root, sourcePath)}`);
}

const combined = [electronWorkflow, testWorkflow, runner, config, whatsappSpec, whatsappOracle, oracleContract].join('\n');
assert.doesNotMatch(combined, /%APPDATA%[\\/]geek|AppData[\\/]Roaming[\\/]geek/i, 'automated gate must never target real Geek userData');
assert.doesNotMatch(combined, /--no-sandbox/, 'Windows gate must never disable Electron sandboxing');

console.log('ELECTRON_E2E_WINDOWS_WHATSAPP_CONTRACT_OK');

assert.match(whatsappRuntimeSpec, /version === '4\.6\.0'/, 'WA-JS runtime gate must require the exact tested version');
assert.match(whatsappRuntimeSpec, /function injectionReady\(state\)[\s\S]*state\?\.loaderReady === true;/, 'WA-JS runtime gate must terminate on official injection + loader readiness');
assert.doesNotMatch(whatsappRuntimeSpec, /function injectionReady\(state\)[\s\S]{0,500}state\?\.(?:chatReady|lidGroupReady|storesReady|fallbackReady) === true/, 'synthetic injection gate must not require authenticated or WAPLUS capabilities');
assert.match(whatsappRuntimeSpec, /chatReady[\s\S]*lidGroupReady[\s\S]*storesReady[\s\S]*fallbackReady/, 'WA-JS runtime probe must retain bounded capability diagnostics without making them startup gates');
assert.doesNotMatch(whatsappRuntimeSpec, /document\.cookie|localStorage|sessionStorage|Authorization|qrData|innerText|textContent/i, 'WA-JS runtime diagnostics must not read secrets or page bodies');
