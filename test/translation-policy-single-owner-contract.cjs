'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'ui', 'translation-core.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const adapterSource = fs.readFileSync(path.join(root, 'ui', 'translation-adapters.js'), 'utf8');

const context = vm.createContext({ window: {} });
vm.runInContext(coreSource, context, { filename: 'translation-core.js' });
const core = context.window.GeekTranslationCore;

const snapshot = core.createPolicySnapshot({
  source: 'remote',
  server: 'primary',
  send: true,
  sendFrom: 'zh',
  sendTo: 'it',
  displayTranslation: true,
  translationMode: 'auto',
  messageFrom: 'en',
  messageTo: 'zh',
  translateHistory: true,
  includeZh: false,
}, {
  'chat-1': {
    target: 'fr',
    route: 'backup',
    provider: 'local',
    translationMode: 'click',
  },
});

assert.equal(snapshot.default.provider, 'auto', 'legacy source selector must normalize once in TranslationCore');
assert.equal(snapshot.default.route, 'primary');
assert.equal(snapshot.default.enabled, true);
assert.equal(snapshot.default.source, 'zh');
assert.equal(snapshot.default.target, 'it');
assert.equal(snapshot.default.translateHistory, true);
assert.equal(snapshot.default.includeZh, false);
assert.equal(core.policyFor(snapshot, 'missing').target, 'it');
assert.equal(core.policyFor(snapshot, 'chat-1').target, 'fr');
assert.equal(snapshot.chats['chat-1'].provider, 'local');
assert.equal(snapshot.chats['chat-1'].route, 'backup');
assert.equal(snapshot.chats['chat-1'].translationMode, 'click');

assert.doesNotMatch(adapterSource, /provider:\s*g\.source|route:\s*g\.server/, 'guest adapters must not reinterpret legacy provider/route fields');
assert.doesNotMatch(adapterSource, /__geekTranslationConfig\.(global|chats)/, 'guest adapters must consume normalized policy snapshots');
assert.match(appSource, /function translationPolicySnapshot\(accountId\)/, 'host must own policy snapshot creation');
assert.equal((appSource.match(/const policy = translationPolicySnapshot\(account\.id\);/g) || []).length, 3, 'Telegram, LINE and WhatsApp must receive normalized policy snapshots');
assert.match(adapterSource, /intent === 'outgoing-send' \? 55000 : 35000/, 'guest bridge must outlive the 50s SendIntent deadline');
assert.match(appSource, /intent === 'outgoing-send' \? 55000 : 35000/, 'WhatsApp bridge must outlive the 50s SendIntent deadline');

console.log('TRANSLATION_POLICY_SINGLE_OWNER_CONTRACT_OK');
