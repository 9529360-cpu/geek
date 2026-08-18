'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');

assert.match(
  main,
  /ses\.extensions\.loadExtension\(LINE_EXTENSION_PATH\)/,
  'LINE must use Electron Extensions.loadExtension'
);
assert.doesNotMatch(
  main,
  /ses\.loadExtension\(LINE_EXTENSION_PATH\)/,
  'deprecated Session.loadExtension must not be reintroduced for LINE'
);
assert.match(
  main,
  /session\.fromPartition\(partition, \{ cache: true \}\)/,
  'LINE extension must stay isolated in its persistent account session'
);

console.log('line-extension-api-contract: ok');
