'use strict';

const assert = require('node:assert/strict');
const familyRegistry = require('../ui/platform-family-registry.js');

const registry = familyRegistry.create();
registry.replace([
  { type: 'whatsapp', family: 'whatsapp', name: 'WhatsApp', short: 'WA' },
  { type: 'whatsapp-pure', family: 'whatsapp', name: 'WhatsApp Pure', short: 'WAP' },
  { type: 'telegram-z', family: 'telegram', name: 'TelegramZ', short: 'TGZ' },
  { type: 'telegram-k', family: 'telegram', name: 'TelegramK', short: 'TGK' },
  { type: 'line', family: 'line', name: 'Line', short: 'LN' },
  { type: 'line-business', family: 'line', name: 'Line Business', short: 'LNB' },
  { type: 'website', family: 'website', familyLabel: '网站', name: 'Website', short: 'WEB', isWebsite: true },
  { type: 'future-pro', family: 'future-chat', name: 'Future Pro', short: 'FP' },
]);

const families = registry.families();
assert.deepEqual(Array.from(families, item => item.key), ['whatsapp', 'telegram', 'line', 'website', 'future-chat']);
assert.deepEqual(Array.from(registry.familyOf('whatsapp-pure').types), ['whatsapp', 'whatsapp-pure']);
assert.equal(registry.familyOf('telegram-k').key, 'telegram');
assert.equal(registry.familyOf('line-business').key, 'line');
assert.equal(registry.familyOf('website').label, '网站');
assert.equal(registry.familyOf('future-pro').key, 'future-chat');
assert.equal(registry.familyOf('future-pro').label, 'Future-chat');
assert.equal(registry.familyOf('missing-platform').key, 'missing-platform');
assert.equal(registry.platform('future-pro')?.family, 'future-chat');
assert.equal(Object.isFrozen(families), true);
assert.equal(Object.isFrozen(families[0].types), true);

assert.throws(
  () => registry.replace([{ type: 'dup', family: 'a' }, { type: 'dup', family: 'b' }]),
  /already registered/,
);
assert.equal(registry.familyOf('future-pro').key, 'future-chat', 'failed replacement must not corrupt the previous catalog snapshot');

const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../ui/platform-family-registry.js'), 'utf8');
assert.doesNotMatch(source, /whatsapp|telegram|line-business/i, 'renderer family registry must remain platform-agnostic');
console.log('PLATFORM_FAMILY_REGISTRY_CONTRACT_OK');
