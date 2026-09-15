'use strict';
// 契约测试：accounts/config 运行路径必须固定到 Electron userData 目录，
// 首次运行时仅当目标不存在才从项目 data/ 安全迁移（目标已存在则以目标为准），
// 绝不覆盖登录分区或凭据文件；路径与迁移辅助函数必须不依赖 Electron 即可测试。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const runtimePaths = require('../src/runtime-paths.cjs');

function freshDir(prefix) {
  const dir = path.join(os.tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

(async () => {
  // ---- 纯路径辅助函数（不依赖 Electron）----
  const roaming = path.join('C:', 'Users', 'test', 'AppData', 'Roaming');
  const userData = runtimePaths.userDataDirFor(roaming);
  const isolatedOverride = path.join('D:', 'isolated', 'geek-user-data');
  assert.equal(
    runtimePaths.resolveUserDataDir({ appDataDir: roaming, overrideDir: isolatedOverride }),
    path.resolve(isolatedOverride),
    '显式测试覆写必须使用隔离 userData 目录'
  );
  assert.equal(
    runtimePaths.resolveUserDataDir({ appDataDir: roaming, overrideDir: '' }),
    userData,
    '正常运行无覆写时仍必须使用固定 geek 目录'
  );
  assert.equal(runtimePaths.USER_DATA_SUBDIR, 'geek', 'userData 子目录必须固定为 geek（正式版与开发期 whatsapp-multi 分离）');
  assert.equal(userData, path.join(roaming, 'geek'), 'userDataDirFor 必须基于 appData 计算固定目录');

  const projectRoot = path.join('D:', 'proj', 'geek');
  assert.equal(runtimePaths.accountsFile(userData), path.join(userData, 'accounts.json'), 'accounts 必须落在 userData 下');
  assert.equal(runtimePaths.configFile(userData), path.join(userData, 'config.json'), 'config 必须落在 userData 下');
  assert.equal(runtimePaths.legacyAccountsFile(projectRoot), path.join(projectRoot, 'data', 'accounts.json'), '旧 accounts 在项目 data/ 下');
  assert.equal(runtimePaths.legacyConfigFile(projectRoot), path.join(projectRoot, 'data', 'config.json'), '旧 config 在项目 data/ 下');

  assert.equal(
    runtimePaths.resourcesDirFor({ packaged: false, resourcesPath: 'unused', appDir: path.join(projectRoot, 'src') }),
    path.join(projectRoot, 'resources'),
    '开发模式资源目录仍指向项目 resources/'
  );
  assert.equal(
    runtimePaths.resourcesDirFor({ packaged: true, resourcesPath: path.join('app', 'resources'), appDir: 'unused' }),
    path.join('app', 'resources', 'app.asar.unpacked', 'resources'),
    '打包模式扩展资源必须解析到 app.asar.unpacked 下的真实文件'
  );

  // ---- 迁移行为 ----
  const legacyRoot = freshDir('geek-p0-legacy');
  fs.mkdirSync(path.join(legacyRoot, 'data'), { recursive: true });
  const legacyAccounts = JSON.stringify({ legacy: 'accounts' });
  const legacyConfig = JSON.stringify({ legacy: 'config' });
  fs.writeFileSync(path.join(legacyRoot, 'data', 'accounts.json'), legacyAccounts, 'utf8');
  fs.writeFileSync(path.join(legacyRoot, 'data', 'config.json'), legacyConfig, 'utf8');

  // 1) 首次运行：目标不存在 -> 复制旧数据；旧源文件必须保留（复制而非移动）
  {
    const ud = freshDir('geek-p0-ud-firstrun');
    const results = await runtimePaths.migrateRuntimeFiles({ userDataDir: ud, projectRoot: legacyRoot });
    assert.equal(fs.readFileSync(path.join(ud, 'accounts.json'), 'utf8'), legacyAccounts, '首次运行应把旧 accounts 复制到 userData');
    assert.equal(fs.readFileSync(path.join(ud, 'config.json'), 'utf8'), legacyConfig, '首次运行应把旧 config 复制到 userData');
    assert.equal(fs.readFileSync(path.join(legacyRoot, 'data', 'accounts.json'), 'utf8'), legacyAccounts, '旧 accounts 源文件不能被移动/删除');
    assert.equal(fs.readFileSync(path.join(legacyRoot, 'data', 'config.json'), 'utf8'), legacyConfig, '旧 config 源文件不能被移动/删除');
    assert.deepEqual(results.map((r) => r.action).sort(), ['copied', 'copied'], '两个文件都应标记为 copied');
  }

  // 2) 目标已存在（非空账号）-> 目标数据获胜，绝不回写覆盖
  {
    const ud = freshDir('geek-p0-ud-wins');
    const destAccounts = JSON.stringify({ accounts: [{ id: 'dest-account', type: 'whatsapp' }] });
    fs.writeFileSync(path.join(ud, 'accounts.json'), destAccounts, 'utf8');
    const results = await runtimePaths.migrateRuntimeFiles({ userDataDir: ud, projectRoot: legacyRoot });
    assert.equal(fs.readFileSync(path.join(ud, 'accounts.json'), 'utf8'), destAccounts, '目标已存在时必须以目标为准');
    assert.equal(fs.readFileSync(path.join(legacyRoot, 'data', 'accounts.json'), 'utf8'), legacyAccounts, '旧源文件必须保持原样');
    assert.equal(fs.readFileSync(path.join(ud, 'config.json'), 'utf8'), legacyConfig, '缺失的 config 仍应被复制补齐');
    assert.deepEqual(results.map((r) => r.action).sort(), ['copied', 'kept'], 'accounts=kept, config=copied');
  }

  // 2b) 目标 accounts.json 为空数组且没有提交证明（陈旧空文件）-> 仍保留历史 P0 恢复行为
  {
    const ud = freshDir('geek-p0-ud-empty-shadow');
    fs.writeFileSync(path.join(ud, 'accounts.json'), JSON.stringify({ accounts: [] }), 'utf8');
    const results = await runtimePaths.migrateRuntimeFiles({ userDataDir: ud, projectRoot: legacyRoot });
    assert.equal(
      fs.readFileSync(path.join(ud, 'accounts.json'), 'utf8'),
      legacyAccounts,
      '无 commit proof 的空数组目标必须继续被旧源覆盖（防止历史空文件遮蔽真实账号）'
    );
    assert.equal(fs.readFileSync(path.join(legacyRoot, 'data', 'accounts.json'), 'utf8'), legacyAccounts, '旧源文件必须保持原样');
    assert.deepEqual(results.map((r) => r.action).sort(), ['copied', 'copied'], '无证明空目标应继续标记为 copied');
  }

  // 2c) 已提交的空 Account State 是合法用户状态（例如删除最后一个账号）-> 旧源绝不能让已删除账号复活
  {
    const ud = freshDir('geek-p0-ud-committed-empty');
    const committedEmpty = JSON.stringify({ activeAccountId: null, accounts: [] }, null, 2);
    const accountsPath = path.join(ud, 'accounts.json');
    fs.writeFileSync(accountsPath, committedEmpty, 'utf8');
    fs.writeFileSync(`${accountsPath}.commit`, `${JSON.stringify({ version: 1, sha256: '0'.repeat(64) })}\n`, 'utf8');
    const results = await runtimePaths.migrateRuntimeFiles({ userDataDir: ud, projectRoot: legacyRoot });
    assert.equal(
      fs.readFileSync(accountsPath, 'utf8'),
      committedEmpty,
      '有 commit proof 的合法空账号状态必须保持权威，不能从 legacy 回灌账号'
    );
    assert.equal(fs.readFileSync(path.join(ud, 'config.json'), 'utf8'), legacyConfig, '账号提交证明不得阻止独立的 config 首次迁移');
    assert.deepEqual(results.map((r) => r.action).sort(), ['copied', 'kept'], 'committed accounts=kept, config=copied');
  }

  // 2d) commit proof 存在但主文件暂缺 -> recovery/fail-closed 属于 Account State owner，legacy migration 不得抢写
  {
    const ud = freshDir('geek-p0-ud-committed-missing-primary');
    const accountsPath = path.join(ud, 'accounts.json');
    fs.writeFileSync(`${accountsPath}.commit`, `${JSON.stringify({ version: 1, sha256: '1'.repeat(64) })}\n`, 'utf8');
    const results = await runtimePaths.migrateRuntimeFiles({ userDataDir: ud, projectRoot: legacyRoot });
    assert.equal(fs.existsSync(accountsPath), false, '有 commit proof 时即使主文件缺失也必须留给 Account State 自己恢复');
    assert.equal(fs.readFileSync(path.join(ud, 'config.json'), 'utf8'), legacyConfig, '账号恢复所有权不得阻止 config 迁移');
    assert.deepEqual(results.map((r) => r.action).sort(), ['copied', 'kept'], 'proof-owned missing primary must remain migration-kept');
  }

  // 2e) 目标 config.json 非空 -> config 仍目标优先（配置可能合法为空/含值，不按账号规则覆盖）
  {
    const ud = freshDir('geek-p0-ud-config-wins');
    const destConfig = JSON.stringify({ theme: 'dark' });
    fs.writeFileSync(path.join(ud, 'config.json'), destConfig, 'utf8');
    await runtimePaths.migrateRuntimeFiles({ userDataDir: ud, projectRoot: legacyRoot });
    assert.equal(fs.readFileSync(path.join(ud, 'config.json'), 'utf8'), destConfig, 'config 目标存在时仍目标优先');
  }

  // 3) 绝不覆盖登录分区/凭据：迁移只触碰两个 JSON，其余 userData 内容必须原样保留
  {
    const ud = freshDir('geek-p0-ud-partitions');
    const partFile = path.join(ud, 'Partitions', 'webview-page-1', 'geek-account-data.jsonl');
    fs.mkdirSync(path.dirname(partFile), { recursive: true });
    fs.writeFileSync(partFile, 'LOGIN_PARTITION_MARKER', 'utf8');
    const tokenFile = path.join(ud, 'line-tokens.json');
    fs.writeFileSync(tokenFile, 'TOKEN_MARKER', 'utf8');
    await runtimePaths.migrateRuntimeFiles({ userDataDir: ud, projectRoot: legacyRoot });
    assert.equal(fs.readFileSync(partFile, 'utf8'), 'LOGIN_PARTITION_MARKER', '登录分区数据必须原样保留');
    assert.equal(fs.readFileSync(tokenFile, 'utf8'), 'TOKEN_MARKER', 'line-tokens.json 凭据必须原样保留');
    assert.equal(fs.readFileSync(path.join(ud, 'accounts.json'), 'utf8'), legacyAccounts, 'accounts 仍应正常迁移');
  }

  // 4) 双方都没有 -> 不报错、不创建空文件
  {
    const emptyRoot = freshDir('geek-p0-empty-project');
    const ud = freshDir('geek-p0-ud-empty');
    const results = await runtimePaths.migrateRuntimeFiles({ userDataDir: ud, projectRoot: emptyRoot });
    assert.equal(fs.existsSync(path.join(ud, 'accounts.json')), false, '无源数据时不应创建 accounts.json');
    assert.equal(fs.existsSync(path.join(ud, 'config.json')), false, '无源数据时不应创建 config.json');
    assert.equal(fs.existsSync(ud), true, 'userData 目录应被创建');
    assert.deepEqual(results.map((r) => r.action), ['skipped', 'skipped'], '无源无目标应为 skipped');
  }

  console.log('RUNTIME_PATHS_CONTRACT_OK');
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
