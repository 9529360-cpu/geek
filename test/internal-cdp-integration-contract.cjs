'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
const entry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
const boundarySource = fs.readFileSync(path.join(__dirname, '../src/broadcast-files.cjs'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '../src/preload.cjs'), 'utf8');
const { CHANNELS, installBroadcastFileBoundary } = require('../src/broadcast-files.cjs');

assert.match(main, /require\('\.\/internal-cdp\.cjs'\)/, '主进程必须加载应用内CDP模块');
assert.match(main, /createInternalCdp\(/, '必须创建应用内CDP管理器');
assert.match(main, /externalDebuggingActive/, '必须探测外部调试端口状态');
assert.match(main, /broadcast:send-file/, 'send-file处理器必须保留');
assert.match(main, /broadcast:attach-file/, 'attach-file处理器必须保留');
assert.match(main, /broadcast:drop-file/, 'drop-file处理器必须保留');
assert.match(main, /#__hw_file_input/, 'WA媒体链隐藏input必须保留');
assert.match(main, /DOM\.setFileInputFiles/, 'File注入必须保留');
assert.match(main, /sendMediaMsgToChat/, 'HelloWorld媒体发送链路必须保留');
assert.match(main, /Input\.dispatchDragEvent/, '真实拖拽必须保留');
assert.match(main, /createFromData/, 'createFromData媒体API必须保留');
assert.match(main, /prepRawMedia/, 'prepRawMedia媒体API必须保留');

assert.equal(pkg.main, 'src/main-entry.cjs', 'Electron 必须先安装群发文件边界再加载主进程');
assert.match(entry, /installBroadcastFileBoundary\(/, '启动入口必须安装文件 capability 边界');
assert.match(entry, /require\('\.\/main\.cjs'\)/, '文件边界后必须继续加载原主进程编排');
assert.match(boundarySource, /'file:pick': null/, '旧附件 picker 必须被拦截');
assert.match(boundarySource, /'file:pick-csv': null/, '旧 CSV picker 必须被拦截');
assert.match(boundarySource, /BROADCAST_LEGACY_FILE_CHANNEL_DISABLED/, '旧 raw-path 通道必须 fail closed');
assert.match(preload, /ipcRenderer\.invoke\('file:pick-token'\)/, 'renderer 只能调用 token picker');
assert.match(preload, /ipcRenderer\.invoke\('file:pick-csv-limited'\)/, 'CSV/TXT 必须调用受限 picker');
assert.match(preload, /broadcast:send-file-token/, 'WA 文件发送必须走 token 通道');
assert.match(preload, /broadcast:attach-file-token/, '兼容附件路径必须走 token 通道');
assert.match(preload, /broadcast:drop-file-token/, 'TG/LINE 拖拽必须走 token 通道');
assert.match(preload, /filePath: file\.token/, 'renderer 兼容字段只能承载 opaque token');
assert.match(preload, /delete result\.filePath/, 'preload 发回主进程前必须删除 renderer filePath 字段');
assert.doesNotMatch(preload, /ipcRenderer\.invoke\('file:pick'\)/, 'preload 不得重新暴露旧 Base64 picker');
assert.doesNotMatch(preload, /ipcRenderer\.invoke\('broadcast:(?:send|attach|drop)-file'/, 'preload 不得调用旧 raw-path 广播通道');

function createFakeFs() {
  const record = { data: Buffer.from('hello'), size: 5, mtimeMs: 10 };
  const absolute = path.resolve('attachment.txt');
  return {
    async realpath(value) {
      if (path.resolve(value) !== absolute) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return absolute;
    },
    async stat(value) {
      if (path.resolve(value) !== absolute) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { size: record.size, mtimeMs: record.mtimeMs, isFile: () => true };
    },
    async open() { throw new Error('not used'); },
  };
}

(async () => {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(handlers.has(channel), false, `duplicate handler ${channel}`);
      handlers.set(channel, handler);
    },
  };
  const originalHandle = ipcMain.handle;
  const sender = { id: 7 };
  const mainWindow = {
    webContents: { id: 7, getURL: () => 'file:///app/ui/index.html' },
    isDestroyed: () => false,
  };
  const dialog = {
    async showOpenDialog() { return { canceled: false, filePaths: ['attachment.txt'] }; },
    async showMessageBox() { throw new Error('unexpected warning'); },
  };
  const BrowserWindow = { fromWebContents: (candidate) => candidate === sender ? mainWindow : null };

  installBroadcastFileBoundary({
    ipcMain,
    dialog,
    BrowserWindow,
    uiEntryPath: '/app/ui/index.html',
    fs: createFakeFs(),
    now: () => 1,
    randomBytes: () => Buffer.alloc(24, 4),
  });

  const originalCalls = [];
  for (const channel of ['file:pick', 'broadcast:send-file', 'broadcast:attach-file', 'broadcast:drop-file', 'file:pick-csv']) {
    ipcMain.handle(channel, async (_event, payload) => {
      originalCalls.push({ channel, payload });
      return 'OK';
    });
  }
  assert.equal(ipcMain.handle, originalHandle, '拦截全部旧通道后必须恢复 ipcMain.handle');

  const event = { sender };
  const picked = await handlers.get(CHANNELS.pickToken)(event);
  assert.deepEqual(Object.keys(picked).sort(), ['mime', 'name', 'size', 'token']);
  await assert.rejects(handlers.get('file:pick')(event), { code: 'BROADCAST_LEGACY_FILE_CHANNEL_DISABLED' });
  await assert.rejects(
    handlers.get(CHANNELS.sendFileToken)(event, { fileToken: '../attachment.txt', filePath: '/renderer/raw' }),
    { code: 'BROADCAST_FILE_TOKEN_INVALID' },
  );

  const result = await handlers.get(CHANNELS.sendFileToken)(event, {
    partition: 'persist:test',
    chatId: 'chat',
    fileToken: picked.token,
    filePath: '/renderer/raw',
    mime: 'renderer/fake',
  });
  assert.equal(result, 'OK');
  const forwarded = originalCalls.at(-1).payload;
  assert.equal(forwarded.filePath, path.resolve('attachment.txt'));
  assert.equal(forwarded.fileToken, undefined);
  assert.equal(forwarded.mime, 'text/plain');
  assert.equal(forwarded.name, 'attachment.txt');

  await assert.rejects(
    handlers.get(CHANNELS.dropFileToken)({ sender: { id: 8 } }, { fileToken: picked.token }),
    { code: 'BROADCAST_FILE_OWNER_INVALID' },
  );

  console.log('INTERNAL_CDP_INTEGRATION_CONTRACT_OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
