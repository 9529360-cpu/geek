'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  TRANSLATION_LANGUAGE_CODES,
  normalizeTranslationLanguage,
} = require('../src/translation-runtime.cjs');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n?/g, '\n');
const workerSource = read('scripts/geek-translate-worker.js');
const localGatewaySource = read('scripts/local_translation_gateway.py');
const settingsSource = read('ui/translation-settings.js');
const runtimeSource = read('src/translation-runtime-base.cjs');

function mapKeys(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `missing language registry boundary: ${startMarker}`);
  return [...source.slice(start, end).matchAll(/['"]([a-z]{2})['"]\s*:/g)].map(match => match[1]).sort();
}

function uiLanguageCodes(source) {
  const start = source.indexOf('const LANGUAGES = Object.freeze([');
  const end = source.indexOf(']);', start);
  assert.ok(start >= 0 && end > start, 'translation settings language registry must remain inspectable');
  return [...source.slice(start, end).matchAll(/\[['"]([a-z]{2})['"],/g)].map(match => match[1]).sort();
}

function loadWorkerHelpers() {
  const executable = workerSource.replace(/^export default\s*/m, 'this.__worker = ')
    + '\nthis.__sourceLanguageHelpers = { buildMessages, normalizeLanguageCode };';
  const sandbox = {
    Response, Request, Headers, URL, TextEncoder, TextDecoder, crypto,
    btoa, atob, console, setTimeout, clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(executable, sandbox, { filename: 'geek-translate-worker.js' });
  return sandbox.__sourceLanguageHelpers;
}

(() => {
  const expected = [...TRANSLATION_LANGUAGE_CODES].sort();
  assert.equal(expected.length, 20, 'desktop language contract must cover every language exposed by settings');
  assert.deepEqual(uiLanguageCodes(settingsSource), expected, 'settings and desktop runtime must expose the same source/target language set');
  assert.deepEqual(mapKeys(workerSource, 'const LANG_NAMES = {', '};'), expected, 'cloud Worker must share the desktop language registry');
  assert.deepEqual(mapKeys(localGatewaySource, 'LANG_NAMES = {', '}\nLATIN_TARGETS'), expected, 'local gateway must share the desktop language registry');

  assert.equal(normalizeTranslationLanguage(' EN ', { allowAuto: true }), 'en');
  assert.equal(normalizeTranslationLanguage('AUTO', { allowAuto: true }), 'auto');
  assert.equal(normalizeTranslationLanguage('xx', { allowAuto: true }), '', 'desktop must reject unknown explicit source language codes');
  assert.equal(normalizeTranslationLanguage('auto', { allowAuto: false }), '', 'target language must never accept auto');
  assert.equal(normalizeTranslationLanguage('IT', { allowAuto: false }), 'it');
  assert.match(runtimeSource, /TRANSLATION_SOURCE_INVALID/, 'desktop runtime must surface invalid source as a typed input failure');
  assert.match(runtimeSource, /source:\s*source,\s*target,/, 'desktop cache identity must use canonical source semantics');

  const helpers = loadWorkerHelpers();
  assert.equal(helpers.normalizeLanguageCode(' EN ', true), 'en');
  assert.equal(helpers.normalizeLanguageCode('auto', true), 'auto');
  assert.equal(helpers.normalizeLanguageCode('xx', true), '');

  // "gift" is intentionally ambiguous across languages: English gift means a
  // present, while German Gift means poison. The model contract must therefore
  // receive the configured source language rather than silently auto-detecting.
  const englishGift = helpers.buildMessages('gift', 'en', 'it')[0].content;
  const germanGift = helpers.buildMessages('Gift', 'de', 'it')[0].content;
  const autoGift = helpers.buildMessages('gift', 'auto', 'it')[0].content;
  assert.match(englishGift, /source language is English \(en\)/i);
  assert.match(germanGift, /source language is German \(de\)/i);
  assert.match(englishGift, /Italian \(it\)/i);
  assert.match(germanGift, /Italian \(it\)/i);
  assert.notEqual(englishGift, germanGift, 'ambiguous text must carry different model instructions for different explicit source languages');
  assert.match(autoGift, /detect the source language automatically/i, 'auto must remain deliberate model auto-detection');
  assert.doesNotMatch(autoGift, /source language is auto/i, 'auto is behavior, not a fake language name');

  assert.match(workerSource, /const source = normalizeLanguageCode\(body\.source \|\| 'auto', true\)/, 'Worker request boundary must canonicalize source language');
  assert.match(workerSource, /if \(!source\) return json\(\{ error: 'invalid_source' \}, 400/, 'Worker must reject unsupported source codes before translation');
  assert.match(workerSource, /translate\(text, source, target, env, deadlineAt\)/, 'Worker provider chain must receive source language');

  assert.match(localGatewaySource, /def normalize_language_code\(value, allow_auto=False\):/, 'local gateway must own the same source-language normalization rule');
  assert.match(localGatewaySource, /def translate\(text, source, target, route='default'\):/, 'local gateway provider chain must receive source language');
  assert.match(localGatewaySource, /Detect the source language automatically/, 'local gateway auto mode must be explicit');
  assert.match(localGatewaySource, /The source language is \{source_language\} \(\{source\}\)/, 'local gateway explicit source must reach the provider prompt');
  assert.match(localGatewaySource, /return reply\(self, 400, \{'error': 'invalid_source'\}\)/, 'local gateway must reject unsupported source codes');

  console.log('TRANSLATION_SOURCE_LANGUAGE_CONTRACT_OK');
})();
