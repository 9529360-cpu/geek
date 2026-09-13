// src/updater.cjs — 自动更新框架（electron-updater）
//
// 当前发布渠道由 electron-builder.yml 的 generic provider 指向公开只读 R2 Worker。
// 发布凭据只用于构建/上传环境，客户端 app-update.yml 仅包含公开下载地址。
'use strict';

const { autoUpdater } = require('electron-updater');
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { shouldCheckForUpdates } = require('./updater-policy.cjs');
const { installSubscriptionWindowVisibilityRecovery } = require('./subscription-window-visibility.cjs');
const { createUpdaterStatusRelay } = require('./updater-status-relay.cjs');

// main.cjs 在创建窗口前加载 updater.cjs，因此这里能提前捕获登录窗口创建事件。
// 只针对 subscription.html；ready-to-show 异常时由 did-finish-load/超时兜底显示。
installSubscriptionWindowVisibilityRecovery({ app });

const LOG_PREFIX = '[updater]';
const STATUS_CHANNEL = 'updater:status';
const INITIAL_CHECK_DELAY_MS = 10 * 1000;
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const statusRelay = createUpdaterStatusRelay({
  getWindows: () => BrowserWindow.getAllWindows(),
  statusChannel: STATUS_CHANNEL,
});
let downloadedVersion = null; // 已下载待安装版本；未下载完成时拒绝手动安装
let isInstallingUpdate = false; // 安装中标志：禁止崩溃恢复 relaunch 竞态
let checkTimer = null;
let checkInFlight = false;
let statusReplayInstalled = false;

// 更新状态同时广播给当前窗口，并保留最新快照供之后创建的主窗口重放。
function sendStatus(payload) {
  return statusRelay.publish(payload);
}

function installFutureWindowStatusReplay() {
  if (statusReplayInstalled) return;
  statusReplayInstalled = true;
  app.on('browser-window-created', (_event, window) => {
    statusRelay.replayAfterLoad(window);
  });
}

function clearCheckTimer() {
  if (!checkTimer) return;
  clearTimeout(checkTimer);
  checkTimer = null;
}

function scheduleUpdateCheck(delayMs) {
  // Once a package is downloaded, preserve the pending-install state until install/process exit.
  if (downloadedVersion || isInstallingUpdate) return false;
  clearCheckTimer();
  checkTimer = setTimeout(runUpdateCheck, delayMs);
  // 定时检查不应单独阻止应用退出；Electron/Node 环境支持时解除事件循环引用。
  checkTimer.unref?.();
  return true;
}

async function runUpdateCheck() {
  if (downloadedVersion || isInstallingUpdate) return;
  if (checkInFlight) {
    scheduleUpdateCheck(RECHECK_INTERVAL_MS);
    return;
  }

  checkInFlight = true;
  try {
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (error) {
    console.error(`${LOG_PREFIX} checkForUpdatesAndNotify 失败:`, error?.message || error);
  } finally {
    checkInFlight = false;
    if (!downloadedVersion && !isInstallingUpdate) scheduleUpdateCheck(RECHECK_INTERVAL_MS);
  }
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

  installFutureWindowStatusReplay();

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
    // 不强制 quitAndInstall：通知 renderer，由用户点击“重启安装”触发。
    // 下载完成后停止本进程内的周期重查，避免瞬态状态覆盖待安装能力。
    downloadedVersion = info.version;
    clearCheckTimer();
    sendStatus({ phase: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (error) => {
    console.error(`${LOG_PREFIX} 更新检查失败:`, error?.message || error);
    sendStatus({ phase: 'error', message: String(error?.message || error).slice(0, 200) });
  });

  // 首次启动稍后检查；在尚无待安装包时，长期运行客户端每 6 小时重新检查。
  scheduleUpdateCheck(INITIAL_CHECK_DELAY_MS);
}

// 用户点击“重启安装”后调用（主进程 updater:install IPC）
function quitAndInstallForUpdate() {
  if (!downloadedVersion) {
    console.error(`${LOG_PREFIX} 尚无已下载更新，拒绝安装`);
    return false;
  }
  try {
    isInstallingUpdate = true;
    clearCheckTimer();
    autoUpdater.quitAndInstall();
    return true;
  } catch (error) {
    console.error(`${LOG_PREFIX} 手动安装失败:`, error?.message || error);
    isInstallingUpdate = false;
    // 已下载包仍然有效；保留重试安装能力，不恢复周期更新检查。
    return false;
  }
}

function isUpdateInstalling() {
  return isInstallingUpdate;
}

module.exports = { initAutoUpdater, quitAndInstallForUpdate, isUpdateInstalling };
