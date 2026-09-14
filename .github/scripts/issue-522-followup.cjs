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
  '// window.WPP（wppconnect 官方）+ window.WAPLUS_WPP（HelloWorld fork——sendFileMessage 可用）',
  '// window.WPP（WA-JS 4.6 主路径）+ window.WAPLUS_WPP（HelloWorld fork，仅作兼容回退）',
  'WA-JS/WAPLUS authority comment'
);
write('ui/app.js', app);

let contract = read('test/wa-js-460-migration-contract.cjs');
contract = replaceOne(
  contract,
  "assert.match(main, /waplus-wpp\\.js/, 'WAPLUS compatibility bundle must remain wired');",
  "assert.match(main, /fallback\\?\\.chat\\?\\.sendTextMessage[\\s\\S]*fallback\\?\\.chat\\?\\.sendFileMessage[\\s\\S]*fallback\\?\\.contact\\?\\.getPnLidEntry[\\s\\S]*fallback\\?\\.group\\?\\.getParticipants/, 'WAPLUS fallback must retain text/media/LID/group compatibility');\nassert.match(main, /waplus-wpp\\.js/, 'WAPLUS compatibility bundle must remain wired');",
  'WAPLUS executable compatibility contract'
);
write('test/wa-js-460-migration-contract.cjs', contract);

let e2e = read('e2e/specs/whatsapp-live-bootstrap.e2e.cjs');
e2e = replaceOne(
  e2e,
`        wppReady: window.WPP?.isReady === true,
        waPlusPresent: !!window.WAPLUS_WPP,
        waPlusChat: !!window.WAPLUS_WPP?.chat?.sendTextMessage,`,
`        wppReady: window.WPP?.isReady === true,
        wppVersion: String(window.WPP?.version || ''),
        wppContractReady: window.WPP?.isReady === true
          && typeof window.WPP?.loader?.moduleRequire === 'function'
          && typeof window.WPP?.whatsapp?._moduleIdMap?.get === 'function'
          && typeof window.WPP?.chat?.sendTextMessage === 'function'
          && typeof window.WPP?.chat?.sendFileMessage === 'function'
          && typeof window.WPP?.chat?.getActiveChat === 'function'
          && typeof window.WPP?.contact?.getPnLidEntry === 'function'
          && typeof window.WPP?.group?.getParticipants === 'function'
          && !!window.WPP?.whatsapp?.ChatStore
          && !!window.WPP?.whatsapp?.UserPrefs,
        waPlusPresent: !!window.WAPLUS_WPP,
        waPlusChat: !!window.WAPLUS_WPP?.chat?.sendTextMessage,
        waPlusContractReady: typeof window.WAPLUS_WPP?.chat?.sendTextMessage === 'function'
          && typeof window.WAPLUS_WPP?.chat?.sendFileMessage === 'function'
          && typeof window.WAPLUS_WPP?.contact?.getPnLidEntry === 'function'
          && typeof window.WAPLUS_WPP?.group?.getParticipants === 'function'
          && !!window.WAPLUS_WPP?.whatsapp?.ChatStore
          && !!window.WAPLUS_WPP?.whatsapp?.UserPrefs,`,
  'Windows WA-JS runtime probe fields'
);
e2e = replaceOne(
  e2e,
`    assert.equal(summary.loginShell, true, \`current WhatsApp Web did not expose a user-visible QR/login shell: \${JSON.stringify(summary)}\`);
    assert.equal(classification.ready, true, \`WhatsApp bootstrap oracle did not accept the terminal state: \${classification.reason}\`);

    // These are evidence, not the startup acceptance criterion. If they regress,
    // the next repair should target the injection owner rather than the bootstrap.
    console.log(\`WA_LIVE_INJECTION wppPresent=\${state.wppPresent} wppInjected=\${state.wppInjected} wppReady=\${state.wppReady} waPlusPresent=\${state.waPlusPresent} waPlusChat=\${state.waPlusChat} metaRequire=\${state.metaRequire}\`);`,
`    assert.equal(summary.loginShell, true, \`current WhatsApp Web did not expose a user-visible QR/login shell: \${JSON.stringify(summary)}\`);
    assert.equal(classification.ready, true, \`WhatsApp bootstrap oracle did not accept the terminal state: \${classification.reason}\`);

    let injectionState = state;
    try {
      await browser.waitUntil(async () => {
        injectionState = await probeGuest();
        return injectionState.wppContractReady === true && injectionState.waPlusContractReady === true;
      }, {
        timeout: 35_000,
        interval: 500,
        timeoutMsg: 'WA-JS 4.6/WAPLUS runtime compatibility surface did not become ready',
      });
    } catch (error) {
      throw new Error(\`WhatsApp runtime compatibility timeout: \${JSON.stringify(injectionState)}\`, { cause: error });
    }
    state = injectionState;
    assert.equal(state.wppVersion, '4.6.0', \`unexpected injected WA-JS version: \${state.wppVersion}\`);
    assert.equal(state.wppContractReady, true, 'WA-JS 4.6 Geek runtime surface is incomplete');
    assert.equal(state.waPlusContractReady, true, 'WAPLUS compatibility fallback surface is incomplete');
    console.log(\`WA_LIVE_INJECTION version=\${state.wppVersion} wppPresent=\${state.wppPresent} wppInjected=\${state.wppInjected} wppReady=\${state.wppReady} wppContractReady=\${state.wppContractReady} waPlusPresent=\${state.waPlusPresent} waPlusChat=\${state.waPlusChat} waPlusContractReady=\${state.waPlusContractReady} metaRequire=\${state.metaRequire}\`);`,
  'Windows WA-JS runtime acceptance gate'
);
write('e2e/specs/whatsapp-live-bootstrap.e2e.cjs', e2e);

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
