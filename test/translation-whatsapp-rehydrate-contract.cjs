'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adapter = fs.readFileSync(path.join(__dirname, '../ui/translation-whatsapp-rehydrate.js'), 'utf8');
const core = fs.readFileSync(path.join(__dirname, '../ui/translation-core.js'), 'utf8');
const runtimeOwner = fs.readFileSync(path.join(__dirname, '../src/translation-runtime.cjs'), 'utf8');
const runtimeBase = fs.readFileSync(path.join(__dirname, '../src/translation-runtime-base.cjs'), 'utf8');
const cacheStore = fs.readFileSync(path.join(__dirname, '../src/translation-cache-store.cjs'), 'utf8');

assert.match(core, /translation-whatsapp-rehydrate\.js/, 'translation core must load the isolated WhatsApp rehydrate module');
assert.match(adapter, /activeChatId/, 'rehydration must be keyed to the active WhatsApp chat identity');
assert.match(adapter, /next === lastChatId/, 'DOM churn inside the same chat must not repeatedly reset translation rendering');
assert.match(adapter, /__geekRefreshTranslationView/, 'chat changes must reuse the existing translation renderer instead of forking translation logic');
assert.match(adapter, /MutationObserver/, 'chat navigation must be observed without an unbounded polling loop');
assert.match(adapter, /clearTimeout\(refreshTimer\)/, 'chat-change refreshes must be debounced');
assert.match(adapter, /rootObserver\?\.disconnect/, 'rebinding a recreated WhatsApp main view must dispose the old observer');
assert.doesNotMatch(adapter, /setInterval\s*\(/, 'rehydration must not add a permanent polling loop');
assert.doesNotMatch(adapter, /localStorage|sessionStorage/, 'translation text must not be cached in renderer storage');
assert.doesNotMatch(adapter, /api\.translation|fetch\s*\(/, 'rehydration must not introduce a second translation transport');
assert.match(adapter, /intent = body\.intent === 'outgoing-send' \? 'outgoing-send' : 'message-display'/, 'WhatsApp transport must make every translation intent explicit before the host bridge');

assert.match(runtimeOwner, /translation-runtime-base\.cjs/, 'public Translation Runtime must compose the cache/gateway transaction layer');
assert.match(runtimeBase, /createTranslationCacheStore/, 'translation runtime base must delegate persistent cache I/O to the main-process cache store');
assert.match(cacheStore, /path\.join\(getUserDataDir\(\), 'Partitions', dirName, 'geek-translation-cache\.jsonl'\)/, 'translation cache remains main-process account-partition storage');
assert.match(cacheStore, /safeStorage\.encryptString/, 'translation cache remains encrypted at rest');
assert.match(
  runtimeBase,
  /subscriptionStore\.getQuota\(\)[\s\S]*if \(cached && cacheItemFresh\(cached\)\)[\s\S]*cached: true[\s\S]*enqueueRemote/,
  'authorized fresh cache hits must return before a new remote translation without bypassing quota entitlement'
);

console.log('TRANSLATION_WHATSAPP_REHYDRATE_CONTRACT_OK');
