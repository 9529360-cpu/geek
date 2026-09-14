'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-subscription.yml'), 'utf8');
const smoke = fs.readFileSync(path.join(root, 'scripts/account-live-smoke.mjs'), 'utf8');

assert.doesNotMatch(workflow, /pull_request:/, 'production account smoke must never run from pull_request events');
assert.match(workflow, /scripts\/account-live-smoke\.mjs/, 'subscription deployment must run the account live smoke');
assert.match(workflow, /secrets\.CLOUDFLARE_INFRA_API_TOKEN/, 'account cleanup must use the encrypted infrastructure token');
assert.match(workflow, /issues:\s*write/, 'workflow may publish only non-sensitive smoke status to the operations issue');
assert.match(workflow, /gh issue comment 23/, 'account smoke must publish its safe status to issue 23');

assert.match(smoke, /createRequire\(import\.meta\.url\)/, 'live smoke must load the shared CommonJS URL policy through the supported ESM bridge');
assert.match(smoke, /require\('\.\.\/src\/subscription-api-url\.cjs'\)/, 'live smoke must reuse the subscription API URL policy owner');
assert.match(smoke, /normalizeSubscriptionApiBase\(process\.env\.GEEK_SUBSCRIPTION_API_URL/, 'live smoke must normalize the effective subscription API base before requests');
assert.doesNotMatch(smoke, /GEEK_SUBSCRIPTION_API_URL[^\n]+\.replace\(/, 'live smoke must not maintain an independent URL-normalization rule');
assert.match(smoke, /\/api\/register/, 'live smoke must exercise production registration');
assert.match(smoke, /\/api\/login/, 'live smoke must exercise production login');
assert.match(smoke, /\/api\/status/, 'live smoke must exercise authenticated status');
assert.match(smoke, /\/api\/me/, 'live smoke must exercise authenticated identity');
assert.match(smoke, /DELETE FROM users WHERE email = \?;/, 'live smoke must remove only its generated transient user');
assert.match(smoke, /params:\s*\[email\]/, 'cleanup must use a parameterized D1 query');
assert.doesNotMatch(smoke, /console\.log\([^\n]*(?:password|login\.payload\.token|infraToken|Authorization)/, 'live smoke must never log credential material');
assert.doesNotMatch(workflow, /\$\{\{\s*secrets\.[^}]+\}\}[^\n]*echo/, 'workflow must never echo repository secrets');

const unsafeRun = spawnSync(process.execPath, [path.join(root, 'scripts/account-live-smoke.mjs')], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    GEEK_SUBSCRIPTION_API_URL: 'http://remote.example',
    CLOUDFLARE_INFRA_API_TOKEN: '',
    CLOUDFLARE_ACCOUNT_ID: '',
  },
});
const unsafeOutput = `${unsafeRun.stdout || ''}\n${unsafeRun.stderr || ''}`;
assert.notEqual(unsafeRun.status, 0, 'remote cleartext subscription API override must terminate the smoke locally');
assert.match(unsafeOutput, /订阅服务地址不安全/, 'shared URL policy must reject remote cleartext before production smoke requests');
assert.doesNotMatch(unsafeOutput, /Missing CLOUDFLARE_INFRA_API_TOKEN/, 'URL rejection must happen before credential-dependent smoke setup');

console.log('ACCOUNT_LIVE_SMOKE_CONTRACT_OK');
