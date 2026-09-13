'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n?/g, '\n');
const wrapper = read('scripts/geek-subscription-worker.js');
const core = read('scripts/geek-subscription-worker-core.js');
const gateway = read('scripts/geek-translate-worker.js');
const ipcOwner = read('src/subscription-ipc.cjs');
const preload = read('src/preload.cjs');
const subscription = read('src/subscription.cjs');
const wrangler = read('wrangler-subscription.toml');

// Translation quota has one live charging authority: the authenticated gateway.
assert.match(gateway, /async function reserveUsage\(/, 'gateway must reserve source-character quota');
assert.match(gateway, /async function finishUsage\(/, 'gateway must finalize target-character quota');
assert.match(
  gateway,
  /UPDATE users SET quota_chars = quota_chars - \? WHERE id = \? AND status = 'active' AND quota_chars >= \?/,
  'gateway reservation must remain an atomic balance-checked decrement'
);
assert.match(gateway, /INSERT INTO translation_usage/, 'gateway must keep request-level usage ownership');

// Production subscription traffic enters through the wrapper chain, not the core directly.
assert.match(wrangler, /^main = "scripts\/geek-subscription-atomic-entry\.js"$/m);
assert.match(read('scripts/geek-subscription-atomic-entry.js'), /import productionEntry from '\.\/geek-subscription-entry\.js'/);
assert.match(read('scripts/geek-subscription-entry.js'), /import baseWorker from '\.\/geek-subscription-worker\.js'/);

// Older released clients may still POST /api/usage. The active wrapper must consume
// that request before the core's historical implementation and return a read-only snapshot.
assert.match(wrapper, /async function legacyUsageCompatibilityResponse\(request, env, ctx\)/);
assert.match(wrapper, /request\.method === 'POST' && url\.pathname === '\/api\/usage'/);
assert.match(wrapper, /return legacyUsageCompatibilityResponse\(request, scopedEnv, ctx\)/);
assert.match(wrapper, /deducted:\s*0/);
assert.match(wrapper, /deprecated:\s*true/);

const compatibilityStart = wrapper.indexOf('async function legacyUsageCompatibilityResponse');
const compatibilityEnd = wrapper.indexOf('\n}\n\nexport default', compatibilityStart);
assert.ok(compatibilityStart >= 0 && compatibilityEnd > compatibilityStart, 'legacy compatibility function must be inspectable');
const compatibilityBody = wrapper.slice(compatibilityStart, compatibilityEnd);
assert.doesNotMatch(compatibilityBody, /\.prepare\s*\(/, 'legacy compatibility endpoint must not issue D1 statements');
assert.doesNotMatch(compatibilityBody, /UPDATE\s+users/i, 'legacy compatibility endpoint must never decrement quota');
assert.doesNotMatch(compatibilityBody, /request\.json\s*\(/, 'legacy compatibility endpoint must not trust client usage payloads');

const usageIntercept = wrapper.indexOf("url.pathname === '/api/usage'");
const fallback = wrapper.indexOf('return coreWorker.fetch(request, scopedEnv, ctx);');
assert.ok(usageIntercept >= 0 && fallback > usageIntercept, 'legacy usage must be intercepted before generic core fallback');

// The old core implementation is historical archaeology only. Lock the production
// interception above so its decrement cannot become active without this contract failing.
assert.match(core, /async function handleUsage\(/, 'historical core handler remains identifiable during compatibility window');
assert.match(core, /quota_chars = MAX\(0, quota_chars - \?\)/, 'test fixture must still detect the historical second-writer implementation');

// Current desktop surfaces must not expose a second accounting capability.
assert.doesNotMatch(ipcOwner, /subscription:report-usage/, 'main-process IPC owner must not expose legacy usage accounting');
assert.doesNotMatch(preload, /subscription:report-usage|reportUsage\s*:/, 'renderer bridge must not expose legacy usage accounting');
assert.doesNotMatch(subscription, /subscription:report-usage/, 'subscription store must not depend on the retired IPC channel');

console.log('SUBSCRIPTION_LEGACY_USAGE_AUTHORITY_CONTRACT_OK');
