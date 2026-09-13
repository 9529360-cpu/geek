'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n?/g, '\n');
const main = read('src/main.cjs');
const owner = read('src/desktop-ipc.cjs');
const preload = read('src/preload.cjs');

const expectedChannels = [
  'app:get-version',
  'platforms:list',
  'bridge:get-preload-path',
  'window:relaunch',
  'updater:install',
  'window:minimize',
  'window:maximize',
  'window:close',
  'notify:show',
  'theme:get-system',
  'file:save',
];

assert.match(main, /const \{ installDesktopIpc \} = require\('\.\/desktop-ipc\.cjs'\)/, 'main must import Desktop IPC owner');
assert.match(main, /desktopIpcBoundary = installDesktopIpc\(\{/, 'main must compose Desktop IPC owner');
assert.match(main, /assertTrustedSender,/, 'main must inject the existing trusted main-renderer sender policy');
assert.match(main, /getMainWindow:\s*\(\) => mainWindow/, 'main must retain BrowserWindow ownership and inject a getter');
assert.match(main, /platformCatalog:\s*PLATFORM_CATALOG/, 'main must inject the canonical Platform Catalog');
assert.match(main, /runtimeAssetAllowed,/, 'main must inject the existing runtime integrity authority');
assert.match(main, /resourcesDir:\s*RESOURCES_DIR/, 'main must inject the resolved runtime resources directory');
assert.match(main, /quitAndInstallForUpdate,/, 'main must inject the existing updater install callback');
assert.match(main, /desktopIpcBoundary\?\.dispose\(\)/, 'before-quit lifecycle must dispose Desktop IPC owner');

for (const channel of expectedChannels) {
  const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.doesNotMatch(main, new RegExp(`ipcMain\\.handle\\(['\"]${escaped}['\"]`), `main must not directly register ${channel}`);
  assert.doesNotMatch(main, new RegExp(`ipcMain\\.removeHandler\\(['\"]${escaped}['\"]`), `main must not directly tear down ${channel}`);
  assert.ok(owner.includes(`'${channel}'`), `Desktop IPC owner must declare ${channel}`);
}

assert.doesNotMatch(owner, /require\(['\"]\.\/platform-catalog\.cjs['\"]\)/, 'Desktop IPC owner must not copy or import Platform Catalog authority');
assert.doesNotMatch(owner, /new\s+BrowserWindow|require\(['\"]electron['\"]\).*BrowserWindow/, 'Desktop IPC owner must not create BrowserWindow authority');
assert.match(owner, /ipcMain\.handle\(channel, async \(event, \.\.\.args\) => \{\s*assertTrustedSender\(event\);\s*return handler\(\.\.\.args\);/s, 'every Desktop handler must pass through the common sender guard before work');
assert.match(owner, /for \(const channel of registeredChannels\) ipcMain\.removeHandler\(channel\)/, 'Desktop IPC owner must own complete teardown');

const strayDirectOwners = [];
for (const entry of fs.readdirSync(path.join(root, 'src'), { withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:cjs|mjs|js)$/.test(entry.name)) continue;
  const relative = `src/${entry.name}`;
  if (relative === 'src/desktop-ipc.cjs') continue;
  const source = read(relative);
  for (const channel of expectedChannels) {
    const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`ipcMain\\.(?:handle|removeHandler)\\(['\"]${escaped}['\"]`).test(source)) {
      strayDirectOwners.push(`${relative}:${channel}`);
    }
  }
}
assert.deepEqual(strayDirectOwners, [], 'no production module outside Desktop IPC owner may directly own Desktop channels');

const preloadContracts = [
  /app:\s*Object\.freeze\(\{\s*version:\s*\(\) => ipcRenderer\.invoke\('app:get-version'\)/,
  /platforms:\s*Object\.freeze\(\{\s*list:\s*\(\) => ipcRenderer\.invoke\('platforms:list'\)/,
  /bridge:\s*Object\.freeze\(\{\s*preloadPath:\s*\(\) => ipcRenderer\.invoke\('bridge:get-preload-path'\)/,
  /relaunch:\s*\(\) => ipcRenderer\.invoke\('window:relaunch'\)/,
  /install:\s*\(\) => ipcRenderer\.invoke\('updater:install'\)/,
  /minimize:\s*\(\) => ipcRenderer\.invoke\('window:minimize'\)/,
  /maximize:\s*\(\) => ipcRenderer\.invoke\('window:maximize'\)/,
  /close:\s*\(\) => ipcRenderer\.invoke\('window:close'\)/,
  /notify:\s*Object\.freeze\(\{\s*show:\s*\(payload\) => ipcRenderer\.invoke\('notify:show', payload\)/,
  /getSystem:\s*\(\) => ipcRenderer\.invoke\('theme:get-system'\)/,
  /save:\s*\(payload\) => ipcRenderer\.invoke\('file:save', payload\)/,
];
for (const contract of preloadContracts) assert.match(preload, contract, 'preload Desktop API/channel contract must remain unchanged');

console.log('DESKTOP_IPC_PRODUCTION_OWNERSHIP_CONTRACT_OK');
