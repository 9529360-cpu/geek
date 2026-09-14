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
assert.match(ignore, /^\.env\*$/m, '必须忽略本地 .env 文件');
assert.match(ignore, /^\.dev\.vars\*$/m, '必须忽略本地 .dev.vars 文件');
assert.match(ignore, /^!\.env\.example$/m, '必须允许提交脱敏 .env.example 模板');
assert.match(ignore, /^!\.dev\.vars\.example$/m, '必须允许提交脱敏 .dev.vars.example 模板');
assert.ok(
  ignore.indexOf('!.env.example') > ignore.indexOf('.env*'),
  '.env.example 例外必须位于 .env* 规则之后',
);
assert.ok(
  ignore.indexOf('!.dev.vars.example') > ignore.indexOf('.dev.vars*'),
  '.dev.vars.example 例外必须位于 .dev.vars* 规则之后',
);

console.log('REPO_RUNTIME_DATA_CONTRACT_OK');
