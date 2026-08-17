'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const tracked = execFileSync('git', ['ls-files', '--', 'data/accounts.json', 'data/config.json'], {
  cwd: root,
  encoding: 'utf8',
}).trim();

assert.equal(tracked, '', '真实运行数据文件不得被 Git 跟踪');

for (const name of ['accounts.example.json', 'config.example.json']) {
  const file = path.join(root, 'data', name);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /"(?:lockPassword|password|hpwd|token)":"[^"]+"/, `${name} 不得包含非空敏感值`);
}

const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
assert.match(ignore, /^data\/accounts\.json$/m, '必须忽略 data/accounts.json');
assert.match(ignore, /^data\/config\.json$/m, '必须忽略 data/config.json');

console.log('REPO_RUNTIME_DATA_CONTRACT_OK');
