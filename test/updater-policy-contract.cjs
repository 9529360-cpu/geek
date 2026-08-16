'use strict';
const assert = require('node:assert/strict');
const { shouldCheckForUpdates } = require('../src/updater-policy.cjs');

assert.equal(
  shouldCheckForUpdates({ isPackaged: false, updateConfigPath: 'missing', fileExists: () => false }),
  false,
  '开发模式不能检查更新'
);
assert.equal(
  shouldCheckForUpdates({ isPackaged: true, updateConfigPath: 'missing', fileExists: () => false }),
  false,
  '没有 app-update.yml 时不能触发更新检查'
);
assert.equal(
  shouldCheckForUpdates({ isPackaged: true, updateConfigPath: 'present', fileExists: (p) => p === 'present' }),
  true,
  '打包且存在发布配置时才检查更新'
);
console.log('UPDATER_POLICY_CONTRACT_OK');
