'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function patch(rel, patches) {
  const file = path.join(root, rel);
  let source = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  for (const [label, before, after] of patches) {
    const first = source.indexOf(before);
    if (first < 0) throw new Error(`Missing patch anchor (${rel}): ${label}`);
    if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Ambiguous patch anchor (${rel}): ${label}`);
    source = source.slice(0, first) + after + source.slice(first + before.length);
  }
  fs.writeFileSync(file, source);
}

patch('ui/whatsapp-direct-composer-controller.js', [
  [
    'controller generation',
    '  const CONTROLLER_VERSION = 3;',
    '  const CONTROLLER_VERSION = 4;'
  ],
  [
    'retire legacy guard listener',
    "    try { page.__geekWhatsAppPublicComposerFallback?.controller?.abort?.(); } catch {}\n",
    "    try { page.__geekWhatsAppPublicComposerFallback?.controller?.abort?.(); } catch {}\n    try { page.__geekWhatsAppGuardAbort?.abort?.(); } catch {}\n"
  ],
  [
    'native queue state',
    '    let pending = null;\n',
    '    let pending = null;\n    let nativeQueue = Promise.resolve();\n'
  ],
  [
    'native send fallback owner',
    `      pending = task;\n      page.__geekWhatsAppDirectComposerLastTask = task;\n      return true;\n    };\n\n    const Abort = page.AbortController || globalThis.AbortController;`,
    `      pending = task;\n      page.__geekWhatsAppDirectComposerLastTask = task;\n      return true;\n    };\n\n    // Native WhatsApp composer fallback. app.js may still own the low-level hook\n    // for compatibility, but translated direct-send policy lives here only.\n    // This path is used when a real WhatsApp gesture bypasses the DOM owner.\n    const handleNativeSend = function (chat, rawArgs, original, thisArg) {\n      const args = Array.isArray(rawArgs) ? [...rawArgs] : [];\n      if (typeof original !== 'function') {\n        return Promise.reject(new TypeError('WhatsApp原生发送函数不可用'));\n      }\n\n      const chatId = chatIdOf(chat);\n      const text = args[0];\n      const setting = typeof text === 'string' && isDirectChat(chat, chatId)\n        ? translationSetting(chatId, text)\n        : null;\n      if (!setting) return original.call(thisArg, chat, ...args);\n\n      const run = async () => {\n        let stage = 'translation';\n        let failure = null;\n        try {\n          const translate = page.__geekTranslationRequest;\n          if (typeof translate !== 'function') {\n            throw Object.assign(new Error('翻译尚未就绪'), {\n              __geekStage: 'translation',\n              code: 'TRANSLATION_BRIDGE_UNAVAILABLE',\n              category: 'bridge',\n              retryable: true,\n            });\n          }\n\n          setPhase('native-translating');\n          const translated = await translate({\n            text,\n            source: setting.source || 'auto',\n            target: setting.target,\n            provider: setting.provider,\n            route: setting.route,\n            chatId,\n          });\n          if (!translated?.text) {\n            throw Object.assign(new Error('翻译返回为空'), {\n              __geekStage: 'translation',\n              code: 'TRANSLATION_EMPTY_RESULT',\n              category: 'gateway',\n              retryable: true,\n              status: 502,\n            });\n          }\n\n          const activeId = chatIdOf(getActiveChat());\n          if (activeId && activeId !== chatId) {\n            throw Object.assign(new Error('聊天已切换，翻译发送已取消'), { __geekStage: 'translation' });\n          }\n\n          page.__geekRememberOutgoing?.(translated.text, text);\n          args[0] = translated.text;\n          stage = 'send';\n          setPhase('native-sending');\n          const sent = await original.call(thisArg, chat, ...args);\n          diagnostics.sent += 1;\n          setPhase('sent');\n          return sent;\n        } catch (error) {\n          const failedStage = error?.__geekStage || stage;\n          if (failedStage === 'translation') {\n            failure = typeof parseFailure === 'function' ? parseFailure(error) : error;\n            setPhase('translation-error', failure);\n            if (/聊天已切换/.test(String(failure?.message || failure || ''))) {\n              notify('聊天已切换，原文未发送');\n            } else {\n              notify(typeof failureNotice === 'function'\n                ? failureNotice(failure, false)\n                : '翻译失败（未分类），原文未发送');\n            }\n          } else {\n            failure = error;\n            setPhase('send-error', error);\n            notify('WhatsApp发送失败：' + String(error?.message || error || '未知错误').slice(0, 120));\n          }\n          page.console?.error?.('[geek-whatsapp-direct-composer/native]', String(failure?.message || failure || '').slice(0, 240));\n          throw failure;\n        }\n      };\n\n      const next = nativeQueue.then(run, run);\n      nativeQueue = next.catch(() => {});\n      page.__geekWhatsAppDirectComposerLastTask = next;\n      return next;\n    };\n\n    const Abort = page.AbortController || globalThis.AbortController;`
  ],
  [
    'publish native send owner',
    '    const state = Object.freeze({ version, controller, diagnostics, handleGesture });',
    '    const state = Object.freeze({ version, controller, diagnostics, handleGesture, handleNativeSend });'
  ]
]);

patch('ui/app.js', [
  [
    'legacy text wrapper delegates to direct owner',
    `        const wrappedSendText = function (chat, ...args) {\n          const run = async () => {`,
    `        const wrappedSendText = function (chat, ...args) {\n          const directOwner = window.__geekWhatsAppDirectComposerController;\n          if (Number(directOwner?.version || 0) >= 4 && typeof directOwner?.handleNativeSend === 'function') {\n            return directOwner.handleNativeSend(chat, args, original, this);\n          }\n          const run = async () => {`
  ]
]);

patch('test/whatsapp-direct-composer-actionable-errors-contract.cjs', [
  [
    'actionable generation',
    "assert.equal(controller.CONTROLLER_VERSION, 3, 'failure discriminator diagnostics must force a fresh direct-composer generation');",
    "assert.equal(controller.CONTROLLER_VERSION, 4, 'native-send ownership cutover must force a fresh direct-composer generation');"
  ]
]);

patch('test/whatsapp-direct-composer-controller-contract.cjs', [
  [
    'guard abort fixture',
    `  const recoveryAbort = makeAbort();\n  const oldFallbackAbort = makeAbort();\n  const page = {`,
    `  const recoveryAbort = makeAbort();\n  const oldFallbackAbort = makeAbort();\n  const guardAbort = makeAbort();\n  const nativeSends = [];\n  const page = {`
  ],
  [
    'guard abort page state',
    `    __geekWhatsAppPublicComposerFallback: {\n      controller: oldFallbackAbort,\n    },\n    __geekWhatsAppWrappedSend() {},`,
    `    __geekWhatsAppPublicComposerFallback: {\n      controller: oldFallbackAbort,\n    },\n    __geekWhatsAppGuardAbort: guardAbort,\n    __geekWhatsAppWrappedSend() {},`
  ],
  [
    'fixture exports',
    `    page, chat, editor, listeners, notices, sends, remembered, clearedIntervals,\n    recoveryAbort, oldFallbackAbort,`,
    `    page, chat, editor, listeners, notices, sends, remembered, clearedIntervals, nativeSends,\n    recoveryAbort, oldFallbackAbort, guardAbort,`
  ],
  [
    'controller generation',
    '  assert.equal(controller.CONTROLLER_VERSION, 3);',
    '  assert.equal(controller.CONTROLLER_VERSION, 4);'
  ],
  [
    'guard retirement assertion',
    `    assert.equal(env.oldFallbackAbort.signal.aborted, true, 'legacy fallback listener must be retired');\n    assert.deepEqual(env.clearedIntervals, [77], 'legacy recovery timer must be retired');`,
    `    assert.equal(env.oldFallbackAbort.signal.aborted, true, 'legacy fallback listener must be retired');\n    assert.equal(env.guardAbort.signal.aborted, true, 'legacy app.js raw-send guard must be retired');\n    assert.deepEqual(env.clearedIntervals, [77], 'legacy recovery timer must be retired');`
  ],
  [
    'native fallback coverage',
    `  {\n    const env = makePage();\n    assert.equal(controller.installPageController(env.page), 'READY');\n    const lateRecovery = makeAbort();`,
    `  {\n    const env = makePage();\n    controller.installPageController(env.page);\n    const owner = env.page.__geekWhatsAppDirectComposerController;\n    const nativeOriginal = async (chat, ...args) => { env.nativeSends.push([chat, ...args]); return { id: 'native-1' }; };\n    const result = await owner.handleNativeSend(env.chat, ['hello', { preserve: true }], nativeOriginal, { native: true });\n    assert.deepEqual(result, { id: 'native-1' });\n    assert.equal(env.getTranslationCalls(), 1, 'native fallback must translate exactly once');\n    assert.equal(env.nativeSends.length, 1);\n    assert.equal(env.nativeSends[0][1], 'translated:hello', 'native fallback must never pass raw source when translation applies');\n    assert.deepEqual(env.nativeSends[0][2], { preserve: true }, 'native fallback must preserve original native send options');\n    assert.deepEqual(env.remembered, [['translated:hello', 'hello']]);\n    assert.equal(owner.diagnostics.phase, 'sent');\n  }\n\n  {\n    const env = makePage({ translationError: new Error('native translation failed') });\n    controller.installPageController(env.page);\n    const owner = env.page.__geekWhatsAppDirectComposerController;\n    const nativeOriginal = async (chat, ...args) => { env.nativeSends.push([chat, ...args]); return { id: 'native-should-not-send' }; };\n    await assert.rejects(\n      owner.handleNativeSend(env.chat, ['hello'], nativeOriginal, null),\n      /native translation failed/,\n    );\n    assert.equal(env.nativeSends.length, 0, 'native fallback must fail closed and never leak raw source');\n    assert.match(env.notices.at(-1) || '', /未分类.*原文未发送/);\n  }\n\n  {\n    const env = makePage({ translationDisabled: true });\n    controller.installPageController(env.page);\n    const owner = env.page.__geekWhatsAppDirectComposerController;\n    const nativeOriginal = async (chat, ...args) => { env.nativeSends.push([chat, ...args]); return { id: 'native-pass' }; };\n    await owner.handleNativeSend(env.chat, ['hello'], nativeOriginal, null);\n    assert.equal(env.getTranslationCalls(), 0);\n    assert.equal(env.nativeSends.length, 1);\n    assert.equal(env.nativeSends[0][1], 'hello', 'translation-off native send must remain raw/native pass-through');\n  }\n\n  {\n    const chat = makeChat('123@g.us');\n    chat.isGroup = true;\n    const env = makePage({ chat });\n    controller.installPageController(env.page);\n    const owner = env.page.__geekWhatsAppDirectComposerController;\n    const nativeOriginal = async (nativeChat, ...args) => { env.nativeSends.push([nativeChat, ...args]); return { id: 'group-pass' }; };\n    await owner.handleNativeSend(chat, ['group hello'], nativeOriginal, null);\n    assert.equal(env.getTranslationCalls(), 0);\n    assert.equal(env.nativeSends.length, 1, 'group native send must remain outside direct/private owner');\n  }\n\n  {\n    const env = makePage();\n    assert.equal(controller.installPageController(env.page), 'READY');\n    const lateRecovery = makeAbort();`
  ],
  [
    'native source contract',
    `  assert.match(controllerSource, /chat\\.sendTextMessage\\(chatId, translated\\.text, options\\)/, 'direct composer owner must use public WPP text send');\n  assert.doesNotMatch(controllerSource, /WAWebSendTextMsgChatAction|sendTextMsgToChat/, 'direct composer owner must not depend on Meta private send modules');`,
    `  assert.match(controllerSource, /chat\\.sendTextMessage\\(chatId, translated\\.text, options\\)/, 'trusted DOM path must keep public WPP text send');\n  assert.match(controllerSource, /handleNativeSend[\\s\\S]*original\\.call\\(thisArg, chat, \\.\\.\\.args\\)/, 'native fallback must preserve the native send transport behind the same controller owner');\n  assert.doesNotMatch(controllerSource, /WAWebSendTextMsgChatAction|sendTextMsgToChat/, 'controller policy must not hard-code Meta private module names');`
  ]
]);

patch('test/translation-send-safety-contract.cjs', [
  [
    'single owner delegation contract',
    `assert.match(appSource, /live\\.sendTextMsgToChat !== window\\.__geekWhatsAppWrappedSend/, 'WhatsApp 必须在发送时检查翻译钩子仍然存活');\nassert.match(adapterSource, /geek-telegram-translation-send[\\s\\S]*翻译失败，原文未发送/, 'Telegram 翻译失败必须保留原文且提示');`,
    `assert.match(appSource, /live\\.sendTextMsgToChat !== window\\.__geekWhatsAppWrappedSend/, 'WhatsApp 必须在发送时检查翻译钩子仍然存活');\nassert.match(appSource, /__geekWhatsAppDirectComposerController[\\s\\S]*handleNativeSend\\(chat, args, original, this\\)/, 'WhatsApp legacy text wrapper must delegate translated private sends to the single direct-composer owner');\nassert.match(adapterSource, /geek-telegram-translation-send[\\s\\S]*翻译失败，原文未发送/, 'Telegram 翻译失败必须保留原文且提示');`
  ]
]);

patch('e2e/specs/whatsapp-wa-js-runtime.e2e.cjs', [
  [
    'runtime native owner evidence',
    `        directComposerVersion: Number(directComposer?.version || 0),\n        directComposerReady: typeof directComposer?.handleGesture === 'function',`,
    `        directComposerVersion: Number(directComposer?.version || 0),\n        directComposerReady: typeof directComposer?.handleGesture === 'function',\n        directComposerNativeReady: typeof directComposer?.handleNativeSend === 'function',`
  ],
  [
    'runtime generation',
    '    && state?.directComposerVersion === 3\n    && state?.directComposerReady === true',
    '    && state?.directComposerVersion === 4\n    && state?.directComposerReady === true\n    && state?.directComposerNativeReady === true'
  ],
  [
    'runtime generation assertion',
    `    assert.equal(state.directComposerVersion, 3, 'direct composer controller must match the tested owner generation');\n    assert.equal(state.directComposerReady, true, 'direct composer controller must be injected into the WhatsApp guest');`,
    `    assert.equal(state.directComposerVersion, 4, 'direct composer controller must match the tested owner generation');\n    assert.equal(state.directComposerReady, true, 'direct composer controller must be injected into the WhatsApp guest');\n    assert.equal(state.directComposerNativeReady, true, 'native private-send fallback must delegate into the same controller owner');`
  ]
]);

for (const rel of [
  'scripts/apply-direct-composer-owner-cutover.cjs',
  '.github/workflows/apply-direct-composer-owner-cutover.yml',
]) {
  try { fs.unlinkSync(path.join(root, rel)); } catch {}
}

console.log('DIRECT_COMPOSER_OWNER_CUTOVER_PATCH_OK');
