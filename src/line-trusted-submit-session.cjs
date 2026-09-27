'use strict';

const path = require('node:path');

const LINE_TRUSTED_SUBMIT_PRELOAD_ID = 'geek-line-trusted-submit';

function ensureLineTrustedSubmitPreload(session, filePath) {
  if (!session
    || typeof session.getPreloadScripts !== 'function'
    || typeof session.registerPreloadScript !== 'function') {
    throw new TypeError('LINE trusted submit preload requires Electron Session preload registration');
  }
  const absolutePath = path.resolve(String(filePath || '').trim());
  if (!path.isAbsolute(absolutePath) || !String(filePath || '').trim()) {
    throw new TypeError('LINE trusted submit preload path is required');
  }

  const existing = session.getPreloadScripts()
    .find(item => String(item?.id || '') === LINE_TRUSTED_SUBMIT_PRELOAD_ID);
  if (existing) {
    if (path.resolve(String(existing.filePath || '')) !== absolutePath || existing.type !== 'frame') {
      throw new Error('LINE_TRUSTED_SUBMIT_PRELOAD_CONFLICT');
    }
    return Object.freeze({ id: LINE_TRUSTED_SUBMIT_PRELOAD_ID, registered: false });
  }

  const id = session.registerPreloadScript({
    id: LINE_TRUSTED_SUBMIT_PRELOAD_ID,
    type: 'frame',
    filePath: absolutePath,
  });
  if (String(id || '') !== LINE_TRUSTED_SUBMIT_PRELOAD_ID) {
    throw new Error('LINE_TRUSTED_SUBMIT_PRELOAD_REGISTRATION_FAILED');
  }
  return Object.freeze({ id, registered: true });
}

module.exports = {
  LINE_TRUSTED_SUBMIT_PRELOAD_ID,
  ensureLineTrustedSubmitPreload,
};
