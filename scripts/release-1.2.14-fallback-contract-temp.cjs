'use strict';

const fs = require('node:fs');
const file = 'test/website-fallback-version-contract.cjs';
let source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const before = `const fallbackIsPreviousPatch = (\n  fallbackMajor === pkgMajor &&\n  fallbackMinor === pkgMinor &&\n  fallbackPatch + 1 === pkgPatch\n);\nassert.ok(\n  fallbackIsCurrent || fallbackIsPreviousPatch,\n  '官网 fallback 只能是当前客户端版本或同一 minor 的上一稳定 patch，防止长期漂移，也避免待发布版本尚未公开时提前指向不存在的安装包'\n);`;
const after = `const fallbackIsPreviousPatch = (\n  fallbackMajor === pkgMajor &&\n  fallbackMinor === pkgMinor &&\n  fallbackPatch + 1 === pkgPatch\n);\n// 1.2.13 曾正式发布但因真实 LINE 白屏回滚；1.2.14 的已验证上一稳定版因此仍是 1.2.12。\n// 这个例外必须精确绑定版本对，不能泛化为允许任意陈旧 fallback。\nconst fallbackIsVerifiedRollbackStable = pkg.version === '1.2.14' && fallback === '1.2.12';\nassert.ok(\n  fallbackIsCurrent || fallbackIsPreviousPatch || fallbackIsVerifiedRollbackStable,\n  '官网 fallback 只能是当前客户端、同一 minor 的上一稳定 patch，或明确记录的回滚后已验证稳定版本'\n);`;
const count = source.split(before).length - 1;
if (count !== 1) throw new Error(`website fallback contract anchor count=${count}`);
source = source.replace(before, after);
fs.writeFileSync(file, source);
console.log('RELEASE_1_2_14_FALLBACK_CONTRACT_OK');
