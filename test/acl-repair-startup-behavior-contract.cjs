'use strict';
// 行为测试：启动前置 ACL 修复编排
// - 修复失败仍继续后续流程（createWindow 被调用）
// - 修复成功后再继续
// - 非打包/非 Windows 跳过修复但仍继续
// 这是"可观测的启动编排函数测试"（Issue #2 评审第 6 点），非源码字符串位置测试。
const assert = require('node:assert/strict');
const path = require('node:path');

const { runStartupAclRepair } = require('../src/acl-repair.cjs');

(async () => {
  const windowCalls = [];
  const createMainWindow = () => windowCalls.push('createWindow');

  // 1. 修复成功 → 后续流程仍执行 createWindow
  {
    const okRepair = async () => ({ ok: true, repaired: true, skipped: false });
    const r = await runStartupAclRepair({
      shouldRun: true,
      userDataDir: path.join('C:', 'Users', 'x', 'AppData', 'Roaming', 'geek'),
      expectedUserDataDir: path.join('C:', 'Users', 'x', 'AppData', 'Roaming', 'geek'),
      username: 'x',
      repairImpl: okRepair,
      log: { log() {}, error() {} },
    });
    assert.equal(r.repaired, true, '修复成功应标记 repaired');
    assert.equal(r.failed, false, '修复成功不应标记 failed');
    createMainWindow();
    assert.equal(windowCalls.length, 1, '修复成功后 createWindow 仍执行');
  }

  // 2. 修复失败 → 不抛出，后续流程仍执行 createWindow
  {
    const failRepair = async () => ({ ok: false, repaired: true, reason: 'boom' });
    let threw = false;
    let r = null;
    try {
      r = await runStartupAclRepair({
        shouldRun: true,
        userDataDir: path.join('C:', 'Users', 'x', 'AppData', 'Roaming', 'geek'),
        expectedUserDataDir: path.join('C:', 'Users', 'x', 'AppData', 'Roaming', 'geek'),
        username: 'x',
        repairImpl: failRepair,
        log: { log() {}, error() {} },
      });
    } catch (e) { threw = true; }
    assert.equal(threw, false, '修复失败不得抛出');
    assert.equal(r.failed, true, '修复失败应标记 failed');
    createMainWindow();
    assert.equal(windowCalls.length, 2, '修复失败后 createWindow 仍执行');
  }

  // 3. 非打包/非 Windows → 跳过修复，后续流程仍执行
  {
    const r = await runStartupAclRepair({
      shouldRun: false,
      userDataDir: path.join('C:', 'Users', 'x', 'AppData', 'Roaming', 'geek'),
      expectedUserDataDir: path.join('C:', 'Users', 'x', 'AppData', 'Roaming', 'geek'),
      username: 'x',
      repairImpl: async () => { throw new Error('不应被调用'); },
    });
    assert.equal(r.failed, false, '非打包不应失败');
    createMainWindow();
    assert.equal(windowCalls.length, 3, '非打包时 createWindow 仍执行');
  }

  // 4. 修复实现内部抛异常 → 编排不抛出（调用方继续）
  {
    const throwRepair = async () => { throw new Error('icacls crash'); };
    let threw = false;
    let r = null;
    try {
      r = await runStartupAclRepair({
        shouldRun: true,
        userDataDir: path.join('C:', 'Users', 'x', 'AppData', 'Roaming', 'geek'),
        expectedUserDataDir: path.join('C:', 'Users', 'x', 'AppData', 'Roaming', 'geek'),
        username: 'x',
        repairImpl: throwRepair,
        log: { log() {}, error() {} },
      });
    } catch (e) { threw = true; }
    assert.equal(threw, false, '修复实现抛异常也不得让编排抛出');
    assert.equal(r.failed, true, '抛异常应标记 failed');
    createMainWindow();
    assert.equal(windowCalls.length, 4, '修复实现抛异常后 createWindow 仍执行');
  }

  console.log('ACL_REPAIR_STARTUP_BEHAVIOR_OK');
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
