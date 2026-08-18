'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const entry = fs.readFileSync(path.join(root, 'scripts/geek-subscription-entry.js'), 'utf8');
const wrangler = fs.readFileSync(path.join(root, 'wrangler-subscription.toml'), 'utf8');

assert.doesNotMatch(entry, /PBKDF2|PASSWORD_ITERATIONS|deriveBits/, 'free Worker auth entry must not execute PBKDF2 in the request hot path');
assert.match(entry, /HASH_PREFIX = 'v4\$'/, 'new hashes must use the CPU-safe v4 scheme');
assert.match(entry, /PASSWORD_DOMAIN = 'geek-password-v4\\0'/, 'password HMAC must be purpose separated from JWT signing');
assert.match(entry, /name: 'HMAC', hash: 'SHA-256'/, 'password verifier must use HMAC-SHA-256');
assert.match(entry, /enc\.encode\(`\$\{PASSWORD_DOMAIN\}\$\{saltValue\}\\0\$\{String\(password\)\}`\)/, 'password verifier must bind both salt and password under the server-only key');
assert.match(entry, /env\.JWT_SECRET/, 'password verifier key must stay server-side');
assert.match(entry, /timingSafeEqual|diff \|= a\[i\] \^ b\[i\]/, 'password verification must use constant-time comparison');
assert.match(entry, /!storedValue\.startsWith\(HASH_PREFIX\)[\s\S]{0,260}resetRequired: looksLegacy/, 'old PBKDF2 hashes must fail closed into password reset instead of recomputing on Free Worker');
assert.match(entry, /rateLimited\(db, `reg:\$\{ip\}`, 5, 60\)/, 'registration rate limit must be preserved');
assert.match(entry, /rateLimited\(db, `login:\$\{ip\}`, 10, 60\)/, 'login rate limit must be preserved');
assert.match(entry, /rateLimited\(db, `reset-complete:\$\{ip\}`, 10, 3600\)/, 'password reset completion rate limit must be preserved');
assert.match(entry, /token_version = token_version \+ 1/, 'password reset must revoke previous sessions');
assert.match(entry, /HttpOnly; Secure; SameSite=Strict/, 'session cookie security attributes must be preserved');
assert.match(entry, /return baseWorker\.fetch\(request, env, ctx\)/, 'non-auth routes must stay on the existing production worker');
assert.match(entry, /baseWorker\.scheduled\(controller, env, ctx\)/, 'scheduled USDT processing must remain delegated');
assert.doesNotMatch(entry, /ADMIN_PASSWORD\s*=|JWT_SECRET\s*=/, 'production auth entry must not embed secrets');
assert.match(wrangler, /main = "scripts\/geek-subscription-entry\.js"/, 'Wrangler must deploy the CPU-safe auth entrypoint');

console.log('ACCOUNT_FREE_WORKER_KDF_CONTRACT_OK');
