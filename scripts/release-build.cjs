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

const certificate = process.env.WIN_CSC_LINK || process.env.CSC_LINK;
const password = process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD;
if (!certificate) fail('缺少 WIN_CSC_LINK/CSC_LINK，正式发布禁止生成未签名安装包');
if (!password) fail('缺少 WIN_CSC_KEY_PASSWORD/CSC_KEY_PASSWORD');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const build = spawnSync(npx, ['electron-builder', '--win', '--publish', 'never', '--config.forceCodeSigning=true'], {
  cwd: root, stdio: 'inherit', env: process.env,
});
if (build.status !== 0) fail(`electron-builder 失败 (${build.status})`);

const installers = fs.readdirSync(outDir).filter(name => name.toLowerCase().endsWith('.exe'));
if (!installers.length) fail('没有生成 Windows EXE');
for (const name of installers) {
  const file = path.join(outDir, name);
  const escaped = file.replace(/'/g, "''");
  const verify = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$s=Get-AuthenticodeSignature -LiteralPath '${escaped}'; if($s.Status -ne 'Valid'){Write-Error $s.Status; exit 1}; $s.SignerCertificate.Subject`],
  { cwd: root, encoding: 'utf8', windowsHide: true });
  if (verify.status !== 0) fail(`${name} Authenticode 签名无效`);
  console.log(`[release] signed ${name}: ${String(verify.stdout || '').trim()}`);
}

const latest = path.join(outDir, 'latest.yml');
if (!fs.existsSync(latest)) fail('缺少 latest.yml');
const latestText = fs.readFileSync(latest, 'utf8');
if (!new RegExp(`^version:\\s*${pkg.version.replace(/\./g, '\\.')}$`, 'm').test(latestText)) fail('latest.yml 版本与 package.json 不一致');
if (!fs.readdirSync(outDir).some(name => name.endsWith('.blockmap'))) fail('缺少 blockmap');

const releaseFiles = fs.readdirSync(outDir).filter(name => /\.(exe|yml|blockmap)$/i.test(name)).sort();
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
