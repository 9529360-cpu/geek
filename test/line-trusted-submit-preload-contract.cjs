'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const helper = fs.readFileSync(path.join(root, 'resources', 'extensions', 'line-3.5.1', 'geek-trusted-submit-preload.cjs'), 'utf8').replace(/\r\n?/g, '\n');
const isolated = fs.readFileSync(path.join(root, 'resources', 'extensions', 'line-3.5.1', 'geek-isolated-preload.cjs'), 'utf8').replace(/\r\n?/g, '\n');
const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8').replace(/\r\n?/g, '\n');
const sessionOwner = fs.readFileSync(path.join(root, 'src', 'line-trusted-submit-session.cjs'), 'utf8').replace(/\r\n?/g, '\n');
const policy = fs.readFileSync(path.join(root, 'src', 'line-context-isolation-policy.cjs'), 'utf8').replace(/\r\n?/g, '\n');

assert.match(helper, /const \{ ipcRenderer \} = require\('electron'\)/);
assert.match(helper, /process\.isMainFrame === true/);
assert.match(helper, /geek-trusted-submit/);
assert.match(helper, /geek-trusted-composer-context/);
assert.match(helper, /data-geek-line-trusted-submit/);
assert.match(helper, /protocolVersion:\s*TRUSTED_SUBMIT_PROTOCOL_VERSION[\s\S]*platform:\s*'line'/);
for (const eventName of ['focusin', 'beforeinput', 'keydown', 'click']) {
  assert.match(helper, new RegExp("addEventListener\\('" + eventName + "'[\\s\\S]{0,500}data-geek-native-submit-commit[\\s\\S]{0,500}isTrusted"));
}
assert.match(helper, /event\.key !== 'Enter'/);
assert.match(helper, /event\.shiftKey\s*\|\|\s*event\.ctrlKey\s*\|\|\s*event\.altKey\s*\|\|\s*event\.metaKey/);
assert.match(helper, /event\.isComposing\s*\|\|\s*event\.repeat/);
assert.match(helper, /aria-label\*=\"send\" i/, 'trusted click capture must use the same semantic send selector as the platform commit');
assert.doesNotMatch(helper, /window\.\$electron|send2Host\(\{\s*type:/, 'trusted authority must come from preload ipcRenderer, not page-provided bridge objects');

assert.doesNotMatch(isolated, /require\(['"]\.\/geek-trusted-submit-preload\.cjs['"]\)/, 'sandboxed preload must not require local helper modules');
assert.match(main, /ensureLineTrustedSubmitPreload\([\s\S]{0,180}path\.join\(LINE_EXTENSION_PATH, 'geek-trusted-submit-preload\.cjs'\)/);
assert.match(main, /legacyPreloadPath:\s*path\.join\(__dirname,\s*'\.\.',\s*'resources',\s*'s3loYR\.js'\)/);
assert.match(main, /candidatePreloadPath:\s*path\.join\(__dirname,\s*'\.\.',\s*'resources',\s*'extensions',\s*'line-3\.5\.1',\s*'geek-isolated-preload\.cjs'\)/);
assert.match(sessionOwner, /registerPreloadScript\(\{[\s\S]*id:\s*LINE_TRUSTED_SUBMIT_PRELOAD_ID,[\s\S]*type:\s*'frame',[\s\S]*filePath:\s*absolutePath/);
assert.match(sessionOwner, /getPreloadScripts\(\)[\s\S]*LINE_TRUSTED_SUBMIT_PRELOAD_ID/);
assert.match(policy, /webPreferences\.contextIsolation = false/, 'default LINE compatibility mode must remain contextIsolation=false');
assert.match(policy, /webPreferences\.contextIsolation = true/, 'candidate mode remains explicitly isolated');
assert.match(main, /webPreferences\.nodeIntegration = false/);
assert.match(main, /webPreferences\.nodeIntegrationInSubFrames = false/);
assert.match(main, /webPreferences\.webSecurity = true/);

console.log('LINE_TRUSTED_SUBMIT_PRELOAD_CONTRACT_OK');
