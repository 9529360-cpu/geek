'use strict';
const assert = require('node:assert/strict');
const { createInternalCdp } = require('../src/internal-cdp.cjs');

function guest({ id, partitionLeaf, url, attached = false, delay = 0 }) {
  const calls = [];
  const debuggerApi = {
    isAttached: () => attached,
    attach: async (version) => { calls.push(['attach', version]); attached = true; },
    detach: async () => { calls.push(['detach']); attached = false; },
    sendCommand: async (method, params) => {
      calls.push(['send', method, params]);
      if (delay) await new Promise(r => setTimeout(r, delay));
      return { method };
    }
  };
  return {
    id, calls, debugger: debuggerApi,
    isDestroyed: () => false,
    getURL: () => url,
    session: { storagePath: `C:/Users/test/AppData/Roaming/geek/Partitions/${partitionLeaf}` }
  };
}

(async () => {
  const wa1 = guest({ id: 1, partitionLeaf: 'webview-page-a', url: 'http://127.0.0.1:1843/' });
  const wa2 = guest({ id: 2, partitionLeaf: 'webview-page-b', url: 'http://127.0.0.1:1843/' });
  const tg = guest({ id: 3, partitionLeaf: 'webview-page-c', url: 'https://web.telegram.org/a/' });
  const manager = createInternalCdp({ getAllWebContents: () => [wa1, wa2, tg], timeoutMs: 100 });

  assert.equal(manager.findGuest('persist:webview-page-b', 'whatsapp').id, 2, '必须按partition精确选中第二个WA账号');
  assert.equal(manager.findGuest('persist:webview-page-c', 'telegram-z').id, 3, '必须按partition和平台选中TG');
  assert.equal(manager.findGuest('persist:webview-page-a', 'telegram-z'), null, '平台不符不能选错账号');

  const result = await manager.run('persist:webview-page-b', 'whatsapp', send => send('Runtime.evaluate', { expression: '1+1' }));
  assert.equal(result.method, 'Runtime.evaluate');
  assert.deepEqual(wa2.calls.map(c => c[0]), ['attach', 'send', 'detach'], '自己attach必须finally detach');
  assert.equal(wa1.calls.length, 0, '不得操作其他账号');

  const blocked = createInternalCdp({ getAllWebContents: () => [wa1], timeoutMs: 100, externalDebugging: true });
  await assert.rejects(() => blocked.run('persist:webview-page-a', 'whatsapp', () => true), /外部调试端口/, '9344模式必须明确拒绝内部CDP');

  const slow = guest({ id: 4, partitionLeaf: 'webview-page-d', url: 'https://web.telegram.org/a/', delay: 100 });
  const timed = createInternalCdp({ getAllWebContents: () => [slow], timeoutMs: 10 });
  await assert.rejects(() => timed.run('persist:webview-page-d', 'telegram-z', send => send('Runtime.evaluate')), /超时/, '命令必须有超时');
  assert.equal(slow.calls.at(-1)[0], 'detach', '超时也必须detach');

  console.log('INTERNAL_CDP_CONTRACT_OK');
})().catch(err => { console.error(err); process.exit(1); });
