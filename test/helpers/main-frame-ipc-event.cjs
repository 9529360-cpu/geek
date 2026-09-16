'use strict';

function mainFrameIpcEvent(sender = {}) {
  const normalizedSender = sender && typeof sender === 'object' ? sender : {};
  const mainFrame = normalizedSender.mainFrame || {};
  normalizedSender.mainFrame = mainFrame;
  return { sender: normalizedSender, senderFrame: mainFrame };
}

module.exports = { mainFrameIpcEvent };
