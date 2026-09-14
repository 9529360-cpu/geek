'use strict';

const fs = require('node:fs');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function write(file, source) {
  fs.writeFileSync(file, source);
}

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one anchor, found ${count}`);
  return source.replace(before, after);
}

function replaceRange(source, startAnchor, endAnchor, replacement, label) {
  const start = source.indexOf(startAnchor);
  if (start < 0) throw new Error(`${label}: start anchor missing`);
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  if (end < 0) throw new Error(`${label}: end anchor missing`);
  if (source.indexOf(startAnchor, start + startAnchor.length) >= 0) {
    throw new Error(`${label}: start anchor is not unique`);
  }
  return source.slice(0, start) + replacement + source.slice(end);
}

const mainPath = 'src/main.cjs';
let main = read(mainPath);
const functionStart = '  async function injectWppWithRetry(wc, part) {';
const functionTail = '\n\n  });\n}\n\nlet subscriptionWindow = null;';
const nextFunction = [
  '  async function injectWppWithRetry(wc, part) {',
  '    const injectionReadinessProbe = `(async () => {',
  '      const deadline = Date.now() + 20000;',
  '      while (Date.now() < deadline) {',
  '        const W = window.WPP;',
  '        const ready = W?.isInjected === true',
  '          && W?.isReady === true',
  "          && typeof W?.loader?.moduleRequire === 'function'",
  "          && typeof W?.whatsapp?._moduleIdMap?.get === 'function';",
  '        if (ready) return true;',
  '        await new Promise(resolve => setTimeout(resolve, 250));',
  '      }',
  '      return false;',
  '    })()`;',
  '',
  '    const capabilityProbe = `(() => {',
  '      const primary = window.WPP;',
  '      const fallback = window.WAPLUS_WPP;',
  '      return {',
  "        primaryChatReady: typeof primary?.chat?.sendTextMessage === 'function'",
  "          && typeof primary?.chat?.sendFileMessage === 'function'",
  "          && typeof primary?.chat?.getActiveChat === 'function',",
  "        primaryLidGroupReady: typeof primary?.contact?.getPnLidEntry === 'function'",
  "          && typeof primary?.group?.getParticipants === 'function',",
  '        primaryStoresReady: !!primary?.whatsapp?.ChatStore && !!primary?.whatsapp?.UserPrefs,',
  '        fallbackPresent: !!fallback,',
  "        fallbackChatReady: typeof fallback?.chat?.sendTextMessage === 'function'",
  "          && typeof fallback?.chat?.sendFileMessage === 'function'",
  "          && typeof fallback?.chat?.getActiveChat === 'function',",
  "        fallbackLidGroupReady: typeof fallback?.contact?.getPnLidEntry === 'function'",
  "          && typeof fallback?.group?.getParticipants === 'function',",
  '        fallbackStoresReady: !!fallback?.whatsapp?.ChatStore && !!fallback?.whatsapp?.UserPrefs,',
  '      };',
  '    })()`;',
  '',
  '    let bundleExecuted = false;',
  '    for (let attempt = 0; attempt < 5; attempt++) {',
  '      try {',
  '        if (!bundleExecuted) {',
  "          const wppScript = await fs.readFile(path.join(__dirname, '../node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js'), 'utf-8');",
  '          await wc.executeJavaScript(wppScript);',
  '          bundleExecuted = true;',
  '        }',
  '',
  '        const injectionReady = await wc.executeJavaScript(injectionReadinessProbe).catch(() => false);',
  '        if (!injectionReady) {',
  "          const stillInjected = await wc.executeJavaScript('window.WPP?.isInjected === true').catch(() => false);",
  '          if (!stillInjected) bundleExecuted = false;',
  '          console.log(`[wpp] 第 ${attempt + 1} 次等待后 WA-JS 注入边界未就绪（bundle=${stillInjected ? \'injected\' : \'retry\'}），3 秒后重试…`);',
  '          await new Promise((resolve) => setTimeout(resolve, 3000));',
  '          continue;',
  '        }',
  '',
  '        // From here on the official WA-JS bundle owns injection lifecycle. Authenticated',
  '        // business modules and the WAPLUS compatibility bundle are independent capability',
  '        // evidence and must never force a healthy primary bundle to be injected again.',
  '        wppInjected.add(part);',
  '',
  '        try {',
  "          const waplusScript = await fs.readFile(path.join(__dirname, '../resources/waplus-wpp.js'), 'utf-8');",
  '          await wc.executeJavaScript(waplusScript);',
  '        } catch (error) {',
  "          console.log('[wpp] WAPLUS 兼容层注入失败（WA-JS 主路径保留）:', error.message);",
  '        }',
  '',
  '        const capabilityState = await wc.executeJavaScript(capabilityProbe).catch(() => null);',
  '        console.log(`[wpp] WA-JS 4.6 injection ready ${part} primaryChat=${capabilityState?.primaryChatReady === true ? \'ready\' : \'partial\'} primaryLidGroup=${capabilityState?.primaryLidGroupReady === true ? \'ready\' : \'partial\'} primaryStores=${capabilityState?.primaryStoresReady === true ? \'ready\' : \'partial\'} fallback=${capabilityState?.fallbackPresent === true ? \'present\' : \'absent\'}`);',
  '        wc.executeJavaScript(`(async () => {',
  '          for (let i = 0; i < 10; i++) {',
  "            const arrow = document.querySelector('.bulk-sender .el-icon-arrow-left');",
  "            if (arrow) { arrow.click(); return 'COLLAPSED'; }",
  '            await new Promise(r => setTimeout(r, 800));',
  '          }',
  "          return 'NO_ARROW';",
  '        })()`).catch(() => null);',
  '        return;',
  '      } catch (error) {',
  '        bundleExecuted = false;',
  "        console.log('[wpp] 注入异常:', error.message);",
  '      }',
  '      await new Promise((resolve) => setTimeout(resolve, 3000));',
  '    }',
  "    console.log('[wpp] 注入失败（5 次重试后 WA-JS 注入边界仍不可用）', part);",
  '  }',
].join('\n');
main = replaceRange(main, functionStart, functionTail, nextFunction, 'main injectWppWithRetry');
write(mainPath, main);

const runtimePath = 'e2e/specs/whatsapp-wa-js-runtime.e2e.cjs';
let runtimeSpec = read(runtimePath);
runtimeSpec = replaceOnce(runtimeSpec,
`function runtimeReady(state) {
  return state?.found === true
    && state?.rendererProbeOk === true
    && state?.version === '4.6.0'
    && state?.wppInjected === true
    && state?.wppReady === true
    && state?.loaderReady === true
    && state?.chatReady === true
    && state?.lidGroupReady === true
    && state?.storesReady === true
    && state?.fallbackReady === true;
}`,
`function injectionReady(state) {
  return state?.found === true
    && state?.rendererProbeOk === true
    && state?.version === '4.6.0'
    && state?.wppInjected === true
    && state?.wppReady === true
    && state?.loaderReady === true;
}`,
'runtime readiness predicate');
runtimeSpec = replaceOnce(runtimeSpec,
"  it('settles the exact WA-JS surface before exposing the WAPLUS fallback', async () => {",
"  it('settles WA-JS injection independently from authenticated capabilities and WAPLUS fallback', async () => {",
'runtime test title');
runtimeSpec = replaceOnce(runtimeSpec, '      return runtimeReady(state);', '      return injectionReady(state);', 'runtime wait predicate');
runtimeSpec = replaceOnce(runtimeSpec,
"      timeoutMsg: 'WA-JS 4.6/WAPLUS runtime compatibility surface did not become ready',",
"      timeoutMsg: 'WA-JS 4.6 injection boundary did not become ready',",
'runtime timeout message');
runtimeSpec = replaceOnce(runtimeSpec,
`    assert.equal(state.version, '4.6.0', 'injected WA-JS version must match the exact dependency pin');
    assert.equal(state.wppReady, true, 'WA-JS must settle before dependent compatibility code is accepted');
    assert.equal(state.loaderReady, true, 'WA-JS loader/module metadata required by composer recovery is missing');
    assert.equal(state.chatReady, true, 'WA-JS text/media/active-chat APIs are incomplete');
    assert.equal(state.lidGroupReady, true, 'WA-JS LID/group APIs are incomplete');
    assert.equal(state.storesReady, true, 'WA-JS ChatStore/UserPrefs compatibility surface is incomplete');
    assert.equal(state.fallbackReady, true, 'WAPLUS compatibility fallback surface is incomplete');
    console.log(\`WA_JS_RUNTIME version=\${state.version} injected=\${state.wppInjected} ready=\${state.wppReady} loader=\${state.loaderReady} chat=\${state.chatReady} lidGroup=\${state.lidGroupReady} stores=\${state.storesReady} fallback=\${state.fallbackReady}\`);`,
`    assert.equal(state.version, '4.6.0', 'injected WA-JS version must match the exact dependency pin');
    assert.equal(state.wppInjected, true, 'WA-JS bundle must report injected before the partition is owned');
    assert.equal(state.wppReady, true, 'WA-JS official readiness must settle');
    assert.equal(state.loaderReady, true, 'WA-JS loader/module metadata required by composer recovery is missing');
    for (const key of ['chatReady', 'lidGroupReady', 'storesReady', 'fallbackReady']) {
      assert.equal(typeof state[key], 'boolean', key + ' must remain bounded diagnostic evidence');
    }
    console.log(\`WA_JS_RUNTIME version=\${state.version} injected=\${state.wppInjected} ready=\${state.wppReady} loader=\${state.loaderReady} chat=\${state.chatReady} lidGroup=\${state.lidGroupReady} stores=\${state.storesReady} fallback=\${state.fallbackReady}\`);`,
'runtime terminal assertions');
write(runtimePath, runtimeSpec);

const migrationPath = 'test/wa-js-460-migration-contract.cjs';
let migration = read(migrationPath);
migration = replaceOnce(migration,
`assert.match(main, /W\\?\\.isReady === true[\\s\\S]*loader\\?\\.moduleRequire[\\s\\S]*_moduleIdMap\\?\\.get/, 'injection must wait for WA-JS loader metadata readiness');
assert.match(main, /sendTextMessage[\\s\\S]*sendFileMessage[\\s\\S]*getActiveChat[\\s\\S]*getPnLidEntry[\\s\\S]*getParticipants/, 'injection readiness gate must cover Geek send/LID/group surfaces');`,
`const injectionProbeStart = main.indexOf('const injectionReadinessProbe =');
const capabilityProbeStart = main.indexOf('const capabilityProbe =', injectionProbeStart);
assert.ok(injectionProbeStart >= 0 && capabilityProbeStart > injectionProbeStart, 'WA-JS injection and capability probes must have separate owners');
const injectionProbeSource = main.slice(injectionProbeStart, capabilityProbeStart);
assert.match(injectionProbeSource, /W\\?\\.isInjected === true[\\s\\S]*W\\?\\.isReady === true[\\s\\S]*loader\\?\\.moduleRequire[\\s\\S]*_moduleIdMap\\?\\.get/, 'injection ownership must wait only for official WA-JS settle + loader metadata');
for (const capability of ['sendTextMessage', 'sendFileMessage', 'getActiveChat', 'getPnLidEntry', 'getParticipants', 'ChatStore', 'UserPrefs', 'WAPLUS_WPP']) {
  assert.equal(injectionProbeSource.includes(capability), false, 'injection readiness must not depend on authenticated/fallback capability: ' + capability);
}
const capabilityProbeEnd = main.indexOf('let bundleExecuted = false;', capabilityProbeStart);
assert.ok(capabilityProbeEnd > capabilityProbeStart, 'capability probe must finish before injection retry loop');
const capabilityProbeSource = main.slice(capabilityProbeStart, capabilityProbeEnd);
for (const capability of ['sendTextMessage', 'sendFileMessage', 'getActiveChat', 'getPnLidEntry', 'getParticipants', 'ChatStore', 'UserPrefs', 'WAPLUS_WPP']) {
  assert.ok(capabilityProbeSource.includes(capability), 'capability diagnostics must retain Geek surface: ' + capability);
}
const officialBundleIndex = main.indexOf('../node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js', injectionProbeStart);
const injectionOwnerIndex = main.indexOf('wppInjected.add(part)', officialBundleIndex);
const fallbackBundleIndex = main.indexOf('../resources/waplus-wpp.js', injectionOwnerIndex);
assert.ok(officialBundleIndex >= 0 && injectionOwnerIndex > officialBundleIndex && fallbackBundleIndex > injectionOwnerIndex, 'official WA-JS injection ownership must commit before optional WAPLUS compatibility injection');`,
'migration injection ownership assertions');
migration = replaceOnce(migration,
"assert.match(main, /fallback\\?\\.chat\\?\\.sendTextMessage[\\s\\S]*fallback\\?\\.chat\\?\\.sendFileMessage[\\s\\S]*fallback\\?\\.contact\\?\\.getPnLidEntry[\\s\\S]*fallback\\?\\.group\\?\\.getParticipants/, 'WAPLUS fallback must retain text/media/LID/group compatibility');\n",
'',
'migration fallback hard gate assertion');
write(migrationPath, migration);

const windowsPath = 'test/electron-e2e-windows-whatsapp-contract.cjs';
let windowsContract = read(windowsPath);
windowsContract = replaceOnce(windowsContract,
"assert.match(whatsappRuntimeSpec, /loaderReady[\\s\\S]*chatReady[\\s\\S]*lidGroupReady[\\s\\S]*storesReady[\\s\\S]*fallbackReady/, 'WA-JS runtime gate must cover loader, send, LID/group, stores, and WAPLUS fallback');",
`assert.match(whatsappRuntimeSpec, /function injectionReady\\(state\\)[\\s\\S]*state\\?\\.loaderReady === true;/, 'WA-JS runtime gate must terminate on official injection + loader readiness');
assert.doesNotMatch(whatsappRuntimeSpec, /function injectionReady\\(state\\)[\\s\\S]{0,500}state\\?\\.(?:chatReady|lidGroupReady|storesReady|fallbackReady) === true/, 'synthetic injection gate must not require authenticated or WAPLUS capabilities');
assert.match(whatsappRuntimeSpec, /chatReady[\\s\\S]*lidGroupReady[\\s\\S]*storesReady[\\s\\S]*fallbackReady/, 'WA-JS runtime probe must retain bounded capability diagnostics without making them startup gates');`,
'Windows runtime gate assertions');
write(windowsPath, windowsContract);

for (const [file, mustContain] of [
  [mainPath, 'wppInjected.add(part)'],
  [runtimePath, 'function injectionReady(state)'],
  [migrationPath, 'injection readiness must not depend on authenticated/fallback capability'],
  [windowsPath, 'synthetic injection gate must not require authenticated or WAPLUS capabilities'],
]) {
  if (!read(file).includes(mustContain)) throw new Error(`${file}: final invariant missing: ${mustContain}`);
}
