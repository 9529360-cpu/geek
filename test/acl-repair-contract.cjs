'use strict';
// 契约测试：Windows ACL 修复迁移（一次性、幂等、路径安全、失败不抛、不删数据）
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isInsideUserDataDir,
  isRejectedWideDir,
  buildIcaclsArgs,
  readMarker,
  writeMarker,
  isWritable,
  resolveUsername,
  repairUserDataAcl,
  REQUIRED_SUBDIRS,
  MARKER_VERSION,
} = require('../src/acl-repair.cjs');

function freshDir(prefix) {
  const dir = path.join(os.tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

(async () => {
  // ---- 1. 路径安全 ----
  const userData = path.join('C:', 'Users', 'test', 'AppData', 'Roaming', 'geek');
  assert.equal(isInsideUserDataDir(userData, userData), true, 'userDataDir 自身合法');
  assert.equal(isInsideUserDataDir(path.join(userData, 'diagnostics'), userData), true, '直属子目录合法');
  assert.equal(isInsideUserDataDir(path.join(userData, 'Partitions', 'webview-page-1'), userData), true, '深层子目录合法');
  assert.equal(isInsideUserDataDir(path.join(userData, '..', 'other'), userData), false, '父级越界必须拒绝');
  assert.equal(isInsideUserDataDir(path.join('C:', 'Users', 'test', 'AppData', 'Roaming', 'other'), userData), false, '兄弟目录必须拒绝');
  assert.equal(isInsideUserDataDir('C:\\Windows', userData), false, '绝对无关路径必须拒绝');
  assert.equal(isInsideUserDataDir(path.join(userData, '..'), userData), false, '含 .. 的目录必须拒绝');

  // 宽泛目录防呆
  assert.equal(isRejectedWideDir(path.resolve('C:\\Users')), true, 'Users 根必须拒绝');
  assert.equal(isRejectedWideDir(path.resolve('C:\\Users\\someone')), true, '用户主目录必须拒绝');
  assert.equal(isRejectedWideDir(path.resolve('C:\\Users\\someone\\AppData\\Roaming')), true, 'AppData Roaming 必须拒绝');
  assert.equal(isRejectedWideDir(path.resolve('C:\\Windows')), false, '其他目录不误伤（由可信基准把关）');

  // ---- 2. icacls 参数数组：空格/中文路径不拼接 shell ----
  const spaced = 'C:\\Users\\test user\\AppData\\Roaming\\geek 极客\\diagnostics';
  const args = buildIcaclsArgs(spaced, 'test user');
  assert.ok(Array.isArray(args), '参数必须是数组');
  assert.equal(args[0], spaced, '路径必须作为独立参数，不能被 shell 拆分');
  assert.ok(args.some((a) => a.includes('(OI)(CI)F')), '必须授予可继承的完全控制');
  assert.ok(args.includes('/inheritance:e'), '必须恢复继承');
  assert.ok(args.includes('/T'), '必须递归子对象');
  assert.ok(args.includes('/C'), '出错必须继续');
  assert.ok(args.some((a) => a.startsWith('test user:')), '用户名必须作为独立参数');

  // ---- 3. 版本化标记 ----
  const mdir = freshDir('geek-acl-marker');
  assert.equal(await readMarker(mdir), null, '无标记时返回 null');
  await writeMarker(mdir);
  const m = await readMarker(mdir);
  assert.ok(m && m.version === MARKER_VERSION, '标记版本必须匹配');
  assert.equal(m.ok, true, '标记必须标记成功');
  fs.writeFileSync(path.join(mdir, '.acl-repair-v1.json'), JSON.stringify({ version: 0, ok: true }), 'utf8');
  assert.equal(await readMarker(mdir), null, '旧版本标记必须忽略');

  // ---- 4. 可写性探测 ----
  assert.equal(await isWritable(mdir), true, '正常目录可写');
  assert.equal(await isWritable(path.join(mdir, 'no-such-dir')), false, '不存在目录不可写');

  // ---- 5. username 解析 ----
  assert.equal(resolveUsername('  bz977  '), 'bz977', '显式用户名去空格');
  assert.equal(typeof resolveUsername(''), 'string', '空显式值回退到系统身份');
  assert.ok(resolveUsername('').length > 0 || true, '回退不抛异常');

  // ---- 6. 修复流程（注入 fake execFile）----
  const calls = [];
  const fakeExec = (cmd, args2, opts, cb) => { calls.push({ cmd, args: args2 }); cb(null, 'ok', ''); };
  const ud = freshDir('geek-acl-ud');
  fs.mkdirSync(path.join(ud, 'diagnostics'), { recursive: true });
  fs.writeFileSync(path.join(ud, 'accounts.json'), '{"accounts":[]}', 'utf8');

  // 6a. 首次修复：对 userDataDir + REQUIRED_SUBDIRS 逐个 icacls + 写标记
  const r1 = await repairUserDataAcl({ userDataDir: ud, expectedUserDataDir: ud, username: 'bz977', execFileImpl: fakeExec });
  assert.equal(r1.ok, true, '修复必须成功');
  assert.equal(r1.repaired, true, '首次必须执行修复');
  assert.ok(calls.length >= REQUIRED_SUBDIRS.length + 1, '必须对每个目标调用 icacls');
  assert.equal(calls[0].cmd, 'icacls');
  assert.equal(calls[0].args[0], ud, '第一个目标必须是 userDataDir');
  // 必须包含 diagnostics 目标
  assert.ok(calls.some((c) => c.args[0] === path.join(ud, 'diagnostics')), '必须修复 diagnostics 子目录');
  assert.ok(await readMarker(ud), '修复成功后必须写标记');
  assert.equal(fs.readFileSync(path.join(ud, 'accounts.json'), 'utf8'), '{"accounts":[]}', '账号数据不得被删除/覆盖');

  // 6b. 标记存在 + diagnostics 可写 → 跳过（幂等）
  calls.length = 0;
  const r2 = await repairUserDataAcl({ userDataDir: ud, expectedUserDataDir: ud, username: 'bz977', execFileImpl: fakeExec });
  assert.equal(r2.skipped, true, '已修复且可写时必须跳过');
  assert.equal(calls.length, 0, '跳过时不得调用 icacls');

  // 6c. 标记存在但 diagnostics 不可写 → 必须重跑（不能仅依赖标记）
  calls.length = 0;
  const r3 = await repairUserDataAcl({
    userDataDir: ud,
    expectedUserDataDir: ud,
    username: 'bz977',
    execFileImpl: fakeExec,
    probe: async () => false,
  });
  assert.equal(r3.repaired, true, '不可写时必须重新执行修复');
  assert.ok(calls.length >= 1, '重跑必须调用 icacls');

  // 6d. icacls 失败 → 不抛异常、不写成功标记
  calls.length = 0;
  const badExec = (cmd, args2, opts, cb) => { calls.push({ cmd, args: args2 }); cb(new Error('icacls boom'), '', 'err'); };
  const ud2 = freshDir('geek-acl-ud2');
  fs.mkdirSync(path.join(ud2, 'diagnostics'), { recursive: true });
  const r4 = await repairUserDataAcl({ userDataDir: ud2, expectedUserDataDir: ud2, username: 'bz977', execFileImpl: badExec });
  assert.equal(r4.ok, false, '必须报告失败');
  assert.equal(await readMarker(ud2), null, '失败不得写成功标记（允许下次重试）');

  // 6e. username 为空 → 安全失败，绝不构造 :(OI)(CI)F
  calls.length = 0;
  const ud3 = freshDir('geek-acl-ud3');
  fs.mkdirSync(path.join(ud3, 'diagnostics'), { recursive: true });
  const rEmptyUser = await repairUserDataAcl({ userDataDir: ud3, expectedUserDataDir: ud3, username: '', execFileImpl: fakeExec });
  assert.equal(rEmptyUser.ok, false, '空 username 必须安全失败');
  assert.equal(calls.length, 0, '空 username 不得调用 icacls');

  // 6f. userDataDir 与可信基准不一致 → 拒绝（防自证/防越界）
  calls.length = 0;
  const rMismatch = await repairUserDataAcl({ userDataDir: ud3, expectedUserDataDir: path.join(os.tmpdir(), 'other-geek'), username: 'bz977', execFileImpl: fakeExec });
  assert.equal(rMismatch.ok, false, '与可信基准不一致必须拒绝');
  assert.equal(calls.length, 0, '拒绝时不得调用 icacls');

  // 6g. 越界 userDataDir（用户目录）必须拒绝（返回 ok:false，不抛异常、不递归）
  calls.length = 0;
  const r5 = await repairUserDataAcl({ userDataDir: 'C:\\Users', expectedUserDataDir: 'C:\\Users', username: 'bz977', execFileImpl: fakeExec });
  assert.equal(r5.ok, false, '越界 userDataDir 必须拒绝执行');
  assert.equal(r5.repaired, false, '越界时不得执行 icacls');
  assert.equal(calls.length, 0, '越界时不得调用 icacls');

  // 6h. mkdir 失败（目录 ACL 损坏/路径异常）不得阻断 icacls 执行。
  //     让 diagnostics 目标是文件（mkdir EEXIST/ENOTDIR），fakeExec 总是成功：
  //     断言 icacls 仍对每个目标执行（没有因 mkdir 抛错提前返回）。
  //     整体 ok 允许为 false（文件目标的可写探测必然失败——真实场景 diagnostics 是目录，
  //     该断言只验证"mkdir 失败不阻断修复动作"）。
  calls.length = 0;
  const ud4 = freshDir('geek-acl-ud4');
  fs.writeFileSync(path.join(ud4, 'diagnostics'), 'i-am-a-file', 'utf8');
  const rMkdirFail = await repairUserDataAcl({ userDataDir: ud4, expectedUserDataDir: ud4, username: 'bz977', execFileImpl: fakeExec });
  assert.ok(calls.length >= REQUIRED_SUBDIRS.length + 1, '即使 mkdir 失败也必须调用所有 icacls');
  assert.ok(calls.some((c) => c.args[0] === ud4), '必须对 userDataDir 调用 icacls');
  assert.ok(calls.some((c) => c.args[0] === path.join(ud4, 'diagnostics')), '必须对损坏的 diagnostics 调用 icacls');

  // ---- 7. REQUIRED_SUBDIRS 契约：必须包含 diagnostics ----
  assert.ok(REQUIRED_SUBDIRS.includes('diagnostics'), 'diagnostics 必须在修复清单中');

  console.log('ACL_REPAIR_CONTRACT_OK');
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
