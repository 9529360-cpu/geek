'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const {
  fingerprint,
  sendTelegramAttachmentsViaCdp,
  createTelegramNativeAttachmentHandler,
} = require('../src/telegram-native-attachments.cjs');
const { CHANNELS, installBroadcastFileBoundary } = require('../src/broadcast-files.cjs');

function createFakeCdp({ route = '#chat-a', expectedTarget = 'chat-a', files = 2, failSend = false } = {}) {
  const calls = [];
  const listeners = new Set();
  const state = { editor: false, previewCount: 0, caption: '', sent: false };
  const routeFingerprint = fingerprint(route.replace(/^#/, '').split('?')[0]);
  function emit(method, params) { for (const listener of [...listeners]) listener(method, params); }
  async function send(method, params = {}) {
    calls.push({ method, params });
    if (method === 'Runtime.evaluate') {
      const expression = String(params.expression || '');
      assert.doesNotThrow(() => new Function(`return ${expression}`));
      if (expression.includes('TG_ROUTE_FINGERPRINT')) return { result: { value: routeFingerprint } };
      if (expression.includes('TG_ATTACHMENT_STATE')) return { result: { value: { editor: state.editor, previewCount: state.previewCount, sendReady: state.editor } } };
      if (expression.includes('TG_CAPTION_FINGERPRINT')) return { result: { value: { editor: state.editor, ...fingerprint(state.caption) } } };
      if (expression.includes('TG_CLEAR_CAPTION')) { state.caption = ''; return { result: { value: true } }; }
      if (expression.includes('TG_POINT_ATTACH')) return { result: { value: { ok: true, x: 10, y: 10 } } };
      if (expression.includes('TG_POINT_PHOTO')) return { result: { value: { ok: true, x: 20, y: 20 } } };
      if (expression.includes('TG_POINT_SEND')) return { result: { value: { ok: state.editor, x: 30, y: 30 } } };
      if (expression.includes('TG_POINT_CANCEL')) return { result: { value: { ok: state.editor, x: 40, y: 40 } } };
      throw new Error(`unexpected Runtime.evaluate: ${expression.slice(0, 100)}`);
    }
    if (method === 'Input.insertText') { state.caption = String(params.text || ''); return {}; }
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') {
      if (params.x === 20) emit('Page.fileChooserOpened', { backendNodeId: 77, mode: 'selectMultiple' });
      if (params.x === 30 && !failSend) { state.sent = true; state.editor = false; state.previewCount = 0; state.caption = ''; }
      if (params.x === 40) { state.editor = false; state.previewCount = 0; state.caption = ''; }
      return {};
    }
    if (method === 'DOM.setFileInputFiles') {
      assert.equal(params.backendNodeId, 77);
      assert.equal(params.files.length, files);
      state.editor = true;
      state.previewCount = params.files.length;
      return {};
    }
    return {};
  }
  return { ctx: { send, onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); } }, calls, state, expectedTarget };
}

async function testBatchNativeSend() {
  const filePaths = [path.resolve('one.jpg'), path.resolve('two.png')];
  const caption = 'line one\nline two';
  const fake = createFakeCdp({ files: filePaths.length });
  const result = await sendTelegramAttachmentsViaCdp(fake.ctx, { filePaths, caption, targetChatId: fake.expectedTarget }, { sleep: async () => {}, intervalMs: 0, readyIntervalMs: 0, sentIntervalMs: 0, chooserTimeoutMs: 100 });
  assert.equal(result, 'SENT');
  assert.equal(fake.state.sent, true);
  const fileSets = fake.calls.filter(call => call.method === 'DOM.setFileInputFiles');
  assert.equal(fileSets.length, 1);
  assert.deepEqual(fileSets[0].params.files, filePaths);
  assert.equal(fake.calls.some(call => call.method === 'Input.dispatchDragEvent'), false);
  for (const call of fake.calls.filter(item => item.method === 'Runtime.evaluate')) {
    for (const filePath of filePaths) assert.equal(String(call.params.expression).includes(filePath), false);
    assert.equal(String(call.params.expression).includes(caption), false);
    assert.equal(String(call.params.expression).includes(fake.expectedTarget), false);
  }
  assert.equal(fake.calls.find(call => call.method === 'Input.insertText').params.text, caption);
  assert.deepEqual(fake.calls.filter(call => call.method === 'Page.setInterceptFileChooserDialog').map(call => call.params.enabled), [true, false]);
}

async function testTargetMismatchFailsBeforeChooser() {
  const fake = createFakeCdp({ route: '#other-chat', expectedTarget: 'chat-a' });
  await assert.rejects(sendTelegramAttachmentsViaCdp(fake.ctx, { filePaths: [path.resolve('one.jpg')], caption: '', targetChatId: fake.expectedTarget }, { sleep: async () => {}, intervalMs: 0, chooserTimeoutMs: 100 }), { code: 'TG_NATIVE_ATTACH_TARGET_MISMATCH' });
  assert.equal(fake.calls.some(call => call.method === 'DOM.setFileInputFiles'), false);
}

async function testFailureClearsAndCancelsEditor() {
  const fake = createFakeCdp({ files: 1, failSend: true });
  await assert.rejects(sendTelegramAttachmentsViaCdp(fake.ctx, { filePaths: [path.resolve('one.jpg')], caption: 'must-not-stay', targetChatId: fake.expectedTarget }, { sleep: async () => {}, intervalMs: 0, readyIntervalMs: 0, sentIntervalMs: 0, sentAttempts: 2, cleanupAttempts: 2, chooserTimeoutMs: 100 }), { code: 'TG_NATIVE_ATTACH_SUBMIT_NOT_CONSUMED' });
  assert.equal(fake.state.editor, false);
  assert.equal(fake.state.caption, '');
}

async function testTelegramKFailsClosed() {
  const handler = createTelegramNativeAttachmentHandler({
    getAllWebContents: () => [{
      id: 9,
      getURL: () => 'https://web.telegram.org/k/',
      session: { storagePath: path.join('/tmp', 'webview-page-k') },
      debugger: { isAttached: () => false, attach: async () => {}, detach: async () => {}, sendCommand: async () => ({}), addListener() {}, removeListener() {} },
    }],
  });
  await assert.rejects(handler.send({ partition: 'persist:webview-page-k', guestId: 9, targetChatId: 'chat-a', caption: '', files: [{ filePath: path.resolve('one.jpg'), mime: 'image/jpeg' }] }), { code: 'TG_NATIVE_ATTACH_A_GUEST_NOT_FOUND' });
}

function createFakeFs() {
  const records = new Map([[path.resolve('one.jpg'), { size: 5, mtimeMs: 10 }], [path.resolve('two.png'), { size: 7, mtimeMs: 11 }]]);
  return {
    async realpath(value) { const absolute = path.resolve(value); if (!records.has(absolute)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return absolute; },
    async stat(value) { const record = records.get(path.resolve(value)); if (!record) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return { ...record, isFile: () => true }; },
    async open() { throw new Error('not used'); },
  };
}

async function testBatchOpaqueTokenBoundary() {
  const handlers = new Map();
  const ipcMain = { handle(channel, handler) { assert.equal(handlers.has(channel), false); handlers.set(channel, handler); } };
  const uiEntryPath = path.join(__dirname, '../ui/index.html');
  const mainFrame = { url: pathToFileURL(uiEntryPath).href };
  const sender = { id: 7, mainFrame };
  const mainWindow = { webContents: { id: 7, getURL: () => mainFrame.url }, isDestroyed: () => false };
  const dialog = { async showOpenDialog() { return { canceled: false, filePaths: ['one.jpg', 'two.png'] }; }, async showMessageBox() { throw new Error('unexpected warning'); } };
  const BrowserWindow = { fromWebContents: candidate => candidate === sender ? mainWindow : null };
  const routed = [];
  const noopTransport = async () => 'OK';
  installBroadcastFileBoundary({
    ipcMain, dialog, BrowserWindow, uiEntryPath, fs: createFakeFs(), now: () => 1,
    randomBytes: (() => { let n = 1; return () => Buffer.alloc(24, n++); })(),
    sendFile: noopTransport,
    attachFile: noopTransport,
    dropFile: noopTransport,
    sendTelegramFiles: async ({ payload }) => { routed.push(payload); return 'SENT'; },
  });
  for (const channel of ['file:pick', 'broadcast:send-file', 'broadcast:attach-file', 'broadcast:drop-file', 'file:pick-csv']) {
    assert.equal(handlers.has(channel), false, `legacy raw handler must not exist: ${channel}`);
  }
  const event = { sender, senderFrame: mainFrame };
  const picked = await handlers.get(CHANNELS.pickToken)(event);
  const result = await handlers.get(CHANNELS.telegramFilesToken)(event, {
    partition: 'persist:test', guestId: 22, targetChatId: 'chat-a', caption: 'caption',
    fileTokens: picked.map(file => file.token), filePaths: ['C:/renderer/must-not-win.jpg'],
  });
  assert.equal(result, 'SENT');
  assert.deepEqual(routed[0].files.map(file => file.filePath), [path.resolve('one.jpg'), path.resolve('two.png')]);
  assert.equal('fileTokens' in routed[0], false);
  assert.equal('filePaths' in routed[0], false);
  await assert.rejects(handlers.get(CHANNELS.telegramFilesToken)({ sender: { id: 8 } }, { fileTokens: picked.map(file => file.token) }), { code: 'BROADCAST_FILE_OWNER_INVALID' });
}

async function testPreloadOnlySendsTokensForTelegramBatch() {
  const source = fs.readFileSync(path.join(__dirname, '../src/preload.cjs'), 'utf8');
  const invokes = [];
  let exposedApi;
  const fakeElectron = {
    contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'api'); exposedApi = value; } },
    ipcRenderer: { invoke(channel, payload) { invokes.push({ channel, payload }); return Promise.resolve('SENT'); }, on() {} },
  };
  vm.runInNewContext(source, { require(specifier) { if (specifier === 'electron') return fakeElectron; throw new Error(specifier); }, console, Object, String, Number, Error, Promise }, { filename: 'preload.cjs' });
  const result = await exposedApi.broadcast.sendTelegramAttachments({ partition: 'persist:test', guestId: 22, targetChatId: 'chat-a', caption: 'caption', files: [{ filePath: 'opaque-a', mime: 'image/jpeg' }, { filePath: 'opaque-b', mime: 'image/png' }] });
  assert.equal(result, 'SENT');
  const call = invokes.at(-1);
  assert.equal(call.channel, CHANNELS.telegramFilesToken);
  assert.deepEqual(Array.from(call.payload.fileTokens), ['opaque-a', 'opaque-b']);
  assert.equal('files' in call.payload, false);
  assert.equal('filePath' in call.payload, false);
  assert.equal('filePaths' in call.payload, false);
}

function testStaticIntegrationShape() {
  const boundary = fs.readFileSync(path.join(__dirname, '../src/broadcast-files.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../src/preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
  const entry = fs.readFileSync(path.join(__dirname, '../src/main-entry.cjs'), 'utf8');
  const helper = fs.readFileSync(path.join(__dirname, '../src/telegram-native-attachments.cjs'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
  assert.match(boundary, /broadcast:telegram-files-token/);
  assert.match(preload, /sendTelegramAttachments/);
  assert.match(main, /createTelegramNativeAttachmentHandler/);
  assert.doesNotMatch(entry, /createTelegramNativeAttachmentHandler/, 'Telegram transport is a main composition concern, not an early startup shim');
  assert.match(helper, /Page\.fileChooserOpened/);
  assert.match(helper, /DOM\.setFileInputFiles/);
  assert.match(helper, /#attach-menu-button/);
  assert.match(helper, /#editable-message-text-modal/);
  assert.match(helper, /icon-new-send/);
  assert.doesNotMatch(helper, /Input\.dispatchDragEvent/);
  assert.doesNotMatch(helper, /console\.(?:log|error|warn)/);
  const telegramBranchStart = ui.indexOf("if (platform.family === 'telegram')");
  const lineAttachmentStart = ui.indexOf('let attachmentReady = true;', telegramBranchStart);
  assert.ok(telegramBranchStart >= 0 && lineAttachmentStart > telegramBranchStart);
  const telegramBranch = ui.slice(telegramBranchStart, lineAttachmentStart);
  assert.match(telegramBranch, /sendTelegramAttachments/);
  assert.doesNotMatch(telegramBranch, /dropFile|adapter\.send|sleep\(3000/);
}

(async () => {
  await testBatchNativeSend();
  await testTargetMismatchFailsBeforeChooser();
  await testFailureClearsAndCancelsEditor();
  await testTelegramKFailsClosed();
  await testBatchOpaqueTokenBoundary();
  await testPreloadOnlySendsTokensForTelegramBatch();
  testStaticIntegrationShape();
  console.log('TELEGRAM_NATIVE_ATTACHMENTS_CONTRACT_OK');
})().catch(error => { console.error(error); process.exitCode = 1; });