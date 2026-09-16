'use strict';

const MAIN_FRAME_IPC_SENDER_INVALID = 'MAIN_FRAME_IPC_SENDER_INVALID';

function createSenderError() {
  const error = new Error('拒绝来自非主页面的 IPC 请求');
  error.code = MAIN_FRAME_IPC_SENDER_INVALID;
  return error;
}

function assertMainFrameIpcSender(event) {
  const sender = event?.sender;
  const frame = event?.senderFrame;
  let mainFrame = null;
  try {
    mainFrame = sender?.mainFrame || null;
  } catch {
    mainFrame = null;
  }
  if (!sender || !frame || !mainFrame || frame !== mainFrame) throw createSenderError();
  return frame;
}

module.exports = {
  MAIN_FRAME_IPC_SENDER_INVALID,
  assertMainFrameIpcSender,
};
