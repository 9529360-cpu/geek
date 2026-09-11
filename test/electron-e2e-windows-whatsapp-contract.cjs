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
assert.match(windowsJob, /GEEK_E2E_SUITE:\s*whatsapp-bootstrap/, 'Windows lane must select only the WhatsApp bootstrap gate');
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
assert.match(runner, /'whatsapp-bootstrap':\s*path\.join\(root, 'e2e', 'specs', 'whatsapp-live-bootstrap\.e2e\.cjs'\)/, 'selector must resolve only the existing WhatsApp bootstrap spec');
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

assert.match(whatsappSpec, /LIVE_URL = 'https:\/\/web\.whatsapp\.com\/'/, 'bootstrap oracle must target current official WhatsApp Web');
assert.doesNotMatch(whatsappSpec, /browser\.pause\(/, 'bootstrap readiness must use bounded predicates instead of fixed sleeps');
assert.match(whatsappSpec, /BOOTSTRAP_TIMEOUT_MS = 45_000/, 'bootstrap polling must have a bounded timeout');
assert.match(whatsappSpec, /WA_WINDOWS_BOOTSTRAP platform=win32 guestFound=\$\{summary\.guestFound\} officialWeb=\$\{summary\.officialWeb\} documentComplete=\$\{summary\.documentComplete\} loginShell=\$\{summary\.loginShell\} loadingProgress=\$\{summary\.loadingProgress\}/, 'Windows gate must emit the stable non-sensitive summary');
assert.doesNotMatch(whatsappSpec, /console\.(?:log|error)\([^\n]*(?:document\.cookie|localStorage|sessionStorage|Authorization|qrData|innerText|textContent)/i, 'bootstrap logs must not expose credentials, QR payloads, or page bodies');

const acceptanceAssertions = whatsappSpec.split('\n').filter(line => /assert\.(?:equal|ok|deepEqual)/.test(line)).join('\n');
assert.doesNotMatch(acceptanceAssertions, /wpp|waplus|metaRequire/i, 'white-screen acceptance must stay independent of WPP/WAPLUS readiness');
assert.match(acceptanceAssertions, /summary\.officialWeb/, 'startup oracle must require official WhatsApp Web');
assert.match(acceptanceAssertions, /summary\.documentComplete/, 'startup oracle must require document completion');
assert.match(acceptanceAssertions, /summary\.loginShell/, 'startup oracle must require the QR/login shell');
assert.match(acceptanceAssertions, /summary\.loadingProgress/, 'startup oracle must require loading progress to disappear');

for (const sourcePath of collectSourceFiles(path.join(root, 'src'))) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.equal(source.includes('GEEK_E2E_SUITE'), false, `test-only selector leaked into product runtime: ${path.relative(root, sourcePath)}`);
}

const combined = [electronWorkflow, testWorkflow, runner, config, whatsappSpec].join('\n');
assert.doesNotMatch(combined, /%APPDATA%[\\/]geek|AppData[\\/]Roaming[\\/]geek/i, 'automated gate must never target real Geek userData');
assert.doesNotMatch(combined, /--no-sandbox/, 'Windows gate must never disable Electron sandboxing');

console.log('ELECTRON_E2E_WINDOWS_WHATSAPP_CONTRACT_OK');
