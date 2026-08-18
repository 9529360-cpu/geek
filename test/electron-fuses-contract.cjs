'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const config = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');

assert.match(config, /electronFuses:\s*[\s\S]*?runAsNode:\s*false/, 'production package must disable ELECTRON_RUN_AS_NODE');
assert.match(config, /electronFuses:\s*[\s\S]*?enableNodeOptionsEnvironmentVariable:\s*false/, 'production package must ignore NODE_OPTIONS');
assert.match(config, /electronFuses:\s*[\s\S]*?enableNodeCliInspectArguments:\s*false/, 'production package must disable Node inspector CLI arguments');
assert.match(config, /electronFuses:\s*[\s\S]*?enableEmbeddedAsarIntegrityValidation:\s*true/, 'production package must enable embedded ASAR integrity validation');
assert.match(config, /electronFuses:\s*[\s\S]*?onlyLoadAppFromAsar:\s*true/, 'production package must only load application code from app.asar');

assert.doesNotMatch(config, /enableCookieEncryption:\s*true/, 'cookie encryption requires a separate persisted-session migration review');
assert.match(config, /asarUnpack:\s*[\s\S]*?resources\/bridge-preload\.cjs/, 'WA/TG bridge preload must remain explicitly unpacked');
assert.match(config, /asarUnpack:\s*[\s\S]*?resources\/extensions\/\*\*\/\*/, 'LINE extension must remain explicitly unpacked');

console.log('electron-fuses-contract: ok');
