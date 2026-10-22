import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { MAX_LINES, lineCount, checkFile } = require('../scripts/architecture-policy.cjs');
const { collect, inspect, checkCommands, checkFrontendGraph } = require('../scripts/check-architecture.cjs');
const root = fileURLToPath(new URL('..', import.meta.url));

// Mutation tests prove that the gate actually rejects regressions, not just that
// today's sources happen to match their own snapshots.
test('3000 physical lines is a hard per-file ceiling including comments/blanks', () => {
  assert.equal(MAX_LINES, 3000);
  assert.equal(lineCount('a\n'), 1);
  assert.equal(lineCount('a\r\n\r\n'), 2);
  assert.equal(lineCount('a\nb'), 2);
  assert.equal(lineCount(''), 0);
  assert.deepEqual(checkFile('frontend/size.mjs', '// x\n'.repeat(3000)), []);
  assert.match(checkFile('frontend/size.mjs', '\n'.repeat(3001)).join('\n'), /exceeds 3000/);
  assert.match(checkFile('src-tauri/src/domain/size.rs', '// x\n'.repeat(3001)).join('\n'), /exceeds 3000/);
});

test('packing code onto long lines cannot hide growth', () => {
  assert.match(checkFile('frontend/packed.mjs', `${'x;'.repeat(100)}\n`).join('\n'), /packed\/long/);
});

test('core layers cannot import native/storage implementations or introduce unsafe', () => {
  for (const source of [
    'use tauri::AppHandle;\n',
    'use crate::infrastructure::repository::EncryptedRepository;\n',
    'use crate::{desktop as ui};\n',
    'use std::{fs as files};\n',
  ]) {
    assert.ok(checkFile('src-tauri/src/domain/bad.rs', source).length, source);
    assert.ok(checkFile('src-tauri/src/application/bad.rs', source).length, source);
  }
  assert.ok(checkFile('src-tauri/src/domain/bad.rs', 'unsafe fn bad() {}\n').length);
  assert.deepEqual(checkFile('src-tauri/src/domain/good.rs', 'use serde::Serialize;\n'), []);
});

test('unowned Rust files and source inclusion escapes are rejected', () => {
  assert.ok(checkFile('src-tauri/src/misc.rs', 'fn example() {}\n').length);
  assert.ok(checkFile('src-tauri/src/domain/a.rs', 'include!("../../hidden.rs");\n').length);
});

test('UI cannot bypass the bridge owner', () => {
  assert.ok(checkFile('frontend/view.mjs', "invoke('account_close');\n").length);
  assert.ok(checkFile('frontend/view.mjs', 'window.__TAURI__.core;\n').length);
  assert.ok(checkFile('frontend/view.mjs', "node.innerHTML = value;\n").length);
  assert.deepEqual(checkFile('frontend/view.mjs', 'node.textContent = value;\n'), []);
});

test('frontend cycles and escapes fail before runtime', () => {
  const cycle = new Map([
    ['frontend/a.mjs', "import { b } from './b.mjs';\n"],
    ['frontend/b.mjs', "import { a } from './a.mjs';\n"],
  ]);
  assert.match(checkFrontendGraph(cycle).join('\n'), /cycle/);
  assert.match(checkFrontendGraph(new Map([
    ['frontend/a.mjs', "import x from '../src/main.cjs';\n"],
  ])).join('\n'), /escapes/);
});

test('IPC drift and an unauthorized command fail the manifest check', () => {
  const source = collect(root);
  assert.deepEqual(checkCommands(source), []);
  const missing = new Map(source);
  const key = 'src-tauri/permissions/shell.toml';
  missing.set(key, missing.get(key).replace('"account_close"', '"not_registered"'));
  assert.match(checkCommands(missing).join('\n'), /Tauri permission/);
  const bypass = new Map(source);
  const commands = 'src-tauri/src/desktop/commands.rs';
  bypass.set(commands, bypass.get(commands).replace('execute(webview, state,', 'bypass(webview, state,'));
  assert.match(checkCommands(bypass).join('\n'), /authorization/);
});

test('the checked-in architecture passes without blanket exclusions', () => {
  const report = inspect(root);
  assert.deepEqual(report.failures, []);
  assert.ok(report.sizes.length > 20);
  assert.ok(report.sizes.every((file) => file.lines <= 3000));
});
