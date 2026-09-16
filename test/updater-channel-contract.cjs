'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const updater = fs.readFileSync(path.join(__dirname, '../src/updater.cjs'), 'utf8');
const statusRelay = fs.readFileSync(path.join(__dirname, '../src/updater-status-relay.cjs'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
const desktopIpc = fs.readFileSync(path.join(__dirname, '../src/desktop-ipc.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '../src/preload.cjs'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const yml = fs.readFileSync(path.join(__dirname, '../electron-builder.yml'), 'utf8');

// 1) 发布渠道配置落地（公开只读的 R2 更新源；源码仓库仍保持私有）
assert.match(yml, /publish:/, 'electron-builder.yml 必须启用 publish');
assert.match(yml, /provider:\s*generic/, '必须使用 generic provider');
assert.match(yml, /url:\s*https:\/\/geek-release\.9529360\.workers\.dev/, '必须使用正式 R2 更新地址');
assert.doesNotMatch(yml, /provider:\s*github|GH_TOKEN|private:\s*true/, '客户端构建配置不得依赖 GitHub 发布凭据');

// 2) updater 状态由单一 relay 持有：当前窗口实时广播，后创建窗口 load 完成后重放。
assert.match(updater, /createUpdaterStatusRelay/, 'updater 必须组合状态 relay owner');
assert.match(updater, /getWindows:\s*\(\) => BrowserWindow\.getAllWindows\(\)/, 'relay 必须从 Electron 获取当前窗口集合');
assert.match(updater, /app\.on\('browser-window-created',[\s\S]*statusRelay\.replayAfterLoad\(window\)/, '后创建窗口必须挂载状态重放');
assert.doesNotMatch(updater, /getAllWindows\(\)\.find\(/, '更新状态不得再依赖第一个 BrowserWindow 的隐含顺序');
assert.match(statusRelay, /for \(const window of currentWindows\(\)\) deliver\(window, latestStatus\)/, '当前窗口必须全部获得实时状态');
assert.match(statusRelay, /contents\.once\('did-finish-load',[\s\S]*replayTo\(window\)/, '后创建窗口必须在 renderer load 完成后重放');
assert.match(statusRelay, /sequence:\s*\+\+sequence/, '状态快照必须有单调序号');
assert.match(updater, /updater:status/, '必须继续使用 updater:status 通道');
assert.match(updater, /update-downloaded/, '下载完成事件必须转发');
assert.match(updater, /sendStatus\(\{ phase: 'downloaded'/, '下载完成必须走用户确认路径');
const quitAndInstallCount = (updater.match(/quitAndInstall\(\)/g) || []).length;
assert.equal(quitAndInstallCount, 1, 'quitAndInstall 只允许出现在手动安装入口（用户确认）');

// 3) 手动安装入口：renderer 请求 → Desktop IPC owner → 现有 quitAndInstall
assert.match(main, /const \{ installDesktopIpc \} = require\('\.\/desktop-ipc\.cjs'\)/, '主进程必须组合 Desktop IPC owner');
assert.match(main, /desktopIpcBoundary = installDesktopIpc\(\{[\s\S]*?quitAndInstallForUpdate,[\s\S]*?\}\);/, '主进程必须把现有更新安装入口注入 Desktop IPC owner');
assert.match(desktopIpc, /register\('updater:install', \(\) => quitAndInstallForUpdate\(\)\)/, 'Desktop IPC owner 必须注册 updater:install 并调用现有安装入口');
assert.match(desktopIpc, /const \{ assertMainFrameIpcSender \} = require\('\.\/main-frame-ipc-boundary\.cjs'\)/, '更新安装请求必须复用 shared main-frame sender guard');
const desktopRegistration = desktopIpc.match(
  /ipcMain\.handle\(channel, async \(event, \.\.\.args\) => \{([\s\S]*?)\n\s*\}\);\s*registeredChannels\.add\(channel\);/,
);
assert.ok(desktopRegistration, 'Desktop IPC owner 必须通过统一 registration wrapper 注册 privileged handler');
const registrationBody = desktopRegistration[1];
const frameGuardIndex = registrationBody.indexOf('assertMainFrameIpcSender(event);');
const trustedGuardIndex = registrationBody.indexOf('assertTrustedSender(event);');
const handlerIndex = registrationBody.indexOf('return handler(...args);');
assert.ok(frameGuardIndex >= 0, '更新安装请求必须先通过 main-frame sender 校验');
assert.ok(trustedGuardIndex > frameGuardIndex, 'trusted sender 校验必须发生在 main-frame sender 校验之后');
assert.ok(handlerIndex > trustedGuardIndex, 'updater:install side effect 必须在两层 sender 校验都通过后执行');
assert.match(preload, /updater:.*install|install: \(\) => ipcRenderer\.invoke\('updater:install'\)/, 'preload 必须暴露安装方法');
assert.match(preload, /onStatus.*updater:status|updater:status/, 'preload 必须暴露状态监听');

// 4) UI 有更新提示入口
assert.match(app, /updater:status|更新|重启安装|update/, 'renderer 必须处理更新状态');

console.log('UPDATER_CHANNEL_CONTRACT_OK');
