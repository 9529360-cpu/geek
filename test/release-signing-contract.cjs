'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const builder = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
const script = fs.readFileSync(path.join(root, 'scripts/release-build.cjs'), 'utf8');

assert.equal(pkg.scripts.dist, 'node scripts/release-build.cjs', '正式 dist 必须经过安全发布脚本');
assert.ok(pkg.scripts['dist:test'], '必须把未签名测试构建与正式构建分开');
assert.match(builder, /verifyUpdateCodeSignature:\s*true/, 'Windows 更新必须显式验证代码签名');
assert.match(script, /forceCodeSigning=true/, '正式构建必须强制签名');
assert.match(script, /Get-AuthenticodeSignature/, '构建后必须验证 Authenticode');
assert.match(script, /Status -ne 'Valid'/, '非 Valid 签名必须失败');
assert.match(script, /release-manifest\.json/, '必须生成 SHA-256 发布清单');
assert.match(script, /latest\.yml/, '必须验证更新元数据');

console.log('RELEASE_SIGNING_CONTRACT_OK');
