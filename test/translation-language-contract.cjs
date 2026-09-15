'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  TRANSLATION_LANGUAGE_CODES,
  normalizeTranslationSourceLanguage,
  normalizeTranslationTargetLanguage,
  translationLanguageName,
} = require('../src/translation-language-contract.cjs');
const { assessTranslationOutput, assertSafeTranslationOutput } = require('../src/translation-output-safety.cjs');

const root = path.resolve(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'scripts', 'geek-translate-worker.js'), 'utf8');
const localGatewaySource = fs.readFileSync(path.join(root, 'scripts', 'local_translation_gateway.py'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(root, 'src', 'translation-runtime.cjs'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'ui', 'translation-settings.js'), 'utf8');

function sorted(values) { return [...values].sort(); }
function jsLanguageCodes(source) {
  const block = source.match(/const LANG_NAMES = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'Worker 必须保留 LANG_NAMES 权威投影');
  return [...block[1].matchAll(/\b([a-z]{2}):\s*['"]/g)].map(match => match[1]);
}
function pythonLanguageCodes(source) {
  const block = source.match(/LANG_NAMES = \{([\s\S]*?)\n\}/);
  assert.ok(block, '本地网关必须保留 LANG_NAMES 权威投影');
  return [...block[1].matchAll(/['"]([a-z]{2})['"]\s*:/g)].map(match => match[1]);
}
function uiLanguageCodes(source) {
  const block = source.match(/const LANGUAGES = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(block, '设置页必须保留 LANGUAGES 投影');
  return [...block[1].matchAll(/\[['"]([a-z]{2})['"]\s*,/g)].map(match => match[1]);
}

const canonical = sorted(TRANSLATION_LANGUAGE_CODES);
assert.deepEqual(sorted(jsLanguageCodes(workerSource)), canonical, 'Worker 语言集合必须与桌面契约一致');
assert.deepEqual(sorted(pythonLanguageCodes(localGatewaySource)), canonical, '本地网关语言集合必须与桌面契约一致');
assert.deepEqual(sorted(uiLanguageCodes(uiSource)), canonical, '设置页语言集合必须与桌面契约一致');
assert.equal(translationLanguageName('it'), 'Italian');
assert.equal(normalizeTranslationSourceLanguage(' IT '), 'it');
assert.equal(normalizeTranslationSourceLanguage('auto'), 'auto');
assert.equal(normalizeTranslationSourceLanguage('xx'), null);
assert.equal(normalizeTranslationTargetLanguage(' ZH '), 'zh');
assert.equal(normalizeTranslationTargetLanguage('auto'), null);
assert.equal(normalizeTranslationTargetLanguage('xx'), null);

for (const [sourceLanguage, target, text] of [
  ['en', 'it', 'Please confirm the shipment tomorrow'],
  ['it', 'de', 'Conferma la spedizione domani'],
  ['es', 'en', 'Confirma el envío mañana'],
  ['fr', 'it', 'Confirmez l’expédition demain'],
  ['de', 'it', 'Bitte bestätigen Sie die Lieferung morgen'],
]) {
  assert.equal(
    assessTranslationOutput({ source: text, output: text, sourceLanguage, target }).reason,
    'UNCHANGED_SOURCE',
    `${sourceLanguage}->${target} 明确源语言时不得接受照抄`,
  );
}
for (const invariant of ['https://example.com/a', 'sales@example.com', '12345', 'BTC', 'John', 'ACME-2026', '✅']) {
  assert.equal(
    assessTranslationOutput({ source: invariant, output: invariant, sourceLanguage: 'en', target: 'it' }).ok,
    true,
    `稳定标识符不得被 unchanged 策略误杀: ${invariant}`,
  );
}
assert.equal(
  assertSafeTranslationOutput({ source: 'Please send the invoice today', output: 'Per favore invia la fattura oggi', sourceLanguage: 'en', target: 'it' }),
  'Per favore invia la fattura oggi',
);
assert.equal(
  assessTranslationOutput({ source: 'Привет, как дела?', output: 'Привет, как дела?', sourceLanguage: 'ru', target: 'en' }).reason,
  'UNCHANGED_SOURCE',
);
assert.equal(
  assessTranslationOutput({ source: 'مرحبا كيف حالك اليوم', output: 'مرحبا كيف حالك اليوم', sourceLanguage: 'ar', target: 'en' }).reason,
  'UNCHANGED_SOURCE',
);
assert.equal(
  assessTranslationOutput({ source: '晚上好，你吃饭了吗？', output: '晚上好，你吃饭了吗？', sourceLanguage: 'auto', target: 'it' }).ok,
  false,
  'auto 源语言必须保留既有中文伪译文保护',
);

const workerSandbox = { Response, Request, Headers, URL, TextEncoder, TextDecoder, crypto: globalThis.crypto, btoa, atob, console, setTimeout, clearTimeout };
vm.createContext(workerSandbox);
vm.runInContext(
  `${workerSource.replace(/^export default\s*/m, 'this.__worker = ')}\nthis.__buildMessages = buildMessages; this.__validateOutput = validateTranslationOutput;`,
  workerSandbox,
  { filename: 'geek-translate-worker.js' },
);
const explicitPrompt = workerSandbox.__buildMessages('sale', 'it', 'en')[0].content;
assert.match(explicitPrompt, /source language is Italian \(it\)/, '明确源语言必须进入每个 provider 的系统指令');
assert.match(explicitPrompt, /do not auto-detect a different source language/, '明确源语言不得被 provider 重新自动识别覆盖');
const autoPrompt = workerSandbox.__buildMessages('sale', 'auto', 'en')[0].content;
assert.match(autoPrompt, /Detect the source language from the user text/, 'auto 必须明确表示模型自动识别');
assert.throws(
  () => workerSandbox.__validateOutput('Please confirm the shipment tomorrow', 'Please confirm the shipment tomorrow', 'en', 'it'),
  /repeated source text/,
  'Worker 必须拒绝非中文显式源语言的原文照抄',
);
assert.equal(
  workerSandbox.__validateOutput('https://example.com', 'https://example.com', 'en', 'it'),
  'https://example.com',
  'Worker 必须保留 URL 等稳定内容',
);

assert.match(workerSource, /const source = String\(body\.source \|\| 'auto'\)\.trim\(\)\.toLowerCase\(\)/, 'Worker 必须规范化 source');
assert.match(workerSource, /source !== 'auto' && !LANG_NAMES\[source\]/, 'Worker 必须使用与 target 相同的语言注册表校验 source');
assert.match(workerSource, /translate\(text, source, target, env, deadlineAt\)/, 'Worker source 必须进入 provider 调用链');
assert.match(workerSource, /buildMessages\(text, source, target\)/, 'Worker prompt 必须消费 source');
assert.match(workerSource, /validateTranslationOutput\(text, result, source, target\)/, 'Worker 输出安全必须消费 source language');

assert.match(localGatewaySource, /source = str\(body\.get\('source', 'auto'\)\)\.strip\(\)\.lower\(\)/, '本地网关必须规范化 source');
assert.match(localGatewaySource, /source != 'auto' and source not in LANG_NAMES/, '本地网关必须校验 source');
assert.match(localGatewaySource, /translate\(text, source, target, route\)/, '本地网关 source 必须进入模型调用链');
assert.match(localGatewaySource, /validate_translation_output\(text, result, source, target\)/, '本地网关质量校验必须消费 source');

assert.match(runtimeSource, /translation-language-contract\.cjs/, '桌面 Runtime 必须使用统一语言注册表');
assert.match(runtimeSource, /normalizeTranslationSourceLanguage\(body\.source\)/, '桌面 Runtime 必须先规范化 source');
assert.match(runtimeSource, /TRANSLATION_SOURCE_INVALID/, '桌面 Runtime 必须拒绝不支持的 source');
assert.match(runtimeSource, /sourceLanguageContext = new AsyncLocalStorage\(\)/, '桌面最终质量校验必须携带 request-scoped source language');
assert.match(runtimeSource, /sourceLanguage: sourceLanguageContext\.getStore\(\) \|\| 'auto'/, '桌面质量校验必须收到有效 source language');

console.log('TRANSLATION_LANGUAGE_CONTRACT_OK');
