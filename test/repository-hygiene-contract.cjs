'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const forbidden = [
  'backup-20260814-official',
  'resources/waplus-ext',
  'ui/app.js.bad',
  'ui/index.html.bak',
  'gt_new.html',
  'gt_rebuild.py'
];

for (const relative of forbidden) {
  assert.equal(fs.existsSync(path.join(root, relative)), false, `${relative} 不得回到仓库`);
}

const rootArtifacts = fs.readdirSync(root).filter((name) =>
  /^(?:electron-log\d*|test\d*-log)\.txt$|^(?:screen\d*|final\d*-shot|test\d*-shot|ui\d*-shot)\.png$/.test(name)
);
assert.deepEqual(rootArtifacts, [], '仓库根目录不得包含调试日志或截图');

console.log('REPOSITORY_HYGIENE_CONTRACT_OK');
