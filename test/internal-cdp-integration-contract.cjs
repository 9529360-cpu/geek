'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
const entry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '../src/preload.cjs'), 'utf8');
const { CHANNELS, installBroadcastFileBoundary } = require('../src/broadcast-files.cjs');

assert.match(main, /require\('\.\/internal-cdp\.cjs'\)/);
assert.match(main, /createInternalCdp\(/);
assert.match(main, /async function sendBroadcastFile/);
assert.match(main, /async function attachBroadcastFile/);
assert.match(main, /async function dropBroadcastFile/);
assert.match(main, /#__hw_file_input/);
assert.match(main, /DOM\.setFileInputFiles/);
assert.match(main, /sendMediaMsgToChat/);
assert.match(main, /Input\.dispatchDragEvent/);
assert.equal(pkg.main, 'src/main-entry.cjs');
assert.doesNotMatch(entry, /installBroadcastFileBoundary\(/, 'deferred broadcast IPC must not be installed as a startup shim');
assert.match(main, /installBroadcastFileBoundary\(/, 'main composition must install the broadcast file capability owner');
assert.match(preload, /ipcRenderer\.invoke\('file:pick-token'\)/);
assert.match(preload, /ipcRenderer\.invoke\('file:pick-csv-limited'\)/);
assert.match(preload, /broadcast:send-file-token/);
assert.match(preload, /broadcast:attach-file-token/);
assert.match(preload, /broadcast:drop-file-token/);
assert.match(preload, /filePath: file\.token/);
assert.match(preload, /delete result\.filePath/);
assert.doesNotMatch(preload, /ipcRenderer\.invoke\('file:pick'\)/);
assert.doesNotMatch(preload, /ipcRenderer\.invoke\('broadcast:(?:send|attach|drop)-file'/);

function createFakeFs() {
  const absolute = path.resolve('attachment.txt');
  return {
    async realpath(value) { if (path.resolve(value) !== absolute) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return absolute; },
    async stat(value) { if (path.resolve(value) !== absolute) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return { size: 5, mtimeMs: 10, isFile: () => true }; },
    async open() { throw new Error('not used'); },
  };
}

(async () => {
  const handlers = new Map();
  const ipcMain = { handle(channel, handler) { assert.equal(handlers.has(channel), false, `duplicate handler ${channel}`); handlers.set(channel, handler); } };
  const uiEntryPath = path.join(__dirname, '../ui/index.html');
  const mainFrame = { url: pathToFileURL(uiEntryPath).href };
  const sender = { id: 7, mainFrame };
  const mainWindow = { webContents: { id: 7, getURL: () => mainFrame.url }, isDestroyed: () => false };
  const dialog = { async showOpenDialog() { return { canceled: false, filePaths: ['attachment.txt'] }; }, async showMessageBox() { throw new Error('unexpected warning'); } };
  const BrowserWindow = { fromWebContents: candidate => candidate === sender ? mainWindow : null };
  const forwarded = [];
  const transport = channel => async ({ payload }) => { forwarded.push({ channel, payload }); return 'OK'; };

  installBroadcastFileBoundary({
    ipcMain, dialog, BrowserWindow, uiEntryPath, fs: createFakeFs(), now: () => 1,
    randomBytes: () => Buffer.alloc(24, 4),
    sendFile: transport('send'), attachFile: transport('attach'), dropFile: transport('drop'),
  });

  const event = { sender, senderFrame: mainFrame };
  await assert.rejects(
    handlers.get(CHANNELS.pickToken)({ sender, senderFrame: { url: mainFrame.url } }),
    { code: 'BROADCAST_FILE_OWNER_INVALID' },
    'same-WebContents child frames must not inherit privileged file capabilities',
  );
  const picked = await handlers.get(CHANNELS.pickToken)(event);
  assert.deepEqual(Object.keys(picked).sort(), ['mime', 'name', 'size', 'token']);
  assert.equal(handlers.has('file:pick'), false, 'legacy picker must never be registered');
  await assert.rejects(handlers.get(CHANNELS.sendFileToken)(event, { fileToken: '../attachment.txt' }), { code: 'BROADCAST_FILE_TOKEN_INVALID' });
  const result = await handlers.get(CHANNELS.sendFileToken)(event, { partition: 'persist:test', chatId: 'chat', fileToken: picked.token, filePath: '/renderer/raw', mime: 'renderer/fake' });
  assert.equal(result, 'OK');
  const payload = forwarded.at(-1).payload;
  assert.equal(payload.filePath, path.resolve('attachment.txt'));
  assert.equal(payload.fileToken, undefined);
  assert.equal(payload.mime, 'text/plain');
  assert.equal(payload.name, 'attachment.txt');
  await assert.rejects(handlers.get(CHANNELS.dropFileToken)({ sender: { id: 8 } }, { fileToken: picked.token }), { code: 'BROADCAST_FILE_OWNER_INVALID' });
  console.log('INTERNAL_CDP_INTEGRATION_CONTRACT_OK');
})().catch(error => { console.error(error); process.exitCode = 1; });