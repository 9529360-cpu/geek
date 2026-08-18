'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const builder = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
const runtimePaths = fs.readFileSync(path.join(root, 'src', 'runtime-paths.cjs'), 'utf8');

assert.match(
  builder,
  /asarUnpack:[\s\S]*resources\/bridge-preload\.cjs/,
  'bridge-preload.cjs must be unpacked because packaged runtime resolves it from app.asar.unpacked'
);
assert.match(
  runtimePaths,
  /app\.asar\.unpacked['"`]?\s*,\s*['"`]resources/,
  'packaged resources path must continue to resolve through app.asar.unpacked/resources'
);
assert.match(
  main,
  /path\.join\(RESOURCES_DIR,\s*['"]bridge-preload\.cjs['"]\)/,
  'main process must attach the bridge preload from the shared resources directory'
);

console.log('TRANSLATION_BRIDGE_PACKAGING_CONTRACT_OK');
