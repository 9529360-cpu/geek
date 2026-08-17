'use strict';
// Windows ACL 修复迁移（一次性、幂等、路径安全）
//
// 背景：v1.2.1 的 hardenUserDataDir() 曾用 `icacls <userData> /inheritance:r` 收紧权限，
// 实测该命令会把已存在的子目录 ACL 清空（Access count=0，连 Owner 都写不了），
// 导致老用户升级后 diagnostics 等子目录不可写 → 应用启动写日志 EPERM → whenReady 中断 → 主窗口消失。
// v1.2.3 已让 diagnostics 写日志容错并停止使用 /inheritance:r，但**已经损坏的目录**需要本模块主动修复。
//
// 设计（吸收 Issue #2 评审意见）：
//   - 仅在 app.isPackaged && process.platform === 'win32' 时由 main.cjs 调用。
//   - 路径安全：目标必须精确等于调用方传入的 expectedUserDataDir（独立可信基准，
//     来自 Electron app.getPath('userData')），禁止自证；并拒绝磁盘根/用户目录/AppData 根。
//   - 修复范围：只修复 userDataDir 本身 + REQUIRED_SUBDIRS（应用必要运行数据子目录）。
//     不对整个 userData 全树 /T 递归，避免改写 Cookies/IndexedDB/Partitions 等文件 ACL。
//   - 修复动作（每目录单独执行，子目录内 /T 递归以保证既有文件也恢复可写）：
//       icacls <target> /inheritance:e /grant:r <user>:(OI)(CI)F /T /C
//     —— 恢复继承 + 当前用户文件夹/子文件夹/文件可继承的完全控制，只改权限不删数据。
//   - 版本化标记：修复成功后写 .acl-repair-v1.json；但每次启动仍探测 diagnostics 可写性，
//     若不可写则强制重跑（不依赖标记跳过）。
//   - 失败绝不抛出：返回 { ok:false }，由调用方忽略。
//
// 纯 Node 实现（不依赖 Electron），便于单元/契约测试。

const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { execFile } = require('node:child_process');

const MARKER_VERSION = 1;
const MARKER_FILE = '.acl-repair-v1.json';

// 应用必要的运行数据子目录（相对于 userDataDir）
const REQUIRED_SUBDIRS = ['diagnostics'];

// 目标路径是否位于 userDataDir 内部（自身也算合法）
function isInsideUserDataDir(target, userDataDir) {
  const base = path.resolve(userDataDir);
  const rel = path.relative(base, path.resolve(target));
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

// 路径防呆：拒绝磁盘根、用户主目录、AppData 根等宽泛目录
function isRejectedWideDir(resolved) {
  if (/^[a-zA-Z]:\\$/.test(resolved)) return true;
  if (/(^|[\\/])Users$/.test(resolved)) return true;
  if (/(^|[\\/])AppData([\\/]Roaming)?$/.test(resolved)) return true;
  // 用户主目录（Users\<name> 且后面没有 AppData）
  if (/(^|[\\/])Users[\\/][^\\/]+$/.test(resolved) && !/(^|[\\/])AppData[\\/]/.test(resolved)) return true;
  return false;
}

// 组装 icacls 参数数组（execFile 参数形式，不含命令名；路径含空格/中文/特殊字符安全，绝不拼 shell）
function buildIcaclsArgs(target, username) {
  return [target, '/inheritance:e', '/grant:r', `${username}:(OI)(CI)F`, '/T', '/C'];
}

function markerPath(userDataDir) {
  return path.join(userDataDir, MARKER_FILE);
}

// 读取版本化标记；不存在或版本不匹配返回 null
async function readMarker(userDataDir) {
  try {
    const raw = await fs.readFile(markerPath(userDataDir), 'utf8');
    const parsed = JSON.parse(raw || '{}');
    if (parsed && parsed.version === MARKER_VERSION && parsed.ok === true) return parsed;
    return null;
  } catch {
    return null;
  }
}

// 写成功标记（原子写：临时文件 + rename，防并发实例写坏）
async function writeMarker(userDataDir) {
  const payload = JSON.stringify(
    { version: MARKER_VERSION, ok: true, repairedAt: new Date().toISOString(), subdirs: REQUIRED_SUBDIRS },
    null,
    2
  );
  const tmp = markerPath(userDataDir) + `.tmp-${process.pid}`;
  await fs.writeFile(tmp, payload, 'utf8');
  await fs.rename(tmp, markerPath(userDataDir));
}

// 探测目录可写性（写临时文件再删除）；目录不存在视为不可写
async function isWritable(dir) {
  const probe = path.join(dir, `.acl-probe-${process.pid}-${Date.now()}.tmp`);
  try {
    await fs.writeFile(probe, 'x', 'utf8');
    await fs.unlink(probe).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

// 对单个目录执行 icacls 修复
function runIcacls(target, username, execFileImpl) {
  return new Promise((resolve) => {
    const args = buildIcaclsArgs(target, username);
    execFileImpl('icacls', args, { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: String(stdout || ''),
        stderr: String(err ? err.message : (stderr || '')),
      });
    });
  });
}

// 修复迁移入口。
// 参数：
//   userDataDir        —— 目标 userData 目录（精确）
//   expectedUserDataDir—— 独立可信基准（Electron app.getPath('userData')），
//                          userDataDir 必须 resolve 后与之完全一致，否则拒绝（防自证/防越界）
//   username           —— 当前 Windows 用户名；空值安全失败（不执行）
//   execFileImpl       —— 可注入（测试用），默认 child_process.execFile
//   probe              —— 可注入的可写探测（测试用）
// 返回 { ok, repaired|skipped, reason? }；绝不抛出。
async function repairUserDataAcl({ userDataDir, expectedUserDataDir, username, execFileImpl = execFile, probe = null }) {
  try {
    const resolved = path.resolve(userDataDir);

    // 1) 用户名安全：空值/非字符串必须安全失败，绝不构造 `:(OI)(CI)F`
    const user = String(username || '').trim();
    if (!user) {
      return { ok: false, repaired: false, reason: 'username 为空，无法执行 ACL 修复' };
    }

    // 2) 独立可信基准校验：目标必须精确等于调用方（Electron）给出的 userData 路径
    if (!expectedUserDataDir) {
      return { ok: false, repaired: false, reason: '缺少独立可信基准 expectedUserDataDir' };
    }
    const expected = path.resolve(expectedUserDataDir);
    if (resolved !== expected) {
      return { ok: false, repaired: false, reason: `userDataDir 与可信基准不一致: ${resolved} != ${expected}` };
    }

    // 3) 额外防呆：拒绝磁盘根/用户目录/AppData 根
    if (isRejectedWideDir(resolved)) {
      return { ok: false, repaired: false, reason: `ACL 修复拒绝宽泛目录: ${resolved}` };
    }

    // 4) 修复目标列表：userDataDir 本身 + 必要子目录（只改应用私有目标，不做全树 /T）
    const targets = [resolved, ...REQUIRED_SUBDIRS.map((sub) => path.join(resolved, sub))];

    // 可写探测函数（可注入用于测试）
    const probeWritable = probe || (async (dir) => isWritable(dir));
    const diagnosticsDir = path.join(resolved, 'diagnostics');

    // 5) 幂等短路：标记有效 + diagnostics 可写 → 跳过
    const marker = await readMarker(resolved);
    if (marker && (await probeWritable(diagnosticsDir))) {
      return { ok: true, skipped: true };
    }

    // 6) 逐目标执行 icacls（不因 mkdir 失败阻断：mkdir 只用于补建缺失目录，单独容错）
    for (const target of targets) {
      try {
        await fs.mkdir(target, { recursive: true }); // 已存在目录不会重建/删除；失败仅跳过该目标
      } catch (e) {
        // 目录可能因 ACL 无法访问——先尝试修复它，再补建
      }
      const result = await runIcacls(target, user, execFileImpl);
      if (!result.ok) {
        return { ok: false, repaired: true, reason: `icacls 失败(${target}): ${result.stderr || result.stdout}` };
      }
    }

    // 7) 修复后验证 diagnostics 可写
    const writableAfter = await probeWritable(diagnosticsDir);
    if (!writableAfter) {
      return { ok: false, repaired: true, reason: '修复后 diagnostics 仍不可写' };
    }

    // 8) 成功：写版本化标记（失败不视为修复失败，下次启动仍探测重跑）
    try {
      await writeMarker(resolved);
    } catch (e) {
      return { ok: true, repaired: true, reason: `标记写入失败: ${e.message}` };
    }
    return { ok: true, repaired: true };
  } catch (e) {
    return { ok: false, repaired: false, reason: String(e && e.message ? e.message : e) };
  }
}

// 从可靠身份来源获取用户名：优先显式传入，其次 os.userInfo()
function resolveUsername(explicit) {
  const trimmed = String(explicit || '').trim();
  if (trimmed) return trimmed;
  try {
    return String(os.userInfo().username || '').trim();
  } catch {
    return '';
  }
}

// 启动前置修复编排（可观测、可测试）：Windows 正式版启动时先修复 ACL。
// 设计：修复失败绝不影响启动——本函数从不抛出，返回结构化结果；
// 调用方（whenReady）随后继续执行日志/加载/创建窗口，因此"修复失败仍 createWindow"由流程顺序天然保证，
// 测试通过真实调用本函数 + 断言随后 createWindow 仍执行来验证。
// 参数：
//   shouldRun    —— 是否执行（打包+win32 才 true）
//   userDataDir  —— 目标 userData（精确）
//   expectedUserDataDir —— 独立可信基准
//   username     —— 当前用户名（可为空，内部 resolveUsername）
//   repairImpl   —— 可注入的修复实现（默认 repairUserDataAcl，测试可注入失败/成功）
//   log          —— 可注入日志（默认 console）
// 返回 { repaired, skipped, failed, reason }
async function runStartupAclRepair({
  shouldRun,
  userDataDir,
  expectedUserDataDir,
  username,
  repairImpl = repairUserDataAcl,
  log = console,
}) {
  if (!shouldRun) {
    // 非打包/非 Windows：不修复
    return { repaired: false, skipped: false, failed: false };
  }
  const result = await repairImpl({
    userDataDir,
    expectedUserDataDir,
    username: resolveUsername(username),
  }).catch((e) => ({ ok: false, repaired: false, reason: String(e && e.message ? e.message : e) }));
  if (result.ok) {
    if (result.repaired) log.log('[security] userData ACL 已修复（继承恢复 + 当前用户完全控制）');
    return { repaired: !!result.repaired, skipped: !!result.skipped, failed: false, reason: result.reason };
  }
  // 修复失败：记录但不影响启动（不抛出）
  log.error('[security] userData ACL 修复未完成（不影响启动）:', result.reason || 'unknown');
  return { repaired: false, skipped: false, failed: true, reason: result.reason };
}

module.exports = {
  MARKER_VERSION,
  MARKER_FILE,
  REQUIRED_SUBDIRS,
  isInsideUserDataDir,
  isRejectedWideDir,
  buildIcaclsArgs,
  readMarker,
  writeMarker,
  isWritable,
  resolveUsername,
  repairUserDataAcl,
  runStartupAclRepair,
};
