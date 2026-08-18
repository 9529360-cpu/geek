'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const entry = fs.readFileSync(path.join(root, 'scripts/geek-subscription-entry.js'), 'utf8');
const wrangler = fs.readFileSync(path.join(root, 'wrangler-subscription.toml'), 'utf8');

assert.match(entry, /PASSWORD_ITERATIONS = 100000/, 'free Worker auth must stay within the known-working PBKDF2 budget');
assert.match(entry, /HASH_PREFIX = 'v3\$'/, 'new hashes must be versioned separately from old 310k v2 hashes');
assert.match(entry, /storedValue\.startsWith\('v2\$'\)[\s\S]{0,180}resetRequired: true/, 'old 310k hashes must fail closed into password reset instead of recomputing on Free Worker');
assert.match(entry, /rateLimited\(db, `reg:\$\{ip\}`, 5, 60\)/, 'registration rate limit must be preserved');
assert.match(entry, /rateLimited\(db, `login:\$\{ip\}`, 10, 60\)/, 'login rate limit must be preserved');
assert.match(entry, /rateLimited\(db, `reset-complete:\$\{ip\}`, 10, 3600\)/, 'password reset completion rate limit must be preserved');
assert.match(entry, /token_version = token_version \+ 1/, 'password reset must revoke previous sessions');
assert.match(entry, /HttpOnly; Secure; SameSite=Strict/, 'session cookie security attributes must be preserved');
assert.match(entry, /return baseWorker\.fetch\(request, env, ctx\)/, 'non-auth routes must stay on the existing production worker');
assert.match(entry, /baseWorker\.scheduled\(controller, env, ctx\)/, 'scheduled USDT processing must remain delegated');
assert.doesNotMatch(entry, /ADMIN_PASSWORD\s*=|JWT_SECRET\s*=/, 'hotfix entry must not embed secrets');
assert.match(wrangler, /main = "scripts\/geek-subscription-entry\.js"/, 'Wrangler must deploy the CPU-safe auth entrypoint');

console.log('ACCOUNT_FREE_WORKER_KDF_CONTRACT_OK');
