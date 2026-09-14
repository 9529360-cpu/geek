'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const releaseMarker = fs.readFileSync(path.join(root, '.github/release-client-version'), 'utf8').trim();

assert.equal(pkg.version, releaseMarker, 'dependency migration must keep package version aligned with the formal client release marker');
assert.equal(pkg.dependencies['@wppconnect/wa-js'], '4.6.0', 'WA-JS must be deliberately pinned to tested stable 4.6.0');
assert.equal(lock.packages[''].dependencies['@wppconnect/wa-js'], '4.6.0', 'lock root must match the exact manifest pin');
assert.equal(lock.packages['node_modules/@wppconnect/wa-js'].version, '4.6.0', 'lock must resolve WA-JS 4.6.0');

const bundlePath = require.resolve('@wppconnect/wa-js');
const packageDir = path.dirname(path.dirname(bundlePath));
const installedPkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
assert.equal(installedPkg.version, '4.6.0', 'installed WA-JS must match the lock');

function allDeclarations(dir) {
  let out = '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) out += allDeclarations(target);
    else if (entry.isFile() && entry.name.endsWith('.d.ts')) out += fs.readFileSync(target, 'utf8') + '\n';
  }
  return out;
}

const declarations = allDeclarations(path.join(packageDir, 'dist'));
for (const api of [
  'sendTextMessage', 'sendFileMessage', 'getActiveChat', 'getPnLidEntry',
  'getParticipants', 'moduleRequire', '_moduleIdMap', 'UserPrefs', 'ChatStore'
]) {
  assert.ok(declarations.includes(api), 'WA-JS 4.6 declarations must retain Geek surface: ' + api);
}

const main = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui/app.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'ui/broadcast-runtime.js'), 'utf8');
const recovery = fs.readFileSync(path.join(root, 'ui/whatsapp-translation-hook-recovery.js'), 'utf8');
const { installWppCapabilityPicker, WPP_CAPABILITY_PICKER_SOURCE } = require('../src/wpp-capability-picker.cjs');

const injectionProbeStart = main.indexOf('const injectionReadinessProbe =');
const capabilityProbeStart = main.indexOf('const capabilityProbe =', injectionProbeStart);
assert.ok(injectionProbeStart >= 0 && capabilityProbeStart > injectionProbeStart, 'WA-JS injection and capability probes must have separate owners');
const injectionProbeSource = main.slice(injectionProbeStart, capabilityProbeStart);
assert.match(injectionProbeSource, /W\?\.isInjected === true[\s\S]*W\?\.isReady === true[\s\S]*loader\?\.moduleRequire[\s\S]*_moduleIdMap\?\.get/, 'injection ownership must wait only for official WA-JS settle + loader metadata');
for (const capability of ['sendTextMessage', 'sendFileMessage', 'getActiveChat', 'getPnLidEntry', 'getParticipants', 'ChatStore', 'UserPrefs', 'WAPLUS_WPP']) {
  assert.equal(injectionProbeSource.includes(capability), false, 'injection readiness must not depend on authenticated/fallback capability: ' + capability);
}
const capabilityProbeEnd = main.indexOf('let bundleExecuted = false;', capabilityProbeStart);
assert.ok(capabilityProbeEnd > capabilityProbeStart, 'capability probe must finish before injection retry loop');
const capabilityProbeSource = main.slice(capabilityProbeStart, capabilityProbeEnd);
for (const capability of ['sendTextMessage', 'sendFileMessage', 'getActiveChat', 'getPnLidEntry', 'getParticipants', 'ChatStore', 'UserPrefs', 'WAPLUS_WPP']) {
  assert.ok(capabilityProbeSource.includes(capability), 'capability diagnostics must retain Geek surface: ' + capability);
}
const officialBundleIndex = main.indexOf('../node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js', injectionProbeStart);
const injectionOwnerIndex = main.indexOf('wppInjected.add(part)', officialBundleIndex);
const fallbackBundleIndex = main.indexOf('../resources/waplus-wpp.js', injectionOwnerIndex);
assert.ok(officialBundleIndex >= 0 && injectionOwnerIndex > officialBundleIndex && fallbackBundleIndex > injectionOwnerIndex, 'official WA-JS injection ownership must commit before optional WAPLUS compatibility injection');
assert.match(main, /WPP_CAPABILITY_PICKER_SOURCE/, 'main process must own the page capability picker source');
const pickerInstallIndex = main.indexOf('executeJavaScript(WPP_CAPABILITY_PICKER_SOURCE)', injectionOwnerIndex);
assert.ok(pickerInstallIndex > injectionOwnerIndex && pickerInstallIndex < fallbackBundleIndex, 'capability picker must install after official injection ownership and before optional WAPLUS injection');
for (const [name, source] of [['main', main], ['app', app], ['runtime', runtime]]) {
  assert.doesNotMatch(source, /window\.WPP \|\| window\.WAPLUS_WPP/, name + ' must not select WPP/WAPLUS by object existence alone');
}
for (const capability of ['chat.sendTextMessage', 'chat.getMessages', 'chat.getActiveChat', 'whatsapp.ChatStore', 'contact.queryExists', 'group.getParticipants']) {
  assert.ok(app.includes('__geekPickWpp') && app.includes(capability), 'renderer must capability-select WPP for ' + capability);
}
for (const capability of ['whatsapp.UserPrefs', 'group.getParticipants', 'contact.queryExists']) {
  assert.ok(runtime.includes('__geekPickWpp') && runtime.includes(capability), 'broadcast runtime must capability-select WPP for ' + capability);
}
assert.match(main, /__geekPickWpp\?\.\(\['whatsapp\.ChatStore'\]\)/, 'main media path must capability-select ChatStore owner');
assert.match(recovery, /wpp\?\.loader[\s\S]*moduleRequire[\s\S]*_moduleIdMap/, 'ordinary composer recovery must continue consuming WA-JS loader metadata');
assert.match(app, /pair\?\.phoneNumber \|\| pair\?\.pn/, 'group-member LID mapping must prefer WA-JS 4.6 phoneNumber and retain legacy fallback');
assert.match(runtime, /pair\?\.phoneNumber \|\| pair\?\.pn/, 'broadcast LID mapping must prefer WA-JS 4.6 phoneNumber and retain legacy fallback');
assert.match(main, /waplus-wpp\.js/, 'WAPLUS compatibility bundle must remain wired');

const primary = { chat: { list() {}, sendTextMessage() {} } };
const fallback = { chat: { list() {}, sendTextMessage() {}, getMessages() {}, getActiveChat() {} }, whatsapp: { ChatStore: {} } };
const fakeWindow = { WPP: primary, WAPLUS_WPP: fallback };
assert.equal(installWppCapabilityPicker(fakeWindow), true, 'picker installer must report success');
assert.equal(fakeWindow.__geekPickWpp(['chat.list']), primary, 'official WPP must win when it satisfies the requested capability');
assert.equal(fakeWindow.__geekPickWpp(['chat.getMessages']), fallback, 'WAPLUS must win when official WPP is present but lacks the requested capability');
assert.equal(fakeWindow.__geekPickWpp(['whatsapp.ChatStore']), fallback, 'object-valued capability paths must select the capable fallback');
assert.equal(fakeWindow.__geekPickWpp(['group.getParticipants']), null, 'picker must fail closed when neither runtime owns the capability');
const serializedWindow = { WPP: primary, WAPLUS_WPP: fallback };
vm.runInNewContext(WPP_CAPABILITY_PICKER_SOURCE, { window: serializedWindow });
assert.equal(serializedWindow.__geekPickWpp(['chat.getActiveChat']), fallback, 'serialized page picker must preserve capability-based fallback behavior');

console.log('WA-JS 4.6 migration contract passed');
