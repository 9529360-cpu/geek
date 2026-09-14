'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

assert.match(main, /W\?\.isReady === true[\s\S]*loader\?\.moduleRequire[\s\S]*_moduleIdMap\?\.get/, 'injection must wait for WA-JS loader metadata readiness');
assert.match(main, /sendTextMessage[\s\S]*sendFileMessage[\s\S]*getActiveChat[\s\S]*getPnLidEntry[\s\S]*getParticipants/, 'injection readiness gate must cover Geek send/LID/group surfaces');
assert.match(main, /window\.WPP \|\| window\.WAPLUS_WPP/, 'main-process guest code must prefer stable WA-JS and preserve WAPLUS fallback');
assert.match(app, /window\.WPP \|\| window\.WAPLUS_WPP/, 'renderer WhatsApp integrations must prefer stable WA-JS');
assert.match(runtime, /window\.WPP \|\| window\.WAPLUS_WPP/, 'broadcast runtime must prefer stable WA-JS');
assert.match(recovery, /wpp\?\.loader[\s\S]*moduleRequire[\s\S]*_moduleIdMap/, 'ordinary composer recovery must continue consuming WA-JS loader metadata');
assert.match(main, /fallback\?\.chat\?\.sendTextMessage[\s\S]*fallback\?\.chat\?\.sendFileMessage[\s\S]*fallback\?\.contact\?\.getPnLidEntry[\s\S]*fallback\?\.group\?\.getParticipants/, 'WAPLUS fallback must retain text/media/LID/group compatibility');
assert.match(app, /pair\?\.phoneNumber \|\| pair\?\.pn/, 'group-member LID mapping must prefer WA-JS 4.6 phoneNumber and retain legacy fallback');
assert.match(runtime, /pair\?\.phoneNumber \|\| pair\?\.pn/, 'broadcast LID mapping must prefer WA-JS 4.6 phoneNumber and retain legacy fallback');
assert.match(main, /waplus-wpp\.js/, 'WAPLUS compatibility bundle must remain wired');

console.log('WA-JS 4.6 migration contract passed');
