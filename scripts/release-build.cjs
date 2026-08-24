'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'dist-release');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function fail(message) {
  console.error(`[release] ${message}`);
  process.exit(1);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// GitHub Actions 不是唯一安全边界：正式发布入口本身必须先跑完整测试。
const testRunner = path.join(root, 'scripts', 'run-tests.cjs');
const tests = spawnSync(process.execPath, [testRunner], {
  cwd: root, stdio: 'inherit', env: process.env,
});
if (tests.error) fail(`无法启动发布前测试: ${tests.error.message}`);
if (tests.status !== 0) fail(`发布前测试失败 (${tests.status})`);

// Electron 42+ 不再通过 npm postinstall 下载运行时二进制。
// electron-builder 仍需要 node_modules/electron/dist，因此正式构建前显式安装官方运行时。
const electronInstall = require.resolve('electron/install.js');
const installElectron = spawnSync(process.execPath, [electronInstall, '--no'], {
  cwd: root, stdio: 'inherit', env: process.env,
});
if (installElectron.error) fail(`无法启动 Electron 运行时安装: ${installElectron.error.message}`);
if (installElectron.status !== 0) fail(`Electron 运行时安装失败 (${installElectron.status})`);

// 生成受 app.asar 完整性保护的清单，用于启动时校验必须解包到磁盘的桥接/LINE 扩展代码。
const integrityGenerator = path.join(root, 'scripts', 'generate-unpacked-integrity.cjs');
const generateIntegrity = spawnSync(process.execPath, [integrityGenerator], {
  cwd: root, stdio: 'inherit', env: process.env,
});
if (generateIntegrity.error) fail(`无法生成运行时完整性清单: ${generateIntegrity.error.message}`);
if (generateIntegrity.status !== 0) fail(`运行时完整性清单生成失败 (${generateIntegrity.status})`);

const builderCli = require.resolve('electron-builder/out/cli/cli.js');
const build = spawnSync(process.execPath, [builderCli, '--win', '--publish', 'never'], {
  cwd: root, stdio: 'inherit', env: process.env,
});
if (build.error) fail(`无法启动 electron-builder: ${build.error.message}`);
if (build.status !== 0) fail(`electron-builder 失败 (${build.status})`);

// WA/TG 翻译和原生输入依赖这个 guest preload。打包运行时从
// app.asar.unpacked/resources 解析，因此发布包必须真实包含且与源码一致，
// 不能静默退化到 console-message 兼容通道。
const bridgeSource = path.join(root, 'resources', 'bridge-preload.cjs');
const bridgePackaged = path.join(outDir, 'win-unpacked', 'resources', 'app.asar.unpacked', 'resources', 'bridge-preload.cjs');
if (!fs.existsSync(bridgePackaged)) fail('缺少打包后的 translation bridge preload');
if (sha256File(bridgePackaged) !== sha256File(bridgeSource)) fail('打包后的 translation bridge preload 与源码不一致');

const artifactBase = `geek-setup-${pkg.version}.exe`;
const installers = fs.readdirSync(outDir).filter(name => name.toLowerCase() === artifactBase.toLowerCase());
if (!installers.length) fail('没有生成 Windows EXE');
const certificate = process.env.WIN_CSC_LINK || process.env.CSC_LINK;
if (certificate) {
  for (const name of installers) {
    const file = path.join(outDir, name);
    const escaped = file.replace(/'/g, "''");
    const verify = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$s=Get-AuthenticodeSignature -LiteralPath '${escaped}'; if($s.Status -ne 'Valid'){Write-Error $s.Status; exit 1}; $s.SignerCertificate.Subject`],
    { cwd: root, encoding: 'utf8', windowsHide: true });
    if (verify.status !== 0) fail(`${name} Authenticode 签名无效`);
    console.log(`[release] signed ${name}: ${String(verify.stdout || '').trim()}`);
  }
} else {
  console.warn('[release] 未配置代码签名证书：按既有免费发布方式生成“未知发布者”安装包');
}

const latest = path.join(outDir, 'latest.yml');
if (!fs.existsSync(latest)) fail('缺少 latest.yml');
const latestText = fs.readFileSync(latest, 'utf8');
if (!new RegExp(`^version:\\s*${pkg.version.replace(/\./g, '\\.')}$`, 'm').test(latestText)) fail('latest.yml 版本与 package.json 不一致');
if (!fs.existsSync(path.join(outDir, `${artifactBase}.blockmap`))) fail('缺少当前版本 blockmap');

const releaseFiles = [artifactBase, `${artifactBase}.blockmap`, 'latest.yml'];
const manifest = {
  version: pkg.version,
  generatedAt: new Date().toISOString(),
  files: releaseFiles.map(name => {
    const bytes = fs.readFileSync(path.join(outDir, name));
    return { name, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  }),
};
fs.writeFileSync(path.join(outDir, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('[release] 正式候选构建完成；尚未上传、打 tag 或发布');
