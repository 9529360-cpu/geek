'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const {
  LINE_TRUSTED_SUBMIT_PRELOAD_ID,
  ensureLineTrustedSubmitPreload,
} = require('../src/line-trusted-submit-session.cjs');

const helperPath = path.resolve(
  __dirname,
  '../resources/extensions/line-3.5.1/geek-trusted-submit-preload.cjs',
);

const registered = [];
const scripts = [];
const session = {
  getPreloadScripts() {
    return scripts.map(item => ({ ...item }));
  },
  registerPreloadScript(script) {
    registered.push({ ...script });
    scripts.push({ ...script });
    return script.id;
  },
};

const first = ensureLineTrustedSubmitPreload(session, helperPath);
assert.deepEqual(first, {
  id: LINE_TRUSTED_SUBMIT_PRELOAD_ID,
  registered: true,
});
assert.equal(registered.length, 1);
assert.deepEqual(registered[0], {
  id: LINE_TRUSTED_SUBMIT_PRELOAD_ID,
  type: 'frame',
  filePath: helperPath,
});

const second = ensureLineTrustedSubmitPreload(session, helperPath);
assert.deepEqual(second, {
  id: LINE_TRUSTED_SUBMIT_PRELOAD_ID,
  registered: false,
});
assert.equal(registered.length, 1, 'repeated LINE attach must not stack preload registrations');

assert.throws(
  () => ensureLineTrustedSubmitPreload({
    getPreloadScripts: () => [{
      id: LINE_TRUSTED_SUBMIT_PRELOAD_ID,
      type: 'frame',
      filePath: path.resolve(__dirname, 'other-preload.cjs'),
    }],
    registerPreloadScript() {
      throw new Error('must not register over a conflicting authority');
    },
  }, helperPath),
  /LINE_TRUSTED_SUBMIT_PRELOAD_CONFLICT/,
);

assert.throws(
  () => ensureLineTrustedSubmitPreload({}, helperPath),
  /Session preload registration/,
);

console.log('LINE_TRUSTED_SUBMIT_SESSION_CONTRACT_OK');
