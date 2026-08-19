'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const main = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');
const entry = fs.readFileSync(path.join(root, 'src/main-entry.cjs'), 'utf8');
const boundary = fs.readFileSync(path.join(root, 'src/broadcast-files.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'src/preload.cjs'), 'utf8');

assert.equal(pkg.dependencies?.xlsx, undefined, '不得依赖没有安全修复版本的 xlsx 包');
assert.doesNotMatch(main + boundary, /require\(['"]xlsx['"]\)|XLSX\.read|sheet_to_json/, '主进程不得解析不可信 XLS/XLSX 文件');
assert.match(main, /extensions:\s*\['csv', 'txt'\]/, '旧联系人选择器也必须限制为文本格式');
assert.match(main, /'\.xlsx':\s*'application\/vnd\.openxmlformats/, 'XLSX 仍应能作为普通附件发送');
assert.equal(pkg.main, 'src/main-entry.cjs', '受限导入边界必须先于 main.cjs 安装');
assert.match(entry, /installBroadcastFileBoundary\(/, '启动入口必须安装联系人导入边界');
assert.match(boundary, /ext !== '\.csv' && ext !== '\.txt'/, '受限导入必须在读取前校验 CSV/TXT 扩展名');
assert.match(boundary, /const stat = await handle\.stat\(\)/, '受限导入必须从已打开句柄 stat');
assert.match(boundary, /size > limits\.maxImportBytes/, '受限导入必须在读取前检查文件大小');
assert.match(boundary, /Buffer\.allocUnsafe\(limits\.maxImportBytes \+ 1\)/, '读取缓冲区必须受上限约束');
assert.match(boundary, /bytesRead > limits\.maxImportBytes/, '文件并发增长时也必须 fail closed');
assert.match(boundary, /maxImportBytes: 5 \* MiB/, 'CSV/TXT 当前上限必须为 5 MiB');
assert.match(boundary, /'file:pick-csv': null/, '旧无上限 CSV picker 必须被禁用');
assert.match(preload, /ipcRenderer\.invoke\('file:pick-csv-limited'\)/, 'renderer 必须只调用受限 CSV/TXT picker');
assert.doesNotMatch(preload, /ipcRenderer\.invoke\('file:pick-csv'\)/, 'preload 不得重新暴露旧无上限导入通道');

console.log('SPREADSHEET_IMPORT_SECURITY_CONTRACT_OK');
