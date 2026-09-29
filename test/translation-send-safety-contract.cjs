'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sanitizeTranslationOutput, assessTranslationOutput, assertSafeTranslationOutput } = require('../src/translation-output-safety.cjs');

const root = path.resolve(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'scripts', 'geek-translate-worker.js'), 'utf8');
const localGatewaySource = fs.readFileSync(path.join(root, 'scripts', 'local_translation_gateway.py'), 'utf8');
const runtimeOwnerSource = fs.readFileSync(path.join(root, 'src', 'translation-runtime.cjs'), 'utf8');
const runtimeBaseSource = fs.readFileSync(path.join(root, 'src', 'translation-runtime-base.cjs'), 'utf8');
const adapterSource = fs.readFileSync(path.join(root, 'ui', 'translation-adapters.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const directComposerSource = fs.readFileSync(path.join(root, 'ui', 'whatsapp-direct-composer-controller.js'), 'utf8');

const source = '晚上好，你吃饭了吗？';
assert.equal(
  sanitizeTranslationOutput('以下是意大利语翻译：\nBuonasera, hai già mangiato?'),
  'Buonasera, hai già mangiato?',
  '必须移除中文翻译说明前缀'
);
assert.equal(
  sanitizeTranslationOutput('Sure, here is the translation in Italian:\n```\nBuonasera, hai già mangiato?\n```'),
  'Buonasera, hai già mangiato?',
  '有明确 translation 元数据证据时仍必须清洗模型前缀和 Markdown 包装'
);
for (const conversational of [
  'Sure, I can help you.',
  "Certainly, I'll send it today.",
  'Of course, we can discuss this tomorrow.',
  'Certo, posso aiutarti.',
  'Buongiorno! Certamente, ne parliamo domani.',
  '“Sure, I can help you.”',
  '"Of course, we can discuss this tomorrow."',
]) {
  assert.equal(
    sanitizeTranslationOutput(conversational),
    conversational,
    `正常会话内容和引号必须原样保留: ${conversational}`
  );
}
assert.equal(
  assertSafeTranslationOutput({ source, output: 'Buonasera, hai già mangiato?', sourceLanguage: 'zh', target: 'it' }),
  'Buonasera, hai già mangiato?',
  '正常意大利语译文必须通过'
);
assert.equal(
  assessTranslationOutput({ source, output: '以下是意大利语翻译：\n晚上好，你吃饭了吗？', sourceLanguage: 'zh', target: 'it' }).ok,
  false,
  '清洗说明后仍照抄中文原文必须拒绝'
);
assert.equal(
  assessTranslationOutput({ source, output: source, sourceLanguage: 'zh', target: 'it' }).reason,
  'UNCHANGED_SOURCE',
  '目标为外语时不得接受原文照抄'
);
assert.equal(
  assessTranslationOutput({ source: 'Good evening', output: '晚上好', sourceLanguage: 'en', target: 'zh' }).ok,
  true,
  '翻译成中文的正常结果必须通过'
);

assert.equal(
  assessTranslationOutput({ source, output: 'Buonasera, hai già mangiato.', sourceLanguage: 'zh', target: 'it' }).reason,
  'QUESTION_FORM_LOST',
  'source question must not silently become a statement'
);
assert.equal(
  assertSafeTranslationOutput({ source: '\u4f60\u597d\u5417\uff1f', output: '\u0395\u03af\u03c3\u03b1\u03b9 \u03ba\u03b1\u03bb\u03ac;', sourceLanguage: 'zh', target: 'el' }),
  '\u0395\u03af\u03c3\u03b1\u03b9 \u03ba\u03b1\u03bb\u03ac;',
  'Greek target may use semicolon as question mark'
);
assert.equal(
  assertSafeTranslationOutput({ source: '\u4f60\u597d\u5417\uff1f', output: '\u0647\u0644 \u0623\u0646\u062a \u0628\u062e\u064a\u0631\u061f', sourceLanguage: 'zh', target: 'ar' }),
  '\u0647\u0644 \u0623\u0646\u062a \u0628\u062e\u064a\u0631\u061f',
  'Arabic target may use Arabic question mark'
);
assert.equal(
  assessTranslationOutput({ source: 'Today is busy.', output: 'Oggi è una giornata impegnativa.', sourceLanguage: 'en', target: 'it' }).ok,
  true,
  'declarative source must not be forced into question form'
);
const workerSandbox = { Response, Request, Headers, URL, TextEncoder, TextDecoder, crypto: globalThis.crypto, btoa, atob, console, setTimeout, clearTimeout };
vm.createContext(workerSandbox);
vm.runInContext(
  `${workerSource.replace(/^export default\s*/m, 'this.__worker = ')}\nthis.__validateOutput = validateTranslationOutput; this.__sanitizeOutput = sanitizeTranslationOutput;`,
  workerSandbox,
  { filename: 'geek-translate-worker.js' }
);
assert.equal(
  workerSandbox.__validateOutput(source, '以下是意大利语翻译：\nBuonasera, hai già mangiato?', 'zh', 'it'),
  'Buonasera, hai già mangiato?',
  '云端 Worker 必须实际清洗模型说明前缀'
);
for (const conversational of [
  'Sure, I can help you.',
  "Certainly, I'll send it today.",
  'Of course, we can discuss this tomorrow.',
  '“Sure, I can help you.”',
]) {
  assert.equal(
    workerSandbox.__sanitizeOutput(conversational),
    conversational,
    `Worker 与桌面必须一致保留正常会话内容: ${conversational}`
  );
}
assert.throws(
  () => workerSandbox.__validateOutput(source, '以下是意大利语翻译：\n晚上好，你吃饭了吗？', 'zh', 'it'),
  /repeated source text|target script mismatch/,
  '云端 Worker 必须实际拒绝伪译文'
);

assert.throws(
  () => workerSandbox.__validateOutput(source, 'Buonasera, hai già mangiato.', 'zh', 'it'),
  /lost question form/,
  'Worker must reject question-to-statement semantic drift'
);
assert.equal(
  workerSandbox.__validateOutput(source, 'Buonasera, hai già mangiato?', 'zh', 'it'),
  'Buonasera, hai già mangiato?',
  'Worker must accept preserved question form'
);
assert.match(workerSource, /You are a translation engine, not an assistant/, '云端网关必须使用严格翻译提示词');
assert.match(workerSource, /validateTranslationOutput\(text, result, source, target\)/, '云端每个模型结果必须按源\/目标语言质量校验后才能返回');
assert.match(localGatewaySource, /translation lost question form/, 'local gateway must mirror terminal question-form quality gate');
assert.match(localGatewaySource, /validate_translation_output\(text, result, source, target\)/, '本地网关也必须按源\/目标语言校验模型输出');
assert.doesNotMatch(workerSource, /\(\?:sure\|certainly\|of course\)\[,!：:\\s-\]\*\(\?:here/, 'Worker 不得再用可吞掉普通会话词的宽泛前缀');
assert.doesNotMatch(localGatewaySource, /\(\?:sure\|certainly\|of course\)\[,!：:\\s-\]\*\(\?:here/, '本地网关不得再用可吞掉普通会话词的宽泛前缀');
assert.match(runtimeOwnerSource, /translation-runtime-base\.cjs/, '公共 Runtime 必须继续经过最终质量校验事务层');
assert.match(runtimeOwnerSource, /sourceLanguageContext/, '公共 Runtime 必须把显式源语言带到最终质量校验');
assert.match(runtimeBaseSource, /assertSafeTranslationOutput\(\{ source: text, output: cached\.text, target \}\)/, '历史缓存必须重新校验，禁止复用脏译文');
assert.match(runtimeBaseSource, /assertSafeTranslationOutput\(\{ source: text, output: result\.text, target \}\)/, 'Translation Runtime 必须对网关结果做最终校验');

assert.match(appSource, /sendIntentOwnerHealthy[\s\S]*submitThroughOwner[\s\S]*shouldGuardRawSend/, 'WhatsApp must fail closed when the v9 SendIntent owner is unavailable');
assert.doesNotMatch(appSource, /const wrappedSendText = function|__geekSendQueue\.then|sendTextMsgToChat = wrappedSendText/, 'WhatsApp must not retain a second text-send owner');
assert.match(directComposerSource, /__geekTranslationRequest\(\{ text, chatId, intent: 'outgoing-send' \}\)/, 'WhatsApp trusted private sends must delegate to the shared SendIntent owner');
assert.match(appSource, /window\.api\.translation\.translate\(\{[\s\S]*intent: 'outgoing-send'/, 'WhatsApp translated private sends must preserve the outgoing-send interactive Translation Runtime class inside SendIntent');
assert.match(adapterSource, /geek-telegram-translation-send[\s\S]*翻译失败，原文未发送/, 'Telegram 翻译失败必须保留原文且提示');
assert.match(adapterSource, /button\[aria-label="Send"\][\s\S]*submitThroughOwner\(event, composerHost\(event\)\)/, 'LINE 发送按钮必须进入统一 SendIntent owner');
assert.match(adapterSource, /addEventListener\('keydown'[\s\S]*submitThroughOwner\(event, host\)/, 'LINE Enter 发送也必须进入统一 SendIntent owner');

console.log('TRANSLATION_SEND_SAFETY_CONTRACT_OK');
