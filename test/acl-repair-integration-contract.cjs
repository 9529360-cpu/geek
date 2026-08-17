'use strict';
// 集成测试：真实 icacls 修复损坏的 userData ACL（Windows only）
// 场景：模拟 v1.2.1 用 /inheritance:r 破坏后的目录 → 运行修复 → 验证可写、数据保留、幂等、
//       且 Partitions/Cookies/IndexedDB 哨兵的**显式 ACE** 前后一致（根目录修复不带 /T，
//       不递归改写整个树；继承恢复允许，显式 ACE 必须原样保留）。
// 仅在本机 Windows 下运行；使用临时目录，绝不触碰真实 userData。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  repairUserDataAcl,
  isWritable,
  readMarker,
  MARKER_FILE,
} = require('../src/acl-repair.cjs');

function freshDir(prefix) {
  const dir = path.join(os.tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true });
}

(async () => {
  if (process.platform !== 'win32') {
    console.log('ACL_REPAIR_INTEGRATION_SKIPPED (非 Windows)');
    return;
  }
  const username = process.env.USERNAME || require('node:os').userInfo().username;

  // 1. 构建模拟 userData：accounts.json（模拟账号数据）+ diagnostics/line-tokens.json（模拟凭据）
  //    + Partitions/Cookies/IndexedDB 哨兵（模拟 Chromium 会话数据，修复不得改写其显式 ACE）
  const ud = freshDir('geek-acl-it');
  const diagDir = path.join(ud, 'diagnostics');
  fs.mkdirSync(diagDir, { recursive: true });
  fs.writeFileSync(path.join(ud, 'accounts.json'), JSON.stringify({ accounts: [{ id: 'keep-me', type: 'whatsapp' }] }), 'utf8');
  fs.writeFileSync(path.join(ud, 'line-tokens.json'), '{"persist:x":"TOKEN"}', 'utf8');
  fs.writeFileSync(path.join(diagDir, 'line-tokens.json'), '{"persist:diag":"TOKEN"}', 'utf8');
  // 哨兵：Partitions 目录、Cookies 文件、IndexedDB 目录
  const partitionsDir = path.join(ud, 'Partitions');
  const cookiesFile = path.join(ud, 'Cookies');
  const indexedDbDir = path.join(ud, 'IndexedDB');
  fs.mkdirSync(partitionsDir, { recursive: true });
  fs.mkdirSync(indexedDbDir, { recursive: true });
  fs.writeFileSync(cookiesFile, 'cookies-sentinel', 'utf8');
  // 给哨兵设置显式 ACE（模拟 Chromium/用户数据已有的非继承权限），修复不得删除它们
  run('icacls', [partitionsDir, '/grant:r', 'BUILTIN\\Users:(RX)']);
  run('icacls', [indexedDbDir, '/grant:r', 'BUILTIN\\Users:(RX)']);
  run('icacls', [cookiesFile, '/grant:r', 'BUILTIN\\Users:(RX)']);
  // 提取显式（非继承）ACE 行：icacls 输出中无 (I) 标记的行才是显式 ACE
  const snapshotExplicitAcl = (p) => {
    try {
      return run('icacls', [p])
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.includes('(I)') && !l.startsWith('已成功') && !l.startsWith('Successfully'))
        .join('\n');
    } catch { return null; }
  };

  // 2. 模拟 v1.2.1 的破坏：对父目录 /inheritance:r（实测会清空子目录 ACL）
  run('icacls', [ud, '/inheritance:r', '/grant:r', `${username}:F`]);
  // 验证子目录确实损坏（不可写）
  const brokenBefore = await isWritable(diagDir);
  assert.equal(brokenBefore, false, '前置条件：/inheritance:r 后 diagnostics 应不可写（模拟老用户损坏现场）');

  // 2b. 破坏后、修复前快照哨兵**显式 ACE**（非继承部分）—— 修复不得改写它们
  const beforeAcl = {
    partitions: snapshotExplicitAcl(partitionsDir),
    cookies: snapshotExplicitAcl(cookiesFile),
    indexedDb: snapshotExplicitAcl(indexedDbDir),
  };
  assert.ok(beforeAcl.partitions && beforeAcl.cookies && beforeAcl.indexedDb, '哨兵 ACL 快照必须可取');

  // 3. 运行修复（真实 icacls）
  const r1 = await repairUserDataAcl({ userDataDir: ud, expectedUserDataDir: ud, username });
  assert.equal(r1.ok, true, `修复必须成功: ${r1.reason || ''}`);
  assert.equal(r1.repaired, true, '首次必须执行修复');

  // 4. 验证 diagnostics 可写 + 标记存在
  assert.equal(await isWritable(diagDir), true, '修复后 diagnostics 必须可写');
  assert.ok(await readMarker(ud), '修复后必须写入版本化标记');

  // 5. 验证数据未被删除/覆盖
  const accounts = JSON.parse(fs.readFileSync(path.join(ud, 'accounts.json'), 'utf8'));
  assert.equal(accounts.accounts[0].id, 'keep-me', '账号数据不得被删除/覆盖');
  assert.equal(fs.readFileSync(path.join(ud, 'line-tokens.json'), 'utf8'), '{"persist:x":"TOKEN"}', '凭据文件不得被删除/覆盖');
  assert.equal(fs.readFileSync(path.join(diagDir, 'line-tokens.json'), 'utf8'), '{"persist:diag":"TOKEN"}', '子目录凭据不得被删除/覆盖');

  // 5b. 哨兵**显式 ACE** 必须未改变（Partitions/Cookies/IndexedDB 不得被根目录 /T 改写；
  //     继承部分允许随根目录继承恢复而变化，但显式 ACE 必须原样保留）
  const afterAcl = {
    partitions: snapshotExplicitAcl(partitionsDir),
    cookies: snapshotExplicitAcl(cookiesFile),
    indexedDb: snapshotExplicitAcl(indexedDbDir),
  };
  assert.equal(afterAcl.partitions, beforeAcl.partitions, 'Partitions 显式 ACE 不得被改写');
  assert.equal(afterAcl.cookies, beforeAcl.cookies, 'Cookies 显式 ACE 不得被改写');
  assert.equal(afterAcl.indexedDb, beforeAcl.indexedDb, 'IndexedDB 显式 ACE 不得被改写');

  // 6. 幂等：跑第二次 → 跳过，不报错
  const r2 = await repairUserDataAcl({ userDataDir: ud, expectedUserDataDir: ud, username });
  assert.equal(r2.ok, true, '第二次修复不得报错');
  assert.equal(r2.skipped, true, '已修复且可写时第二次必须跳过');
  assert.equal(await isWritable(diagDir), true, '第二次后仍可写');

  // 7. 再次验证标记文件版本
  const marker = JSON.parse(fs.readFileSync(path.join(ud, MARKER_FILE), 'utf8'));
  assert.equal(marker.ok, true, '标记 ok=true');

  // 8. 可信基准不一致时必须拒绝（绝不误修）
  const rMismatch = await repairUserDataAcl({ userDataDir: ud, expectedUserDataDir: path.join(os.tmpdir(), 'other-geek'), username });
  assert.equal(rMismatch.ok, false, '与可信基准不一致必须拒绝');
  assert.equal(await isWritable(diagDir), true, '拒绝后原目录仍可写');

  console.log('ACL_REPAIR_INTEGRATION_OK');
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
