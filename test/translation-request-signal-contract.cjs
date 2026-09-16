'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'scripts', 'geek-translate-worker.js'), 'utf8');
const wrangler = fs.readFileSync(path.join(root, 'wrangler-translate.toml'), 'utf8');

assert.match(
  wrangler,
  /^compatibility_flags = \["enable_request_signal"\]$/m,
  'Cloudflare incoming Request.signal support must be explicitly enabled for the pinned compatibility date'
);
assert.match(
  worker,
  /callerSignal\?\.addEventListener\?\.\('abort', abortFromCaller, \{ once: true \}\)/,
  'provider request must subscribe to caller cancellation'
);
assert.match(
  worker,
  /if \(error\?\.code === 'request_aborted'\) throw error;/,
  'caller cancellation must terminate same-request provider failover instead of trying another provider'
);
assert.match(
  worker,
  /if \(shouldAffectProviderHealth\(error\)\) markProviderFail/,
  'caller cancellation and request-specific quality rejection must stay out of shared provider health'
);
assert.match(
  worker,
  /if \(request\.signal\?\.aborted\) throw requestAbortedError\(request\.signal\.reason\);/,
  'cancellation observed before terminal billing must prevent finalization'
);

console.log('TRANSLATION_REQUEST_SIGNAL_CONTRACT_OK');
