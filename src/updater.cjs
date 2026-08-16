// src/updater.cjs — 自动更新框架（electron-updater）
//
// 当前状态：框架已接入，发布渠道留空。
// 接入发布渠道（未来）：
//   1. 在 electron-builder.yml 的 publish 节点填 GitHub 私有仓库：
//        publish:
//          provider: github
//          owner: <你的 GitHub 用户名>
//          repo: <仓库名>
//          private: true
//   2. 打包发布时设置环境变量 GH_TOKEN（仅用于上传，不写入代码/配置）
//   3. 重新打包后 app-update.yml 会自动带上发布地址，用户端启动即自动检查
'use strict';

const { autoUpdater } = require('electron-updater');
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { shouldCheckForUpdates } = require('./updater-policy.cjs');

const LOG_PREFIX = '[updater]';
const STATUS_CHANNEL = 'updater:status';
let downloadedVersion = null; // 已下载待安装版本；未下载完成时拒绝手动安装
let isInstallingUpdate = false; // 安装中标志：禁止崩溃恢复 relaunch 竞态

// 把更新状态转发给主窗口（renderer 显示提示）
function sendStatus(payload) {
  try {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    win?.webContents.send(STATUS_CHANNEL, payload);
  } catch { /* 转发失败不影响 */ }
}

function initAutoUpdater() {
  // 开发模式（electron . 直接跑源码）没有打包产物，无法更新，直接跳过。
  if (!app.isPackaged) {
    console.log(`${LOG_PREFIX} 开发模式运行，跳过自动更新检查`);
    return;
  }

  const updateConfigPath = path.join(process.resourcesPath, 'app-update.yml');
  if (!shouldCheckForUpdates({
    isPackaged: app.isPackaged,
    updateConfigPath,
    fileExists: fs.existsSync
  })) {
    console.log(`${LOG_PREFIX} 未配置发布渠道，跳过自动更新检查`);
    return;
  }

  autoUpdater.autoDownload = true; // 发现新版自动下载
  autoUpdater.autoInstallOnAppQuit = true; // 退出时自动安装
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    console.log(`${LOG_PREFIX} 正在检查更新...`);
    sendStatus({ phase: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`${LOG_PREFIX} 发现新版本: ${info.version}`);
    sendStatus({ phase: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    console.log(`${LOG_PREFIX} 已是最新版本`);
    sendStatus({ phase: 'up-to-date' });
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent * 10) / 10;
    console.log(`${LOG_PREFIX} 下载进度: ${percent}%`);
    sendStatus({ phase: 'downloading', percent });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`${LOG_PREFIX} 新版本 ${info.version} 已下载，等待用户确认重启安装`);
    // 不强制 quitAndInstall：通知 renderer，由用户点击“重启安装”触发
    downloadedVersion = info.version;
    sendStatus({ phase: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (error) => {
    console.error(`${LOG_PREFIX} 更新检查失败:`, error?.message || error);
    sendStatus({ phase: 'error', message: String(error?.message || error).slice(0, 200) });
  });

  // 延迟检查，避免拖慢启动。
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      console.error(`${LOG_PREFIX} checkForUpdatesAndNotify 失败:`, error?.message || error);
    });
  }, 10 * 1000);
}

// 用户点击“重启安装”后调用（主进程 updater:install IPC）
function quitAndInstallForUpdate() {
  if (!downloadedVersion) {
    console.error(`${LOG_PREFIX} 尚无已下载更新，拒绝安装`);
    return false;
  }
  try {
    isInstallingUpdate = true;
    autoUpdater.quitAndInstall();
    return true;
  } catch (error) {
    console.error(`${LOG_PREFIX} 手动安装失败:`, error?.message || error);
    isInstallingUpdate = false;
    return false;
  }
}

function isUpdateInstalling() {
  return isInstallingUpdate;
}

module.exports = { initAutoUpdater, quitAndInstallForUpdate, isUpdateInstalling };
