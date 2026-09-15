'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'translation-core.js'), 'utf8');
const context = vm.createContext({ window: {} });
vm.runInContext(source, context, { filename: 'translation-core.js' });

const core = context.window.GeekTranslationCore;
assert.ok(core, 'translation core must expose GeekTranslationCore');

const fresh = core.normalizeConfig({}, {});
assert.equal(fresh.translationMode, 'click', 'fresh accounts must default receive translation to on-demand');
assert.equal(fresh.displayTranslation, true, 'fresh accounts must retain manual display translation capability');

const explicitAuto = core.normalizeConfig({ translationMode: 'auto' }, {});
assert.equal(explicitAuto.translationMode, 'auto', 'an explicit modern auto choice must remain enabled');

const explicitClick = core.normalizeConfig({ translationMode: 'click' }, {});
assert.equal(explicitClick.translationMode, 'click', 'an explicit modern click choice must remain on-demand');

const legacyAuto = core.normalizeConfig({ message: true }, {});
assert.equal(legacyAuto.translationMode, 'auto', 'legacy explicit receive-auto choice must remain compatible');

const legacyClick = core.normalizeConfig({ message: false }, {});
assert.equal(legacyClick.translationMode, 'click', 'legacy explicit receive-off choice must remain on-demand');

const chatOverride = core.normalizeConfig({ translationMode: 'click' }, { translationMode: 'auto' });
assert.equal(chatOverride.translationMode, 'auto', 'explicit per-chat receive-auto override must win over the global default');

const legacy = core.normalizeConfig(
  { source: 'remote', server: 'legacy-route', send: true, sendTo: 'en' },
  { provider: 'stale-provider', route: 'stale-route' }
);
assert.equal(legacy.provider, 'auto', 'stale provider must normalize to auto');
assert.equal(legacy.route, 'default', 'stale route must normalize to default');

const valid = core.normalizeConfig(
  { source: 'auto', server: 'primary' },
  { provider: 'local', route: 'backup' }
);
assert.equal(valid.provider, 'local', 'supported provider must be preserved');
assert.equal(valid.route, 'backup', 'supported route must be preserved');

console.log('TRANSLATION_CORE_CONFIG_CONTRACT_OK');
