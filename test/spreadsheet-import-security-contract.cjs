'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const main = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');

assert.equal(pkg.dependencies.xlsx, undefined, '不得依赖没有安全修复版本的 xlsx 包');
assert.doesNotMatch(main, /require\(['"]xlsx['"]\)|XLSX\.read|sheet_to_json/, '主进程不得解析不可信 XLS/XLSX 文件');
assert.match(main, /extensions:\s*\['csv', 'txt'\]/, '联系人导入必须限制为文本格式');
assert.match(main, /'\.xlsx':\s*'application\/vnd\.openxmlformats/, 'XLSX 仍应能作为普通附件发送');

console.log('SPREADSHEET_IMPORT_SECURITY_CONTRACT_OK');
