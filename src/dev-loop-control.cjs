'use strict';

const DEV_LOOP_CONTROL_FLAG = 'GEEK_DEV_LOOP_CONTROL';
const DEV_LOOP_CONTROL_TOKEN = 'GEEK_DEV_LOOP_TOKEN';
const DEV_LOOP_MESSAGES = Object.freeze({
  READY: 'geek:dev-loop:ready',
  EXITING: 'geek:dev-loop:exiting',
  SHUTDOWN: 'geek:dev-loop:shutdown',
  SHUTDOWN_ACK: 'geek:dev-loop:shutdown-ack',
});

function normalizeDevLoopToken(value) {
  const token = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return '';
  return token;
}

function installDevLoopControl(options = {}) {
  const {
    app,
    isPackaged = false,
    profile = '',
    env = process.env,
    processObject = process,
  } = options;

  const token = normalizeDevLoopToken(env?.[DEV_LOOP_CONTROL_TOKEN]);
  const enabled = !isPackaged
    && profile === 'development'
    && env?.[DEV_LOOP_CONTROL_FLAG] === '1'
    && token
    && processObject
    && typeof processObject.on === 'function'
    && typeof processObject.removeListener === 'function'
    && typeof processObject.send === 'function'
    && processObject.connected !== false
    && app
    && typeof app.quit === 'function';

  if (!enabled) {
    return Object.freeze({ enabled: false, dispose() {} });
  }

  let disposed = false;
  let quitting = false;

  const send = (type) => {
    if (disposed || processObject.connected === false) return false;
    try {
      processObject.send({ type, token });
      return true;
    } catch {
      return false;
    }
  };

  const onMessage = (message) => {
    if (disposed || quitting) return;
    if (!message || message.type !== DEV_LOOP_MESSAGES.SHUTDOWN || message.token !== token) return;
    quitting = true;
    send(DEV_LOOP_MESSAGES.SHUTDOWN_ACK);
    try {
      app.quit();
    } catch {
      quitting = false;
    }
  };

  const onBeforeQuit = () => {
    quitting = true;
    send(DEV_LOOP_MESSAGES.EXITING);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    processObject.removeListener('message', onMessage);
    if (typeof app.removeListener === 'function') {
      app.removeListener('before-quit', onBeforeQuit);
      app.removeListener('will-quit', dispose);
    }
  };

  processObject.on('message', onMessage);
  if (typeof app.once === 'function') {
    app.once('before-quit', onBeforeQuit);
    app.once('will-quit', dispose);
  }
  send(DEV_LOOP_MESSAGES.READY);

  return Object.freeze({ enabled: true, dispose });
}

module.exports = {
  DEV_LOOP_CONTROL_FLAG,
  DEV_LOOP_CONTROL_TOKEN,
  DEV_LOOP_MESSAGES,
  installDevLoopControl,
  normalizeDevLoopToken,
};
