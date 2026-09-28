'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n?/g, '\n');
const main = read('src/main.cjs');
const owner = read('src/webview-ipc.cjs');
const ownership = read('src/webview-ownership.cjs');
const preload = read('src/preload.cjs');
const entry = read('src/main-entry.cjs');
const navigation = read('src/webview-navigation-boundary.cjs');
const ui = read('ui/app.js');
const hostAdapters = read('ui/platform-host-adapters.js');

const channels = ['webview:register', 'webview:insert-text', 'webview:commit-submit'];

assert.match(main, /const \{ installWebviewIpc \} = require\('\.\/webview-ipc\.cjs'\)/, 'main must import WebView IPC owner');
assert.match(main, /webviewIpcBoundary = installWebviewIpc\(\{/, 'main must compose WebView IPC owner');
assert.match(main, /assertTrustedSender,/, 'main must inject the trusted main-renderer sender policy');
assert.match(main, /accountState,/, 'main must inject Account State authority');
assert.match(main, /webviewOwnership,/, 'main must inject the existing WebView ownership authority');
assert.match(main, /getWebContentsById:\s*\(guestId\) => webContents\.fromId\(guestId\)/, 'main must inject Electron WebContents lookup authority');
assert.match(main, /getSessionForPartition:\s*\(partition\) => session\.fromPartition\(partition\)/, 'main must inject Electron Session lookup authority');
assert.match(main, /webviewIpcBoundary\?\.dispose\(\)/, 'before-quit must dispose WebView IPC owner');

for (const channel of channels) {
  const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.doesNotMatch(main, new RegExp(`ipcMain\\.handle\\(['\"]${escaped}['\"]`), `main must not directly register ${channel}`);
  assert.doesNotMatch(main, new RegExp(`ipcMain\\.removeHandler\\(['\"]${escaped}['\"]`), `main must not directly tear down ${channel}`);
  assert.ok(owner.includes(`'${channel}'`), `WebView IPC owner must declare ${channel}`);
  assert.match(owner, new RegExp(`register\\(['\"]${escaped}['\"]`), `WebView IPC owner must register ${channel}`);
}

const strayDirectOwners = [];
for (const entryFile of fs.readdirSync(path.join(root, 'src'), { withFileTypes: true })) {
  if (!entryFile.isFile() || !/\.(?:cjs|mjs|js)$/.test(entryFile.name)) continue;
  const relative = `src/${entryFile.name}`;
  if (relative === 'src/webview-ipc.cjs') continue;
  const source = read(relative);
  for (const channel of channels) {
    const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`ipcMain\\.(?:handle|removeHandler)\\(['\"]${escaped}['\"]`).test(source)) {
      strayDirectOwners.push(`${relative}:${channel}`);
    }
  }
}
assert.deepEqual(strayDirectOwners, [], 'no production module outside WebView IPC owner may directly own WebView channels');

assert.match(ownership, /function createOwnershipRegistry/);
assert.match(ownership, /const entries = new Map\(\)/, 'WebView ownership registry state must remain in webview-ownership.cjs');
assert.doesNotMatch(owner, /createOwnershipRegistry|new\s+Map\s*\(/, 'WebView IPC owner must inject, not copy, ownership registry authority');
assert.match(owner, /webviewOwnership\.register\(/, 'register ingress must delegate ownership creation');
assert.match(owner, /webviewOwnership\.authorize\(/, 'insert ingress must delegate ownership authorization');
assert.match(owner, /webviewOwnership\.remove\(/, 'guest lifecycle cleanup must delegate ownership removal');

assert.match(preload, /register:\s*\(accountId, guestId, token\) => ipcRenderer\.invoke\('webview:register', accountId, guestId, token\)/, 'preload register channel/API must remain unchanged');
assert.match(preload, /insertText:\s*\(accountId, guestId, text, token, expectedChatId = ''\) => ipcRenderer\.invoke\('webview:insert-text', accountId, guestId, text, token, expectedChatId\)/, 'preload insert API must carry optional explicit conversation binding');
assert.match(preload, /commitSubmit:\s*\(accountId, guestId, expectedChatId, expectedComposerText, token\) => ipcRenderer\.invoke\('webview:commit-submit', accountId, guestId, expectedChatId, expectedComposerText, token\)/, 'preload must expose only the bounded native submit commit ingress');
assert.match(ui, /window\.api\.webviewInput\.register\(account\.id, wv\.getWebContentsId\(\), bridgeTokenFor\(wv\)\)/, 'renderer register call contract must remain unchanged');
assert.match(hostAdapters, /api\.webviewInput\.insertText\([\s\S]{0,220}account\.id,[\s\S]{0,140}webview\.getWebContentsId\(\)/, 'platform host adapters must delegate composer insertion to the main-process WebView IPC owner');
assert.match(hostAdapters, /api\.webviewInput\.commitSubmit\([\s\S]{0,260}account\.id,[\s\S]{0,180}webview\.getWebContentsId\(\)/, 'Telegram and LINE SendIntent commits must delegate native submit to the main-process WebView IPC owner');

assert.match(entry, /installAccountScopedWebviewNavigationBoundary\(\{/, 'early WebView Navigation authority must remain installed');
assert.match(navigation, /contents\.on\?\.\('will-navigate'/, 'navigation boundary must retain navigation authority');
assert.match(navigation, /contents\.on\?\.\('will-redirect'/, 'navigation boundary must retain redirect authority');
assert.doesNotMatch(owner, /webview-navigation-boundary|will-navigate|will-redirect|setWindowOpenHandler/, 'FH-07 owner must not absorb WebView Navigation authority');

assert.match(owner, /require\('\.\/main-frame-ipc-boundary\.cjs'\)/, 'WebView IPC owner must use the shared frame-identity authority');
assert.match(owner, /ipcMain\.handle\(channel, async \(event, \.\.\.args\) => \{\s*assertMainFrameIpcSender\(event\);\s*assertTrustedSender\(event\);\s*return handler\(event, \.\.\.args\);/s, 'every WebView ingress must validate exact main-frame identity before the broader trusted sender guard and work');
assert.match(owner, /String\(account\.partition \|\| ''\) !== partition/, 'account record partition must exactly match authoritative resolved partition');
assert.match(owner, /guest\.hostWebContents !== event\.sender/, 'register must bind guest to trusted host WebContents');
assert.match(owner, /guest\.session !== getSessionForPartition\(partition\)/, 'guest session must match account partition authority');
assert.match(owner, /webviewOwnership\.authorize\(\{[\s\S]*senderId: event\.sender\.id/, 'native-input ingresses must authorize owner and sender through existing ownership registry');
assert.match(owner, /const LINE_TYPES = new Set\(\['line', 'line-business'\]\)/, 'LINE account types must be explicit at the native commit boundary');
assert.match(owner, /const allowedCommitPage = \(isTelegram && TELEGRAM_URL\.test\(url\)\)[\s\S]*\|\| \(isLine && LINE_URL\.test\(url\)\)/, 'commit-submit must bind each supported platform to its exact live guest URL');
assert.match(owner, /isTelegram[\s\S]*\? telegramCommitGuardScript\(chatId, composerText\)[\s\S]*: lineCommitGuardScript\(chatId, composerText\)/, 'commit-submit must use platform-specific exact context/composer guards under one owner');
assert.match(owner, /sendInputEvent\(\{ type: 'keyDown', keyCode: 'Enter' \}\)[\s\S]*sendInputEvent\(\{ type: 'keyUp', keyCode: 'Enter' \}\)/, 'commit-submit must deliver exactly one native Enter sequence');
assert.match(owner, /data-geek-native-submit-commit[\s\S]*clearNativeCommitMarkerScript/, 'native commit must bracket Enter with the shared recursion-bypass marker');
assert.match(owner, /guest\.isDestroyed\(\)/, 'destroyed guests must fail closed');
assert.match(owner, /for \(const channel of registeredChannels\) ipcMain\.removeHandler\(channel\)/, 'WebView IPC owner must own complete channel teardown');

console.log('WEBVIEW_IPC_PRODUCTION_OWNERSHIP_CONTRACT_OK');