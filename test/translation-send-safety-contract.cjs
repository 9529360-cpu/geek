'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sanitizeTranslationOutput, assessTranslationOutput, assertSafeTranslationOutput } = require('../src/translation-output-safety.cjs');

const root = path.resolve(__dirname, '..');
const workerSource = fs.readFileSync(path.join(root, 'scripts', 'geek-translate-worker.js'), 'utf8');
const localGatewaySource = fs.readFileSync(path.join(root, 'scripts', 'local_translation_gateway.py'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');
const adapterSource = fs.readFileSync(path.join(root, 'ui', 'translation-adapters.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');

const source = '晚上好，你吃饭了吗？';
assert.equal(
  sanitizeTranslationOutput('以下是意大利语翻译：\nBuonasera, hai già mangiato?'),
  'Buonasera, hai già mangiato?',
  '必须移除中文翻译说明前缀'
);
assert.equal(
  sanitizeTranslationOutput('Sure, here is the translation in Italian:\n```\nBuonasera, hai già mangiato?\n```'),
  'Buonasera, hai già mangiato?',
  '说明前缀后的 Markdown 包装也必须移除'
);
assert.equal(
  assertSafeTranslationOutput({ source, output: 'Buonasera, hai già mangiato?', target: 'it' }),
  'Buonasera, hai già mangiato?',
  '正常意大利语译文必须通过'
);
assert.equal(
  assessTranslationOutput({ source, output: '以下是意大利语翻译：\n晚上好，你吃饭了吗？', target: 'it' }).ok,
  false,
  '清洗说明后仍照抄中文原文必须拒绝'
);
assert.equal(
  assessTranslationOutput({ source, output: source, target: 'it' }).reason,
  'UNCHANGED_SOURCE',
  '目标为外语时不得接受原文照抄'
);
assert.equal(
  assessTranslationOutput({ source: 'Good evening', output: '晚上好', target: 'zh' }).ok,
  true,
  '翻译成中文的正常结果必须通过'
);

const workerSandbox = { Response, Request, Headers, URL, TextEncoder, TextDecoder, crypto: globalThis.crypto, btoa, atob, console, setTimeout, clearTimeout };
vm.createContext(workerSandbox);
vm.runInContext(
  `${workerSource.replace(/^export default\s*/m, 'this.__worker = ')}\nthis.__validateOutput = validateTranslationOutput;`,
  workerSandbox,
  { filename: 'geek-translate-worker.js' }
);
assert.equal(
  workerSandbox.__validateOutput(source, '以下是意大利语翻译：\nBuonasera, hai già mangiato?', 'it'),
  'Buonasera, hai già mangiato?',
  '云端 Worker 必须实际清洗模型说明前缀'
);
assert.throws(
  () => workerSandbox.__validateOutput(source, '以下是意大利语翻译：\n晚上好，你吃饭了吗？', 'it'),
  /repeated source text|target script mismatch/,
  '云端 Worker 必须实际拒绝伪译文'
);

assert.match(workerSource, /You are a translation engine, not an assistant/, '云端网关必须使用严格翻译提示词');
assert.match(workerSource, /validateTranslationOutput\(text, result, target\)/, '云端每个模型结果必须质量校验后才能返回');
assert.match(localGatewaySource, /validate_translation_output\(text, result, target\)/, '本地网关也必须校验模型输出');
assert.match(mainSource, /assertSafeTranslationOutput\(\{ source: text, output: cached\.text, target \}\)/, '历史缓存必须重新校验，禁止复用脏译文');
assert.match(mainSource, /assertSafeTranslationOutput\(\{ source: text, output: result\.text, target \}\)/, '客户端主进程必须对网关结果做最终校验');

assert.match(appSource, /shouldGuardRawSend[\s\S]*翻译尚未就绪，已阻止原文发送/, 'WhatsApp 钩子未就绪时必须拦截原文');
assert.match(appSource, /live\.sendTextMsgToChat !== window\.__geekWhatsAppWrappedSend/, 'WhatsApp 必须在发送时检查翻译钩子仍然存活');
assert.match(adapterSource, /geek-telegram-translation-send[\s\S]*翻译失败，原文未发送/, 'Telegram 翻译失败必须保留原文且提示');
assert.match(adapterSource, /button\[aria-label="Send"\][\s\S]*translateAndSend\(event, composerHost\(event\), button\)/, 'LINE 必须覆盖发送按钮路径');

console.log('TRANSLATION_SEND_SAFETY_CONTRACT_OK');
