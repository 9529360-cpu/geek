import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { chatPolicyFrom, effectivePolicy } from '../frontend/models/translation.mjs';

// The existing product remains an independent oracle for inheritance semantics.
// Execute its active pure module; do not duplicate normalizeConfig in this test.
const legacy = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(new URL('../../ui/translation-core.js', import.meta.url), 'utf8'), legacy);
const original = (global, chat = {}) => {
  const policy = structuredClone(legacy.window.GeekTranslationCore.normalizeConfig(global, chat));
  // The original HTML selects return strings; the native policy uses integer size.
  policy.fontSize = Number(policy.fontSize);
  return policy;
};

const local = Object.freeze({
  enabled: true, autoSend: true, target: 'it', messageAction: false,
  displayTranslation: true, translationMode: 'click', messageTarget: 'zh',
});

test('global-only translation settings inherit exactly as the original product does', () => {
  const changes = [
    { includeZh: false },
    { server: 'backup' },
    { sendFrom: 'de', messageFrom: 'fr' },
    { group: true },
    { fontSize: '15', fontColor: '#123456' },
    { source: 'auto', server: 'primary', sendFrom: 'es', messageFrom: 'it',
      group: true, includeZh: false, fontSize: '11', fontColor: '#abcdef' },
  ];
  for (const raw of changes) {
    const global = Object.freeze(original(raw));
    const expected = original(raw, local);
    const actual = effectivePolicy(global, local);
    assert.deepEqual(actual, expected, JSON.stringify(raw));
    assert.equal(actual.target, 'it');
    assert.equal(actual.messageTarget, 'zh');
  }
});

test('all seven explicit local choices remain independent when global controls change', () => {
  const raw = Object.freeze({
    send: false, sendTo: 'fr', manual: true, displayTranslation: false,
    translationMode: 'auto', messageTo: 'en', includeZh: false,
  });
  assert.deepEqual(effectivePolicy(original(raw), local), original(raw, local));

  const disabled = Object.freeze({
    enabled: false, autoSend: false, target: 'de', messageAction: false,
    displayTranslation: false, translationMode: 'click', messageTarget: 'ja',
  });
  const enabledGlobal = { send: true, manual: true, displayTranslation: true,
    translationMode: 'auto', sendTo: 'en', messageTo: 'zh' };
  assert.deepEqual(effectivePolicy(original(enabledGlobal), disabled), original(enabledGlobal, disabled));
});

test('creating an override snapshots only local choices and removing it restores current global', () => {
  const first = original({ send: true, sendTo: 'it', server: 'default', includeZh: true, fontSize: '13' });
  const override = chatPolicyFrom(first);
  assert.deepEqual(Object.keys(override).sort(), [
    'autoSend', 'displayTranslation', 'enabled', 'messageAction', 'messageTarget', 'target', 'translationMode',
  ]);
  const nextRaw = { send: false, sendTo: 'fr', server: 'backup', includeZh: false, fontSize: '15' };
  const next = original(nextRaw);
  assert.deepEqual(effectivePolicy(next, override), original(nextRaw, override));
  assert.deepEqual(effectivePolicy(next, null), original(nextRaw));
  assert.equal(override.target, 'it');
  assert.equal(first.includeZh, true);
  assert.equal(next.includeZh, false);
});
