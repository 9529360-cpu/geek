'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const abs = (file) => path.join(root, file);
const read = (file) => fs.readFileSync(abs(file), 'utf8');
const write = (file, value) => fs.writeFileSync(abs(file), value, 'utf8');
const replaceOne = (source, from, to, label) => {
  const first = source.indexOf(from);
  assert.ok(first >= 0, `${label}: source fragment missing`);
  assert.equal(source.indexOf(from, first + from.length), -1, `${label}: source fragment must be unique`);
  return source.slice(0, first) + to + source.slice(first + from.length);
};
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: 'inherit' });

let main = read('src/main.cjs');
main = replaceOne(
  main,
`        let wppReady = await wc.executeJavaScript(readinessProbe).catch(() => false);
        if (!wppReady) {
          const wppScript = await fs.readFile(path.join(__dirname, '../node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js'), 'utf-8');
          await wc.executeJavaScript(wppScript);
          wppReady = await wc.executeJavaScript(readinessProbe).catch(() => false);
        }`,
`        const wppScript = await fs.readFile(path.join(__dirname, '../node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js'), 'utf-8');
        await wc.executeJavaScript(wppScript);
        const wppReady = await wc.executeJavaScript(readinessProbe).catch(() => false);`,
  'cold-start inject-before-wait ordering'
);
main = replaceOne(
  main,
`            && !!primary?.whatsapp?.UserPrefs
            && typeof fallback?.chat?.sendTextMessage === 'function';`,
`            && !!primary?.whatsapp?.UserPrefs
            && typeof fallback?.chat?.sendTextMessage === 'function'
            && typeof fallback?.chat?.sendFileMessage === 'function'
            && typeof fallback?.contact?.getPnLidEntry === 'function'
            && typeof fallback?.group?.getParticipants === 'function'
            && !!fallback?.whatsapp?.ChatStore
            && !!fallback?.whatsapp?.UserPrefs;`,
  'WAPLUS fallback compatibility gate'
);
write('src/main.cjs', main);

let app = read('ui/app.js');
app = replaceOne(
  app,
  `const pair = await W.contact.getPnLidEntry(id);\n                    if (pair && pair.pn) id = String(pair.pn._serialized || pair.pn);`,
  `const pair = await W.contact.getPnLidEntry(id);\n                    const phoneNumber = pair?.phoneNumber || pair?.pn;\n                    if (phoneNumber) id = String(phoneNumber._serialized || phoneNumber);`,
  'ui/app.js LID phone-number mapping'
);
app = replaceOne(
  app,
  '// window.WPP（wppconnect 官方）+ window.WAPLUS_WPP（HelloWorld fork——sendFileMessage 可用）',
  '// window.WPP（WA-JS 4.6 主路径）+ window.WAPLUS_WPP（HelloWorld fork，仅作兼容回退）',
  'WA-JS/WAPLUS authority comment'
);
app = replaceOne(
  app,
  '// 电子名片：使用 WPP 4.3 官方 API，避免旧内部 SendAction 返回 Promise 但消息不落地',
  '// 电子名片：使用 WA-JS 4.6 官方 API，避免旧内部 SendAction 返回 Promise 但消息不落地',
  'vCard WA-JS version comment'
);
write('ui/app.js', app);

let runtime = read('ui/broadcast-runtime.js');
runtime = replaceOne(
  runtime,
  `const pair = await W.contact.getPnLidEntry(id);\n                if (pair && pair.pn) id = String(pair.pn._serialized || pair.pn);`,
  `const pair = await W.contact.getPnLidEntry(id);\n                const phoneNumber = pair?.phoneNumber || pair?.pn;\n                if (phoneNumber) id = String(phoneNumber._serialized || phoneNumber);`,
  'broadcast runtime LID phone-number mapping'
);
write('ui/broadcast-runtime.js', runtime);

let contract = read('test/wa-js-460-migration-contract.cjs');
contract = replaceOne(
  contract,
  "assert.match(main, /waplus-wpp\\.js/, 'WAPLUS compatibility bundle must remain wired');",
  "assert.match(main, /fallback\\?\\.chat\\?\\.sendTextMessage[\\s\\S]*fallback\\?\\.chat\\?\\.sendFileMessage[\\s\\S]*fallback\\?\\.contact\\?\\.getPnLidEntry[\\s\\S]*fallback\\?\\.group\\?\\.getParticipants/, 'WAPLUS fallback must retain text/media/LID/group compatibility');\nassert.match(app, /pair\\?\\.phoneNumber \\|\\| pair\\?\\.pn/, 'group-member LID mapping must prefer WA-JS 4.6 phoneNumber and retain legacy fallback');\nassert.match(runtime, /pair\\?\\.phoneNumber \\|\\| pair\\?\\.pn/, 'broadcast LID mapping must prefer WA-JS 4.6 phoneNumber and retain legacy fallback');\nassert.match(main, /waplus-wpp\\.js/, 'WAPLUS compatibility bundle must remain wired');",
  'WAPLUS and LID executable compatibility contracts'
);
write('test/wa-js-460-migration-contract.cjs', contract);

const runtimeSpec = `'use strict';

const assert = require('node:assert/strict');

const PARTITION = 'persist:webview-page-e2e-account-a';
const GUEST_TIMEOUT_MS = 10_000;
const RUNTIME_TIMEOUT_MS = 45_000;
const RENDERER_PROBE_TIMEOUT_MS = 2_000;

async function probeGuestRuntime() {
  return browser.electron.execute(async (electron, partition, probeTimeoutMs) => {
    const leaf = String(partition).split(':').pop();
    const guests = electron.webContents.getAllWebContents().filter((contents) => {
      try {
        const storagePath = String(contents.session?.storagePath || '').replace(/[\\\\/]+$/, '');
        return String(contents.session?.partition || '') === partition
          && storagePath.split(/[\\\\/]/).pop() === leaf
          && contents.getType?.() === 'webview'
          && !contents.isDestroyed();
      } catch {
        return false;
      }
    });
    if (guests.length !== 1) return { found: false, guestCount: Math.min(guests.length, 9) };

    const guest = guests[0];
    let timeoutId;
    const pageProbe = guest.executeJavaScript(\`(() => {
      const W = window.WPP;
      const fallback = window.WAPLUS_WPP;
      return {
        rendererProbeOk: true,
        version: String(W?.version || ''),
        wppInjected: W?.isInjected === true,
        wppReady: W?.isReady === true,
        loaderReady: typeof W?.loader?.moduleRequire === 'function'
          && typeof W?.whatsapp?._moduleIdMap?.get === 'function',
        chatReady: typeof W?.chat?.sendTextMessage === 'function'
          && typeof W?.chat?.sendFileMessage === 'function'
          && typeof W?.chat?.getActiveChat === 'function',
        lidGroupReady: typeof W?.contact?.getPnLidEntry === 'function'
          && typeof W?.group?.getParticipants === 'function',
        storesReady: !!W?.whatsapp?.ChatStore && !!W?.whatsapp?.UserPrefs,
        fallbackReady: typeof fallback?.chat?.sendTextMessage === 'function'
          && typeof fallback?.chat?.sendFileMessage === 'function'
          && typeof fallback?.contact?.getPnLidEntry === 'function'
          && typeof fallback?.group?.getParticipants === 'function'
          && !!fallback?.whatsapp?.ChatStore
          && !!fallback?.whatsapp?.UserPrefs,
      };
    })()\`, true).catch(() => ({ rendererProbeFailed: true }));
    const probeTimeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve({ rendererProbeTimedOut: true }), probeTimeoutMs);
    });
    const page = await Promise.race([pageProbe, probeTimeout]);
    clearTimeout(timeoutId);
    return { found: true, ...page };
  }, PARTITION, RENDERER_PROBE_TIMEOUT_MS);
}

function runtimeReady(state) {
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
}

describe('WhatsApp WA-JS 4.6 runtime compatibility', () => {
  it('settles the exact WA-JS surface before exposing the WAPLUS fallback', async () => {
    let state = null;
    await browser.waitUntil(async () => {
      state = await probeGuestRuntime();
      return state.found === true;
    }, {
      timeout: GUEST_TIMEOUT_MS,
      interval: 200,
      timeoutMsg: 'fresh synthetic WhatsApp guest did not appear',
    });

    await browser.waitUntil(async () => {
      state = await probeGuestRuntime();
      return runtimeReady(state);
    }, {
      timeout: RUNTIME_TIMEOUT_MS,
      interval: 500,
      timeoutMsg: 'WA-JS 4.6/WAPLUS runtime compatibility surface did not become ready',
    });

    assert.equal(state.version, '4.6.0', 'injected WA-JS version must match the exact dependency pin');
    assert.equal(state.wppReady, true, 'WA-JS must settle before dependent compatibility code is accepted');
    assert.equal(state.loaderReady, true, 'WA-JS loader/module metadata required by composer recovery is missing');
    assert.equal(state.chatReady, true, 'WA-JS text/media/active-chat APIs are incomplete');
    assert.equal(state.lidGroupReady, true, 'WA-JS LID/group APIs are incomplete');
    assert.equal(state.storesReady, true, 'WA-JS ChatStore/UserPrefs compatibility surface is incomplete');
    assert.equal(state.fallbackReady, true, 'WAPLUS compatibility fallback surface is incomplete');
    console.log(\`WA_JS_RUNTIME version=\${state.version} injected=\${state.wppInjected} ready=\${state.wppReady} loader=\${state.loaderReady} chat=\${state.chatReady} lidGroup=\${state.lidGroupReady} stores=\${state.storesReady} fallback=\${state.fallbackReady}\`);
  });
});
`;
write('e2e/specs/whatsapp-wa-js-runtime.e2e.cjs', runtimeSpec);

let e2eRunner = read('e2e/run.cjs');
e2eRunner = replaceOne(
  e2eRunner,
  "  'whatsapp-bootstrap': path.join(root, 'e2e', 'specs', 'whatsapp-live-bootstrap.e2e.cjs'),",
  "  'whatsapp-bootstrap': path.join(root, 'e2e', 'specs', 'whatsapp-live-bootstrap.e2e.cjs'),\n  'whatsapp-runtime': path.join(root, 'e2e', 'specs', 'whatsapp-wa-js-runtime.e2e.cjs'),",
  'targeted WhatsApp runtime suite'
);
write('e2e/run.cjs', e2eRunner);

let windowsContract = read('test/electron-e2e-windows-whatsapp-contract.cjs');
windowsContract = replaceOne(
  windowsContract,
  "const whatsappSpec = fs.readFileSync(path.join(root, 'e2e', 'specs', 'whatsapp-live-bootstrap.e2e.cjs'), 'utf8');",
  "const whatsappSpec = fs.readFileSync(path.join(root, 'e2e', 'specs', 'whatsapp-live-bootstrap.e2e.cjs'), 'utf8');\nconst whatsappRuntimeSpec = fs.readFileSync(path.join(root, 'e2e', 'specs', 'whatsapp-wa-js-runtime.e2e.cjs'), 'utf8');",
  'Windows contract runtime spec source'
);
windowsContract = replaceOne(
  windowsContract,
  "assert.match(windowsJob, /GEEK_E2E_SUITE:\\s*whatsapp-bootstrap/, 'Windows lane must select only the WhatsApp bootstrap gate');",
  "assert.match(windowsJob, /GEEK_E2E_SUITE:\\s*whatsapp-bootstrap/, 'Windows lane must retain the independent WhatsApp bootstrap gate');\nassert.match(windowsJob, /GEEK_E2E_SUITE:\\s*whatsapp-runtime/, 'Windows lane must run the independent WA-JS runtime gate');",
  'Windows workflow suite contracts'
);
windowsContract = replaceOne(
  windowsContract,
  "assert.match(runner, /'whatsapp-bootstrap':\\s*path\\.join\\(root, 'e2e', 'specs', 'whatsapp-live-bootstrap\\.e2e\\.cjs'\\)/, 'selector must resolve only the existing WhatsApp bootstrap spec');",
  "assert.match(runner, /'whatsapp-bootstrap':\\s*path\\.join\\(root, 'e2e', 'specs', 'whatsapp-live-bootstrap\\.e2e\\.cjs'\\)/, 'selector must retain the WhatsApp bootstrap spec');\nassert.match(runner, /'whatsapp-runtime':\\s*path\\.join\\(root, 'e2e', 'specs', 'whatsapp-wa-js-runtime\\.e2e\\.cjs'\\)/, 'selector must expose the independent WA-JS runtime spec');",
  'E2E runner runtime selector contract'
);
windowsContract += `\nassert.match(whatsappRuntimeSpec, /version === '4\\.6\\.0'/, 'WA-JS runtime gate must require the exact tested version');\nassert.match(whatsappRuntimeSpec, /loaderReady[\\s\\S]*chatReady[\\s\\S]*lidGroupReady[\\s\\S]*storesReady[\\s\\S]*fallbackReady/, 'WA-JS runtime gate must cover loader, send, LID/group, stores, and WAPLUS fallback');\nassert.doesNotMatch(whatsappRuntimeSpec, /document\\.cookie|localStorage|sessionStorage|Authorization|qrData|innerText|textContent/i, 'WA-JS runtime diagnostics must not read secrets or page bodies');\n`;
write('test/electron-e2e-windows-whatsapp-contract.cjs', windowsContract);

run('npm', ['ci', '--ignore-scripts']);
run(process.execPath, ['scripts/dependency-audit-policy.cjs']);
run('npm', ['test']);
run('git', ['diff', '--check']);

fs.rmSync(abs('.github/workflows/issue-522-followup.yml'), { force: true });
fs.rmSync(abs('.github/scripts/issue-522-followup.cjs'), { force: true });
run('git', ['config', 'user.name', 'github-actions[bot]']);
run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
run('git', ['add', '-A']);
run('git', ['commit', '-m', 'test: gate WA-JS 4.6 cold-start compatibility (#522)']);
run('git', ['push', 'origin', 'HEAD:fix/522-wa-js-4-6-migration']);
