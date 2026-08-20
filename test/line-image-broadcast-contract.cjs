'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createInternalCdp } = require('../src/internal-cdp.cjs');

const main = fs.readFileSync('src/main.cjs', 'utf8').replace(/\r\n/g, '\n');
const ui = fs.readFileSync('ui/app.js', 'utf8').replace(/\r\n/g, '\n');
const cdp = fs.readFileSync('src/internal-cdp.cjs', 'utf8').replace(/\r\n/g, '\n');

for (const marker of ['DOM.setFileInputFiles', 'PASTE_DISPATCHED', 'pastedImageList-module__image_list_item__', "targetPlatform === 'line' ? guestId : null"]) assert.ok(main.includes(marker), 'LINE host path missing: ' + marker);
for (const marker of ['submitPastedImages: (msg, beforeIds, expectedImages) =>', 'TEXT_STATE_NOT_READY', 'textStableChecks >= 3', 'pastedCleared && textCleared', "return pastedCleared ? 'LINE_TEXT_NOT_CLEARED' : 'LINE_SUBMIT_NOT_OBSERVED'", "guestId: platform.family === 'line' ? wv.getWebContentsId() : undefined"]) assert.ok(ui.includes(marker), 'LINE renderer path missing: ' + marker);
assert.ok(!ui.includes("action: 'send',\n                guestId: wv.getWebContentsId()"), 'LINE must not return to modal send-click path');
assert.ok(!ui.includes('LINE_MESSAGE_NOT_CONFIRMED'), 'message DOM ids must not block completion');
for (const marker of ['preferredGuestId', 'Number(g?.id) === Number(preferredGuestId)']) assert.ok(cdp.includes(marker), 'exact LINE guest routing missing: ' + marker);

function guest(id, partitionLeaf) {
  let attached = false;
  const calls = [];
  return {
    id,
    calls,
    getURL: () => 'chrome-extension://line/chat',
    session: { storagePath: 'C:\\Users\\test\\AppData\\Roaming\\geek\\Partitions\\' + partitionLeaf },
    debugger: {
      isAttached: () => attached,
      attach: async () => { attached = true; calls.push('attach'); },
      detach: async () => { attached = false; calls.push('detach'); },
      sendCommand: async () => { calls.push('send'); return {}; },
      addListener: () => {},
      removeListener: () => {},
    },
  };
}

(async () => {
  const a = guest(41, 'webview-page-line');
  const b = guest(42, 'webview-page-line');
  const manager = createInternalCdp({ getAllWebContents: () => [a, b], timeoutMs: 100 });
  assert.equal(manager.findGuest('persist:webview-page-line', 'line', 42)?.id, 42, 'must select exact LINE guest id');
  assert.equal(manager.findGuest('persist:webview-page-line', 'line', 99), null, 'unknown exact LINE guest id must fail closed');
  await manager.run('persist:webview-page-line', 'line', ({ send }) => send('Runtime.evaluate'), 42);
  assert.deepEqual(a.calls, [], 'must not touch sibling LINE guest');
  assert.deepEqual(b.calls, ['attach', 'send', 'detach'], 'exact LINE guest must complete CDP transaction');
  console.log('LINE_IMAGE_BROADCAST_CONTRACT_OK');
})().catch(err => { console.error(err); process.exit(1); });
