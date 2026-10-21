'use strict';

// TG/LINE 访客可见翻译的 bounded admission：与 WhatsApp rehydrate（active 2 / queue 8）同预算。
// 覆盖：突发上限、队满丢最旧、聊天切换丢弃已排队旧工作、空 chatId 不触发丢弃、
// 拒绝透传、快照预算；以及结构钉点：两适配器自动可见翻译走 admission、
// LINE 历史行带 isHistory、LINE 处理 host 的 skipped、宿主向两访客注入工厂。

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const { createVisibleTranslationAdmission } = require('../ui/translation-visible-admission.js');

const tick = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
}

async function main() {
  // 1. 突发上限：12 次提交，同一聊天，最多 2 个在途，队满丢最旧 2 个。
  {
    const admission = createVisibleTranslationAdmission();
    const started = [];
    const deferreds = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    const results = [];
    for (let index = 0; index < 12; index += 1) {
      const gate = deferred();
      deferreds.push(gate);
      results.push(admission.submit(() => {
        started.push(index);
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        return gate.promise.finally(() => { concurrent -= 1; });
      }, { chatId: 'chat-a' }).then(value => ({ index, value })));
    }
    await tick();
    assert.equal(maxConcurrent, 2, 'a dense visible-message burst must start at most two translations immediately');
    assert.deepEqual(started, [0, 1], 'visible translation must start in submission order');
    assert.deepEqual(admission.snapshot(), { active: 2, queued: 8, activeLimit: 2, queueLimit: 8, lastChatId: 'chat-a' });
    deferreds.forEach(gate => gate.resolve('ok'));
    const settled = await Promise.all(results);
    assert.equal(settled.filter(item => item.value === false).length, 2, 'exactly the overflow beyond active plus queue capacity must be discarded');
    assert.equal(settled.filter(item => item.value === 'ok').length, 10, 'admitted visible translations must resolve with their result');
    assert.equal(maxConcurrent, 2, 'draining the bounded queue must preserve the active limit');
  }

  // 2. 聊天切换：已排队旧聊天工作静默丢弃，新聊天工作随后执行。
  {
    const admission = createVisibleTranslationAdmission();
    const gates = [deferred(), deferred()];
    const outcomes = [];
    outcomes.push(admission.submit(() => gates[0].promise, { chatId: 'chat-a' }).then(value => ({ tag: 'a0', value })));
    outcomes.push(admission.submit(() => gates[1].promise, { chatId: 'chat-a' }).then(value => ({ tag: 'a1', value })));
    for (let index = 0; index < 4; index += 1) {
      outcomes.push(admission.submit(() => Promise.resolve(`a-queued-${index}`), { chatId: 'chat-a' }).then(value => ({ tag: `a-queued-${index}`, value })));
    }
    await tick();
    const switched = admission.submit(() => Promise.resolve('b-work'), { chatId: 'chat-b' });
    outcomes.push(switched.then(value => ({ tag: 'b', value })));
    gates.forEach(gate => gate.resolve('done'));
    const settled = await Promise.all(outcomes);
    assert.equal(settled.filter(item => item.value === false).length, 4, 'queued old-chat work must be discarded on chat switch');
    assert.equal(settled.find(item => item.tag === 'b').value, 'b-work', 'new-chat work must run after the switch');
  }

  // 3. 空 chatId 不触发切换丢弃；拒绝透传；快照预算可读。
  {
    const admission = createVisibleTranslationAdmission();
    const first = admission.submit(() => Promise.resolve('x'), { chatId: '' });
    const second = admission.submit(() => Promise.resolve('y'), { chatId: '' });
    assert.deepEqual(await Promise.all([first, second]), ['x', 'y'], 'empty chatId must not discard queued work');
    const failing = createVisibleTranslationAdmission();
    await assert.rejects(failing.submit(() => Promise.reject(new Error('boom')), { chatId: 'chat-c' }), /boom/, 'work rejection must propagate to the caller');
    assert.equal(failing.snapshot().active, 0, 'failed work must release its active slot');
    assert.equal(failing.snapshot().activeLimit, 2, 'admission budget must be visible in the snapshot');
    assert.equal(failing.snapshot().queueLimit, 8, 'admission queue budget must be visible in the snapshot');
  }

  // 4. 结构钉点：两适配器 + 宿主注入 + 脚本加载顺序。
  const adapters = fs.readFileSync(path.join(root, 'ui', 'translation-adapters.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
  assert.match(adapters, /__geekVisibleAdmissionFactory/, 'guest adapters must use the injected visible-admission factory when present');
  assert.match(adapters, /visibleAdmission\.submit\(request, \{ chatId: cid \}\)/, 'auto visible translation must go through bounded admission');
  assert.match(adapters, /box\.onclick = \(\) => run\(true\)/, 'user-initiated Telegram translation must bypass background admission');
  assert.match(adapters, /box\.addEventListener\('click', \(\) => run\(true\)\)/, 'user-initiated LINE translation must bypass background admission');
  assert.match(adapters, /process\(root, isHistory\)/, 'LINE history rows must be labeled at scan time');
  assert.match(adapters, /isHistory, translateHistory: explicit \? true : !!setting\.translateHistory/, 'LINE history rows must carry explicit history intent and explicit clicks must not be skipped');
  assert.match(adapters, /if \(result\?\.skipped\) \{ box\.remove\(\); delete row\.dataset\.geekLineTranslationState; return; \}/, 'LINE must silently drop host-skipped history translations');
  assert.match(app, /syncTelegramTranslationCfgToWebview[\s\S]*__geekVisibleAdmissionFactory/, 'host must inject the admission factory into the Telegram guest before the adapter');
  assert.match(app, /syncLineTranslationCfgToWebview[\s\S]*__geekVisibleAdmissionFactory/, 'host must inject the admission factory into the LINE guest before the adapter');
  const admissionScriptAt = index.indexOf('<script src="translation-visible-admission.js"></script>');
  const adaptersScriptAt = index.indexOf('<script src="translation-adapters.js"></script>');
  assert.ok(admissionScriptAt >= 0, 'renderer must load the visible-admission module');
  assert.ok(adaptersScriptAt > admissionScriptAt, 'admission module must load before the adapters that reference its factory');
}

main().then(
  () => console.log('TRANSLATION_VISIBLE_ADMISSION_CONTRACT_OK'),
  error => { console.error(error); process.exit(1); },
);
