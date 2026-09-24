'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const worker = fs.readFileSync(path.join(root, 'scripts', 'geek-translate-worker.js'), 'utf8');
const entry = fs.readFileSync(path.join(root, 'scripts', 'geek-translate-entry.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'src', 'translation-runtime.cjs'), 'utf8');
const deploy = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy-translate.yml'), 'utf8');
const devFeedback = fs.readFileSync(path.join(root, 'scripts', 'dev-worker-feedback.cjs'), 'utf8');

assert.doesNotMatch(
  worker,
  /translate:user:|translate:ip:|return json\(\{ error: 'rate_limited' \}, 429/,
  'authenticated translation must not be capped by the old per-user or shared-IP request ceilings',
);
assert.doesNotMatch(
  entry + deploy + devFeedback,
  /translation-rate-limit-compat\.mjs/,
  'retired translation request-limit compatibility code must not remain in the production dependency graph',
);
assert.match(
  worker,
  /WHERE id = \? AND status = 'active' AND quota_chars >= \?/,
  'remaining authorized character quota must be the admission authority for source reservation',
);
assert.match(
  worker,
  /if \(!results\[0\]\?\.meta\?\.changes\) \{[\s\S]{0,500}return \{ ok: false, error: 'quota_exhausted' \};[\s\S]{0,80}\}/,
  'insufficient authorized quota must fail closed at the D1 reservation owner after idempotency reconciliation',
);
assert.match(
  worker,
  /function reservationErrorStatus\(error\) \{[\s\S]*?error === 'quota_exhausted'\) return 402;/,
  'quota exhaustion must continue to project as the commercial entitlement response',
);

assert.match(worker, /error\.code = 'provider_rate_limited'/, 'provider 429 classification must remain');
assert.match(worker, /st\.rateLimitedUntil = Date\.now\(\) \+ retryMs/, 'provider backoff must remain a reliability control');
assert.match(runtime, /TRANSLATION_REMOTE_LIMIT/, 'desktop bounded concurrency must remain a reliability control');
assert.match(runtime, /createTranslationSmartQueue/, 'desktop queue protection must remain enabled');

assert.match(
  entry,
  /recoverStaleTranslationReservations\(db, \{ userId, limit: 8 \}\)/,
  'authenticated requests must keep user-scoped stale reservation recovery',
);
assert.match(
  entry,
  /const response = await baseWorker\.fetch\(request, env, ctx\);/,
  'production entry must pass the authoritative D1 binding directly to the translation Worker',
);
assert.match(
  entry,
  /recoverStaleTranslationReservations\(db, \{ limit: 50 \}\)/,
  'scheduled bounded recovery must remain enabled',
);

for (const requiredPath of [
  "'scripts/geek-translate-entry.js'",
  "'scripts/geek-translate-worker.js'",
  "'scripts/translation-reservation-recovery.mjs'",
  "'wrangler-translate.toml'",
]) {
  assert.ok(deploy.includes(requiredPath), `deploy-translate must track production dependency ${requiredPath}`);
}
assert.doesNotMatch(
  deploy,
  /scripts\/atomic-rate-limit\.mjs/,
  'subscription abuse limiting must not make translation quota depend on the shared rate-limit module',
);

console.log('TRANSLATION_ENTITLEMENT_AUTHORITY_CONTRACT_OK');
