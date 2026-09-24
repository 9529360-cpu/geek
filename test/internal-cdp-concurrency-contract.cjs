'use strict';

const assert = require('node:assert/strict');
const { createInternalCdp } = require('../src/internal-cdp.cjs');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function guest({ id, partitionLeaf, url = 'https://web.whatsapp.com/' }) {
  const calls = [];
  let attached = false;
  const listeners = new Map();
  return {
    id,
    calls,
    session: { storagePath: `/tmp/geek/Partitions/${partitionLeaf}` },
    getURL: () => url,
    debugger: {
      isAttached: () => attached,
      async attach(version) {
        if (attached) throw new Error('already attached');
        calls.push(['attach', version]);
        attached = true;
      },
      async detach() {
        calls.push(['detach']);
        attached = false;
      },
      async sendCommand(method) {
        if (!attached) throw new Error('debugger detached during command');
        calls.push(['send', method]);
        return { method };
      },
      addListener(event, handler) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(handler);
      },
      removeListener(event, handler) { listeners.get(event)?.delete(handler); },
    },
  };
}

(async () => {
  {
    const wa = guest({ id: 1, partitionLeaf: 'webview-page-a' });
    const manager = createInternalCdp({ getAllWebContents: () => [wa], timeoutMs: 100 });
    const firstEntered = deferred();
    const releaseFirst = deferred();
    let secondEntered = false;

    const first = manager.run('persist:webview-page-a', 'whatsapp', async () => {
      firstEntered.resolve();
      await releaseFirst.promise;
      return 'first';
    });
    await firstEntered.promise;

    const second = manager.run('persist:webview-page-a', 'whatsapp', async ({ send }) => {
      secondEntered = true;
      return send('Runtime.evaluate');
    });
    await Promise.resolve();
    assert.equal(secondEntered, false, 'same-partition run must wait for the current debugger owner');

    releaseFirst.resolve();
    assert.equal(await first, 'first');
    assert.equal((await second).method, 'Runtime.evaluate');
    assert.equal(secondEntered, true);
    assert.deepEqual(
      wa.calls.map(call => call[0]),
      ['attach', 'detach', 'attach', 'send', 'detach'],
      'the queued run must acquire its own fresh debugger session after the first owner detaches',
    );
  }

  {
    const wa = guest({ id: 2, partitionLeaf: 'webview-page-b' });
    const manager = createInternalCdp({ getAllWebContents: () => [wa], timeoutMs: 100 });
    await assert.rejects(
      () => manager.run('persist:webview-page-b', 'whatsapp', async () => { throw new Error('FIRST_FAILED'); }),
      /FIRST_FAILED/,
    );
    const recovered = await manager.run('persist:webview-page-b', 'whatsapp', ({ send }) => send('Runtime.evaluate'));
    assert.equal(recovered.method, 'Runtime.evaluate', 'a rejected owner must release the partition queue');
  }

  {
    const wa = guest({ id: 3, partitionLeaf: 'webview-page-c' });
    const tg = guest({ id: 4, partitionLeaf: 'webview-page-d', url: 'https://web.telegram.org/a/' });
    const manager = createInternalCdp({ getAllWebContents: () => [wa, tg], timeoutMs: 100 });
    const releaseWa = deferred();
    const waEntered = deferred();
    let telegramCompleted = false;

    const blockedWa = manager.run('persist:webview-page-c', 'whatsapp', async () => {
      waEntered.resolve();
      await releaseWa.promise;
      return 'wa-done';
    });
    await waEntered.promise;

    const telegram = manager.run('persist:webview-page-d', 'telegram-z', async ({ send }) => {
      const result = await send('Runtime.evaluate');
      telegramCompleted = true;
      return result;
    });
    const tgResult = await telegram;
    assert.equal(tgResult.method, 'Runtime.evaluate');
    assert.equal(telegramCompleted, true, 'different partitions must not share a global CDP lock');

    releaseWa.resolve();
    assert.equal(await blockedWa, 'wa-done');
  }

  console.log('INTERNAL_CDP_CONCURRENCY_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
