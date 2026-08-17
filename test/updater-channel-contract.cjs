'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const updater = fs.readFileSync(path.join(__dirname, '../src/updater.cjs'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '../src/preload.cjs'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const yml = fs.readFileSync(path.join(__dirname, '../electron-builder.yml'), 'utf8');

// 1) 发布渠道配置落地（公开只读的 R2 更新源；源码仓库仍保持私有）
assert.match(yml, /publish:/, 'electron-builder.yml 必须启用 publish');
assert.match(yml, /provider:\s*generic/, '必须使用 generic provider');
assert.match(yml, /url:\s*https:\/\/geek-release\.9529360\.workers\.dev/, '必须使用正式 R2 更新地址');
assert.doesNotMatch(yml, /provider:\s*github|GH_TOKEN|private:\s*true/, '客户端构建配置不得依赖 GitHub 发布凭据');

// 2) updater 事件转发给 renderer（UI 可见）
assert.match(updater, /webContents\.send\(STATUS_CHANNEL/, 'updater 必须把事件转发给主窗口');
assert.match(updater, /updater:status/, '必须使用 updater:status 通道');
assert.match(updater, /update-downloaded/, '下载完成事件必须转发');
assert.match(updater, /sendStatus\(\{ phase: 'downloaded'/, '下载完成必须走用户确认路径');
const quitAndInstallCount = (updater.match(/quitAndInstall\(\)/g) || []).length;
assert.equal(quitAndInstallCount, 1, 'quitAndInstall 只允许出现在手动安装入口（用户确认）');

// 3) 手动安装入口：renderer 请求 → 主进程 quitAndInstall
assert.match(main, /updater:install/, '主进程必须注册 updater:install');
assert.match(main, /quitAndInstall/, '手动安装调用 quitAndInstall');
assert.match(preload, /updater:.*install|install: \(\) => ipcRenderer\.invoke\('updater:install'\)/, 'preload 必须暴露安装方法');
assert.match(preload, /onStatus.*updater:status|updater:status/, 'preload 必须暴露状态监听');

// 4) UI 有更新提示入口
assert.match(app, /updater:status|更新|重启安装|update/, 'renderer 必须处理更新状态');

console.log('UPDATER_CHANNEL_CONTRACT_OK');
