'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const workflowsDir = path.join(root, '.github', 'workflows');
const workflowFiles = fs.readdirSync(workflowsDir)
  .filter((name) => /\.ya?ml$/i.test(name))
  .sort();

assert.ok(workflowFiles.length > 0, 'repository must keep automated workflows');

for (const file of workflowFiles) {
  const workflow = fs.readFileSync(path.join(workflowsDir, file), 'utf8').replace(/\r\n?/g, '\n');

  assert.doesNotMatch(workflow, /\bself-hosted\b/i, `${file} must not depend on a self-hosted runner`);
  assert.doesNotMatch(workflow, /\bgeek-linux\b/i, `${file} must not depend on the retired Linux runner label`);
  assert.doesNotMatch(workflow, /\bgeek-real-client\b/i, `${file} must not depend on the retired Windows runner label`);

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
