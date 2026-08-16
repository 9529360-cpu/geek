'use strict';
// 运行路径与首启迁移辅助函数（纯 Node，不依赖 Electron，便于单元/契约测试）。
// 固定 userData 目录：防止 package name 变化导致登录态数据目录漂移。
const path = require('node:path');
const fs = require('node:fs/promises');

const USER_DATA_SUBDIR = 'whatsapp-multi';

function userDataDirFor(appDataDir) {
  return path.join(appDataDir, USER_DATA_SUBDIR);
}

function resolveUserDataDir({ appDataDir, overrideDir }) {
  return overrideDir ? path.resolve(overrideDir) : userDataDirFor(appDataDir);
}

function accountsFile(userDataDir) {
  return path.join(userDataDir, 'accounts.json');
}

function configFile(userDataDir) {
  return path.join(userDataDir, 'config.json');
}

function legacyDataDir(projectRoot) {
  return path.join(projectRoot, 'data');
}

function legacyAccountsFile(projectRoot) {
  return path.join(legacyDataDir(projectRoot), 'accounts.json');
}

function legacyConfigFile(projectRoot) {
  return path.join(legacyDataDir(projectRoot), 'config.json');
}

// 打包模式下资源可能被 asarUnpack 到真实磁盘（扩展必须真实文件才能被
// session.loadExtension 读取），因此打包时解析到 app.asar.unpacked 下。
function resourcesDirFor({ packaged, resourcesPath, appDir }) {
  if (packaged) {
    return path.join(resourcesPath, 'app.asar.unpacked', 'resources');
  }
  return path.join(appDir, '..', 'resources');
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

// 首次运行安全迁移：accounts/config 从项目 data/ 迁到固定 userData 目录。
// 规则：目标已存在则以目标为准；仅在目标缺失且旧源存在时复制（源文件保留）；
// 只触碰这两个 JSON，绝不覆盖登录分区目录或 line-tokens 等凭据文件。
async function migrateRuntimeFiles({ userDataDir, projectRoot }) {
  await fs.mkdir(userDataDir, { recursive: true });
  const pairs = [
    { dest: accountsFile(userDataDir), legacy: legacyAccountsFile(projectRoot) },
    { dest: configFile(userDataDir), legacy: legacyConfigFile(projectRoot) }
  ];
  const results = [];
  for (const { dest, legacy } of pairs) {
    const destExists = await fileExists(dest);
    const legacyExists = await fileExists(legacy);
    if (destExists) {
      results.push({ file: dest, action: 'kept' });
    } else if (legacyExists) {
      await fs.copyFile(legacy, dest);
      results.push({ file: dest, action: 'copied' });
    } else {
      results.push({ file: dest, action: 'skipped' });
    }
  }
  return results;
}

module.exports = {
  USER_DATA_SUBDIR,
  userDataDirFor,
  resolveUserDataDir,
  accountsFile,
  configFile,
  legacyDataDir,
  legacyAccountsFile,
  legacyConfigFile,
  resourcesDirFor,
  fileExists,
  migrateRuntimeFiles
};
