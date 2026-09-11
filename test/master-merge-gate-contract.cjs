'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readText = (relativePath) => fs
  .readFileSync(path.join(root, relativePath), 'utf8')
  .replace(/\r\n?/g, '\n');
const testWorkflow = readText('.github/workflows/test.yml');
const electronWorkflow = readText('.github/workflows/electron-e2e.yml');
const productionBuilder = readText('electron-builder.yml');
const validationBuilder = readText('electron-builder.validation.yml');

function yamlTwoSpaceBlock(source, key) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${key}:`);
  assert.notEqual(start, -1, `missing ${key} block`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function yamlJobBlock(source, jobId) {
  const jobsIndex = source.indexOf('\njobs:\n');
  assert.notEqual(jobsIndex, -1, 'workflow must define jobs');
  return yamlTwoSpaceBlock(source.slice(jobsIndex + 1), jobId);
}

const testPr = yamlTwoSpaceBlock(testWorkflow, 'pull_request');
assert.match(testPr, /^  pull_request:/m, 'test workflow must run on pull requests');
assert.doesNotMatch(testPr, /^    paths(?:-ignore)?:/m, 'test required check must not disappear because of pull-request path filters');
assert.match(testWorkflow, /^  test:\n/m, 'the independent required test job must remain named test');

const electronPr = yamlTwoSpaceBlock(electronWorkflow, 'pull_request');
assert.match(electronPr, /^  pull_request:/m, 'Electron E2E workflow must run on every pull request');
assert.doesNotMatch(electronPr, /^    paths(?:-ignore)?:/m, 'required Electron E2E workflow must never be hidden by pull-request path filters');

const gate = yamlJobBlock(electronWorkflow, 'gate');
assert.match(gate, /^    name:\s*electron-e2e\s*$/m, 'final required check name must remain electron-e2e');
assert.match(gate, /^    if:\s*always\(\)\s*$/m, 'final Electron gate must run even when a dependency fails or is skipped');
assert.match(gate, /^    needs:\s*\[\s*whitespace\s*,\s*smoke\s*,\s*whatsapp-windows\s*\]\s*$/m, 'final Electron gate must depend on whitespace, Linux smoke, and Windows WhatsApp');
assert.match(gate, /needs\.whitespace\.result/, 'final gate must inspect the real whitespace result');
assert.match(gate, /needs\.smoke\.result/, 'final gate must inspect the real smoke result');
assert.match(gate, /needs\.whatsapp-windows\.result/, 'final gate must inspect the real Windows WhatsApp result');
assert.match(gate, /WHITESPACE_RESULT[^\n]*\n[\s\S]*?SMOKE_RESULT[^\n]*\n[\s\S]*?WINDOWS_WHATSAPP_RESULT/, 'final gate must expose all dependency results to its decision step');
assert.match(gate, /WHITESPACE_RESULT[^\n]*!=\s*["']success["']/, 'whitespace must be exactly successful');
assert.match(gate, /SMOKE_RESULT[^\n]*!=\s*["']success["']/, 'smoke must be exactly successful');
assert.match(gate, /WINDOWS_WHATSAPP_RESULT[^\n]*!=\s*["']success["']/, 'Windows WhatsApp must be exactly successful');
assert.match(gate, /exit\s+1/, 'non-success dependency results must fail the final gate');

assert.doesNotMatch(electronWorkflow, /continue-on-error:\s*true/i, 'Electron merge-gate failures must not be made non-blocking');
assert.doesNotMatch(electronWorkflow, /\|\|\s*true\b/, 'Electron failures must not be swallowed with || true');
assert.doesNotMatch(electronWorkflow, /\bset\s+\+e\b/, 'Electron gate steps must not disable shell fail-fast semantics');
assert.doesNotMatch(electronWorkflow, /\bexit\s+0\b/, 'Electron merge gate must not contain unconditional success exits');
assert.doesNotMatch(electronWorkflow, /--no-sandbox\b/, 'Electron E2E must preserve Chromium sandboxing');

for (const [name, config] of [
  ['production', productionBuilder],
  ['validation', validationBuilder],
]) {
  assert.match(config, /electronFuses:\s*[\s\S]*?runAsNode:\s*false/, `${name} Electron Fuse must keep RunAsNode disabled`);
  assert.match(config, /electronFuses:\s*[\s\S]*?enableNodeOptionsEnvironmentVariable:\s*false/, `${name} Electron Fuse must keep NODE_OPTIONS disabled`);
  assert.match(config, /electronFuses:\s*[\s\S]*?enableNodeCliInspectArguments:\s*false/, `${name} Electron Fuse must keep Node inspector CLI arguments disabled`);
  assert.match(config, /electronFuses:\s*[\s\S]*?enableEmbeddedAsarIntegrityValidation:\s*true/, `${name} Electron Fuse must keep ASAR integrity validation enabled`);
  assert.match(config, /electronFuses:\s*[\s\S]*?onlyLoadAppFromAsar:\s*true/, `${name} Electron Fuse must keep app loading restricted to ASAR`);
}

console.log('MASTER_MERGE_GATE_CONTRACT_OK');
