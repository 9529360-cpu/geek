'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = fs
  .readFileSync(path.join(__dirname, '../.github/workflows/tauri-windows.yml'), 'utf8')
  .replace(/\r\n?/g, '\n');

function block(key) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${key}:`);
  assert.notEqual(start, -1, `missing ${key} block`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

for (const key of ['push', 'pull_request']) {
  const section = block(key);
  assert.match(section, /master/, `${key} must include master`);
  assert.doesNotMatch(section, /^    paths(?:-ignore)?:/m, `${key} must not hide the Tauri gate behind a path filter`);
}

assert.match(workflow, /^  windows:\n/m, 'the Tauri job must remain named windows');
assert.match(workflow, /runs-on:\s*windows-latest/, 'the Tauri gate must run on Windows');
assert.match(workflow, /node desktop-tauri\/scripts\/run-tests\.cjs/, 'frontend tests must run');
assert.match(workflow, /cargo \+stable fmt --manifest-path desktop-tauri\/src-tauri\/Cargo\.toml -- --check/, 'fmt check must run');
assert.match(workflow, /cargo \+stable test --locked --manifest-path desktop-tauri\/src-tauri\/Cargo\.toml/, 'locked cargo test must run');
assert.match(
  workflow,
  /cargo \+stable clippy --manifest-path desktop-tauri\/src-tauri\/Cargo\.toml --all-targets --locked -- -D warnings/,
  'clippy must deny warnings'
);
assert.match(
  workflow,
  /cargo \+stable build --release --locked --manifest-path desktop-tauri\/src-tauri\/Cargo\.toml/,
  'Windows release build must run and must not publish'
);
assert.doesNotMatch(workflow, /release-client-version/, 'the Tauri build gate must not publish a client release');
assert.doesNotMatch(workflow, /workflow_dispatch:\s*\n\s*release-client/, 'the Tauri build gate must not dispatch release-client');

console.log('TAURI_WINDOWS_GATE_CONTRACT_OK');
