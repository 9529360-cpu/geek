'use strict';

const assert = require('node:assert/strict');
const {
  MAIN_FRAME_IPC_SENDER_INVALID,
  assertMainFrameIpcSender,
} = require('../src/main-frame-ipc-boundary.cjs');

function rejected(event) {
  assert.throws(
    () => assertMainFrameIpcSender(event),
    error => error?.code === MAIN_FRAME_IPC_SENDER_INVALID && /非主页面/.test(error.message),
  );
}

const mainFrame = { url: 'file:///ui/index.html' };
const sender = { id: 7, mainFrame };
assert.equal(
  assertMainFrameIpcSender({ sender, senderFrame: mainFrame }),
  mainFrame,
  'the exact sender main frame must be accepted',
);

rejected(null);
rejected({});
rejected({ sender });
rejected({ senderFrame: mainFrame });
rejected({ sender: { id: 7 }, senderFrame: mainFrame });
rejected({ sender, senderFrame: { url: mainFrame.url } });

const throwingSender = { id: 8 };
Object.defineProperty(throwingSender, 'mainFrame', {
  get() { throw new Error('destroyed sender'); },
});
rejected({ sender: throwingSender, senderFrame: mainFrame });

console.log('MAIN_FRAME_IPC_BOUNDARY_CONTRACT_OK');
