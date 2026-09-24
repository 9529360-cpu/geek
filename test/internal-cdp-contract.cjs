'use strict';
const assert = require('node:assert/strict');
const { createInternalCdp, storagePathLeaf } = require('../src/internal-cdp.cjs');

function guest({ id, partitionLeaf, url, attached = false, delay = 0, storagePath }) {
  const calls = [];
  const eventListeners = new Map();
  const debuggerApi = {
    isAttached: () => attached,
    attach: async (version) => { calls.push(['attach', version]); attached = true; },
    detach: async () => { calls.push(['detach']); attached = false; },
    sendCommand: async (method, params) => {
      calls.push(['send', method, params]);
      if (delay) await new Promise(r => setTimeout(r, delay));
      return { method };
    },
    addListener: (event, handler) => { if (!eventListeners.has(event)) eventListeners.set(event, new Set()); eventListeners.get(event).add(handler); },
    removeListener: (event, handler) => { eventListeners.get(event)?.delete(handler); },
    emit: (event, ...args) => { for (const h of eventListeners.get(event) || []) h(...args); }
  };
  return {
    id, calls, debugger: debuggerApi,
    isDestroyed: () => false,
    getURL: () => url,
    session: { storagePath: storagePath || `/home/test/.config/geek/Partitions/${partitionLeaf}` }
  };
}

(async () => {
  assert.equal(storagePathLeaf('C:\\Users\\test\\AppData\\Roaming\\geek\\Partitions\\webview-page-win'), 'webview-page-win', 'Windows 反斜杠 storagePath 必须提取 partition leaf');
  assert.equal(storagePathLeaf('/home/test/.config/geek/Partitions/webview-page-posix'), 'webview-page-posix', 'POSIX storagePath 必须提取 partition leaf');
  assert.equal(storagePathLeaf('C:\\Users\\test\\AppData\\Roaming\\geek\\Partitions\\webview-page-win\\'), 'webview-page-win', '尾部分隔符不能破坏 partition leaf');
  assert.equal(storagePathLeaf(''), '', '空 storagePath 必须 fail closed');

  const wa1 = guest({ id: 1, partitionLeaf: 'webview-page-a', url: 'https://web.whatsapp.com/' });
  const wa2 = guest({
    id: 2,
    partitionLeaf: 'webview-page-b',
    url: 'https://web.whatsapp.com/',
    storagePath: 'C:\\Users\\test\\AppData\\Roaming\\geek\\Partitions\\webview-page-b',
  });
  const tg = guest({
    id: 3,
    partitionLeaf: 'webview-page-c',
    url: 'https://web.telegram.org/a/',
    storagePath: 'C:\\Users\\test\\AppData\\Roaming\\geek\\Partitions\\webview-page-c',
  });
  const manager = createInternalCdp({ getAllWebContents: () => [wa1, wa2, tg], timeoutMs: 100 });

  assert.equal(manager.findGuest('persist:webview-page-b', 'whatsapp').id, 2, '必须按真实 Windows storagePath + partition 精确选中第二个 WA 账号');
  assert.equal(manager.findGuest('persist:webview-page-c', 'telegram-z').id, 3, '必须按真实 Windows storagePath + partition + 平台选中 TG');
  assert.equal(manager.findGuest('persist:webview-page-a', 'whatsapp').id, 1, 'POSIX storagePath 兼容必须保留');
  assert.equal(manager.findGuest('persist:webview-page-a', 'telegram-z'), null, '平台不符不能选错账号');
  assert.equal(manager.findGuest('persist:webview-page-missing', 'whatsapp'), null, '未知 partition 必须 fail closed');

  const result = await manager.run('persist:webview-page-b', 'whatsapp', async ({ send }) => send('Runtime.evaluate', { expression: '1+1' }));
  assert.equal(result.method, 'Runtime.evaluate');
  assert.deepEqual(wa2.calls.map(c => c[0]), ['attach', 'send', 'detach'], '自己 attach 必须 finally detach');
  assert.equal(wa1.calls.length, 0, '不得操作其他账号');

  const eventSeen = [];
  await manager.run('persist:webview-page-b', 'whatsapp', async ({ send, onEvent }) => {
    onEvent((method) => { eventSeen.push(method); });
    wa2.debugger.emit('message', null, 'Page.fileChooserOpened', { backendNodeId: 7 });
    return send('Runtime.evaluate');
  });
  assert.deepEqual(eventSeen, ['Page.fileChooserOpened'], 'onEvent 必须收到 debugger 事件');

  const blocked = createInternalCdp({ getAllWebContents: () => [wa1], timeoutMs: 100, externalDebugging: true });
  await assert.rejects(() => blocked.run('persist:webview-page-a', 'whatsapp', () => true), /外部调试端口/, '9344 模式必须明确拒绝内部 CDP');

  const slow = guest({ id: 4, partitionLeaf: 'webview-page-d', url: 'https://web.telegram.org/a/', delay: 100 });
  const timed = createInternalCdp({ getAllWebContents: () => [slow], timeoutMs: 10 });
  await assert.rejects(() => timed.run('persist:webview-page-d', 'telegram-z', ({ send }) => send('Runtime.evaluate')), /超时/, '命令必须有超时');
  assert.equal(slow.calls.at(-1)[0], 'detach', '超时也必须 detach');

  console.log('INTERNAL_CDP_CONTRACT_OK');
})().catch(err => { console.error(err); process.exit(1); });
