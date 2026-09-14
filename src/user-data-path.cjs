'use strict';

const path = require('node:path');
const nodeFs = require('node:fs');

function prepareUserDataPath(options = {}) {
  const app = options.app;
  const fs = options.fs || nodeFs;
  const raw = String(options.userDataDir || '').trim();
  if (!app || typeof app.setPath !== 'function') throw new TypeError('app.setPath is required');
  if (!fs || typeof fs.mkdirSync !== 'function') throw new TypeError('fs.mkdirSync is required');
  if (!raw || !path.isAbsolute(raw)) throw new TypeError('userDataDir must be an absolute path');

  const userDataDir = path.resolve(raw);
  fs.mkdirSync(userDataDir, { recursive: true });
  app.setPath('userData', userDataDir);
  return userDataDir;
}

module.exports = { prepareUserDataPath };
