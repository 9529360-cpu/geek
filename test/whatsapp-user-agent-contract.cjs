'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');

assert.match(
  source,
  /const CHROMIUM_VERSION = String\(process\.versions\.chrome \|\| ''\)\.trim\(\);/,
  'browser UA must derive its Chrome generation from Electron Chromium'
);
assert.match(
  source,
  /Chrome\/\$\{CHROMIUM_VERSION \|\| '150\.0\.0\.0'\}/,
  'browser UA must advertise the runtime Chromium generation'
);
assert.doesNotMatch(
  source,
  /Chrome\/124\.0\.6367\.243/,
  'WhatsApp must not be pinned to the obsolete Chrome 124 UA'
);
assert.doesNotMatch(
  source,
  /Electron\//,
  'the WhatsApp-facing Chrome UA contract must not expose an Electron product token'
);

console.log('WHATSAPP_USER_AGENT_CONTRACT_OK');
