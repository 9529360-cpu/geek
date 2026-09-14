'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const workflowsDir = path.join(root, '.github', 'workflows');
const workflowFiles = fs.readdirSync(workflowsDir)
  .filter((name) => /\.ya?ml$/i.test(name))
  .sort();
const node24ActionNames = new Set([
  'actions/checkout',
  'actions/setup-node',
  'actions/upload-artifact',
]);

assert.ok(workflowFiles.length > 0, 'repository must keep automated workflows');

for (const file of workflowFiles) {
  const workflow = fs.readFileSync(path.join(workflowsDir, file), 'utf8').replace(/\r\n?/g, '\n');

  assert.doesNotMatch(workflow, /\bself-hosted\b/i, `${file} must not depend on a self-hosted runner`);
  assert.doesNotMatch(workflow, /\bgeek-linux\b/i, `${file} must not depend on the retired Linux runner label`);
  assert.doesNotMatch(workflow, /\bgeek-real-client\b/i, `${file} must not depend on the retired Windows runner label`);
  assert.doesNotMatch(
    workflow,
    /\bACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION\b/,
    `${file} must not opt back into an unsupported GitHub Actions Node runtime`,
  );

  for (const [, action, ref] of workflow.matchAll(/^\s*uses:\s*(actions\/[^@\s]+)@([^\s#]+)\s*$/gm)) {
    if (!node24ActionNames.has(action)) continue;
    const version = /^v(\d+)(?:\.\d+){0,2}$/.exec(ref);
    assert.ok(version, `${file} must use a versioned Node 24-compatible ref for ${action}, got ${ref}`);
    assert.ok(
      Number(version[1]) >= 7,
      `${file} must use ${action}@v7 or newer for the Node 24 Actions runtime, got ${action}@${ref}`,
    );
  }

  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*uses:\s*actions\/setup-node@/.test(lines[index])) continue;
    const step = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/^\s*-\s+name:/.test(lines[cursor])) break;
      step.push(lines[cursor]);
    }
    assert.match(
      step.join('\n'),
      /^\s+(?:cache:\s*\S+|package-manager-cache:\s*false)\s*$/m,
      `${file} setup-node must preserve an explicit cache policy instead of inheriting the action default`,
    );
  }

  const runnerLines = [...workflow.matchAll(/^\s*runs-on:\s*(.+?)\s*$/gm)];
  assert.ok(runnerLines.length > 0, `${file} must declare at least one runner`);
  for (const [, runner] of runnerLines) {
    assert.match(
      runner,
      /^(?:ubuntu|windows|macos)-latest$/,
      `${file} must use a GitHub-hosted latest runner, got ${runner}`,
    );
  }
}

console.log(`CI_HOSTED_RUNNERS_CONTRACT_OK workflows=${workflowFiles.length}`);
