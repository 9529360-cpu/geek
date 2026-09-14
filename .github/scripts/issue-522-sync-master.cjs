'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const run = (command, args, options = {}) => execFileSync(command, args, {
  cwd: root,
  stdio: 'inherit',
  encoding: 'utf8',
  ...options,
});
const output = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim();

run('git', ['config', 'user.name', 'github-actions[bot]']);
run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
run('git', ['fetch', 'origin', 'master']);
const masterSha = output('git', ['rev-parse', 'origin/master']);
console.log(`ISSUE_522_SYNC_MASTER ${masterSha}`);
run('git', ['merge', '--no-edit', 'origin/master']);
run('npm', ['ci', '--ignore-scripts']);
run(process.execPath, ['scripts/dependency-audit-policy.cjs']);
run('npm', ['test']);
run('git', ['diff', '--check', 'origin/master...HEAD']);

fs.rmSync(path.join(root, '.github', 'workflows', 'issue-522-sync-master.yml'), { force: true });
fs.rmSync(path.join(root, '.github', 'scripts', 'issue-522-sync-master.cjs'), { force: true });
run('git', ['add', '-A']);
run('git', ['commit', '-m', 'chore: sync issue 522 with latest master']);
run('git', ['push', 'origin', 'HEAD:fix/522-wa-js-4-6-migration']);
