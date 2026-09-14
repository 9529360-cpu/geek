'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const rel = (...parts) => path.join(root, ...parts);
const read = (file) => fs.readFileSync(rel(file), 'utf8');
const write = (file, value) => fs.writeFileSync(rel(file), value, 'utf8');

function replaceRequired(source, from, to, label) {
  assert.ok(source.includes(from), `${label}: expected source fragment missing`);
  return source.split(from).join(to);
}

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
}

const pkgPath = 'package.json';
const pkg = JSON.parse(read(pkgPath));
assert.equal(pkg.version, '1.2.25', 'issue #522 must not change the client release marker');
assert.equal(pkg.dependencies?.['@wppconnect/wa-js'], '^4.3.0', 'unexpected starting WA-JS manifest version');
pkg.dependencies['@wppconnect/wa-js'] = '4.6.0';
write(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

let main = read('src/main.cjs');
const functionStart = '  async function injectWppWithRetry(wc, part) {';
const functionEndMarker = '\n  }\n\n  });';
const start = main.indexOf(functionStart);
assert.ok(start >= 0, 'injectWppWithRetry start not found');
assert.equal(main.indexOf(functionStart, start + functionStart.length), -1, 'injectWppWithRetry must have a single owner');
const end = main.indexOf(functionEndMarker, start);
assert.ok(end > start, 'injectWppWithRetry end not found');

const newInjectFunction = `  async function injectWppWithRetry(wc, part) {
    const readinessProbe = \`(async () => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const W = window.WPP;
        const ready = W?.isReady === true
          && typeof W?.loader?.moduleRequire === 'function'
          && typeof W?.whatsapp?._moduleIdMap?.get === 'function'
          && typeof W?.chat?.sendTextMessage === 'function'
          && typeof W?.chat?.sendFileMessage === 'function'
          && typeof W?.chat?.getActiveChat === 'function'
          && typeof W?.contact?.getPnLidEntry === 'function'
          && typeof W?.group?.getParticipants === 'function'
          && !!W?.whatsapp?.ChatStore
          && !!W?.whatsapp?.UserPrefs;
        if (ready) return true;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      return false;
    })()\`;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        let wppReady = await wc.executeJavaScript(readinessProbe).catch(() => false);
        if (!wppReady) {
          const wppScript = await fs.readFile(path.join(__dirname, '../node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js'), 'utf-8');
          await wc.executeJavaScript(wppScript);
          wppReady = await wc.executeJavaScript(readinessProbe).catch(() => false);
        }
        if (!wppReady) {
          console.log(\`[wpp] 第 \${attempt + 1} 次注入后 WA-JS 核心兼容面未就绪，3 秒后重试…\`);
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }

        try {
          const waplusScript = await fs.readFile(path.join(__dirname, '../resources/waplus-wpp.js'), 'utf-8');
          await wc.executeJavaScript(waplusScript);
        } catch (e) {
          console.log('[wpp] WAPLUS 注入失败:', e.message);
        }

        const compatReady = await wc.executeJavaScript(\`(() => {
          const primary = window.WPP;
          const fallback = window.WAPLUS_WPP;
          return primary?.isReady === true
            && typeof primary?.chat?.sendTextMessage === 'function'
            && typeof primary?.chat?.sendFileMessage === 'function'
            && typeof primary?.contact?.getPnLidEntry === 'function'
            && typeof primary?.group?.getParticipants === 'function'
            && !!primary?.whatsapp?.ChatStore
            && !!primary?.whatsapp?.UserPrefs
            && typeof fallback?.chat?.sendTextMessage === 'function';
        })()\`).catch(() => false);
        if (compatReady) {
          wppInjected.add(part);
          console.log('[wpp] WA-JS 4.6 runtime + WAPLUS compatibility boundary ready', part);
          wc.executeJavaScript(\`(async () => {
            for (let i = 0; i < 10; i++) {
              const arrow = document.querySelector('.bulk-sender .el-icon-arrow-left');
              if (arrow) { arrow.click(); return 'COLLAPSED'; }
              await new Promise(r => setTimeout(r, 800));
            }
            return 'NO_ARROW';
          })()\`).catch(() => null);
          return;
        }
        console.log(\`[wpp] 第 \${attempt + 1} 次注入后兼容边界未就绪，3 秒后重试…\`);
      } catch (e) {
        console.log('[wpp] 注入异常:', e.message);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    console.log('[wpp] 注入失败（5 次重试后仍不可用）', part);
  }`;

main = main.slice(0, start) + newInjectFunction + main.slice(end + '\n  }'.length);
main = replaceRequired(main, 'window.WAPLUS_WPP || window.WPP', 'window.WPP || window.WAPLUS_WPP', 'src/main.cjs WPP precedence');
write('src/main.cjs', main);

for (const file of ['ui/app.js', 'ui/broadcast-runtime.js']) {
  const source = read(file);
  const next = replaceRequired(source, 'window.WAPLUS_WPP || window.WPP', 'window.WPP || window.WAPLUS_WPP', `${file} WPP precedence`);
  write(file, next);
}

let converge = read('test/wpp-converge-contract.cjs');
converge = replaceRequired(
  converge,
  "assert.match(main, /WAPLUS_WPP \\\\|\\\\| window\\\\.WPP/, '页面 API 必须兼容 WAPLUS_WPP 与 WPP');",
  "assert.match(main, /window\\\\.WPP \\\\|\\\\| window\\\\.WAPLUS_WPP/, '页面 API 必须以 WA-JS 为主并保留 WAPLUS_WPP 回退');",
  'wpp converge contract precedence'
);
write('test/wpp-converge-contract.cjs', converge);

const migrationContract = `'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

assert.equal(pkg.version, '1.2.25', 'dependency migration must not change the formal client release');
assert.equal(pkg.dependencies['@wppconnect/wa-js'], '4.6.0', 'WA-JS must be deliberately pinned to tested stable 4.6.0');
assert.equal(lock.packages[''].dependencies['@wppconnect/wa-js'], '4.6.0', 'lock root must match the exact manifest pin');
assert.equal(lock.packages['node_modules/@wppconnect/wa-js'].version, '4.6.0', 'lock must resolve WA-JS 4.6.0');

const bundlePath = require.resolve('@wppconnect/wa-js');
const packageDir = path.dirname(path.dirname(bundlePath));
const installedPkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
assert.equal(installedPkg.version, '4.6.0', 'installed WA-JS must match the lock');

function allDeclarations(dir) {
  let out = '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) out += allDeclarations(target);
    else if (entry.isFile() && entry.name.endsWith('.d.ts')) out += fs.readFileSync(target, 'utf8') + '\\n';
  }
  return out;
}

const declarations = allDeclarations(path.join(packageDir, 'dist'));
for (const api of [
  'sendTextMessage', 'sendFileMessage', 'getActiveChat', 'getPnLidEntry',
  'getParticipants', 'moduleRequire', '_moduleIdMap', 'UserPrefs', 'ChatStore'
]) {
  assert.ok(declarations.includes(api), `WA-JS 4.6 declarations must retain Geek surface: ${api}`);
}

const main = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui/app.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'ui/broadcast-runtime.js'), 'utf8');
const recovery = fs.readFileSync(path.join(root, 'ui/whatsapp-translation-hook-recovery.js'), 'utf8');

assert.match(main, /W\\?\\.isReady === true[\\s\\S]*loader\\?\\.moduleRequire[\\s\\S]*_moduleIdMap\\?\\.get/, 'injection must wait for WA-JS loader metadata readiness');
assert.match(main, /sendTextMessage[\\s\\S]*sendFileMessage[\\s\\S]*getActiveChat[\\s\\S]*getPnLidEntry[\\s\\S]*getParticipants/, 'injection readiness gate must cover Geek send/LID/group surfaces');
assert.match(main, /window\\.WPP \\|\\| window\\.WAPLUS_WPP/, 'main-process guest code must prefer stable WA-JS and preserve WAPLUS fallback');
assert.match(app, /window\\.WPP \\|\\| window\\.WAPLUS_WPP/, 'renderer WhatsApp integrations must prefer stable WA-JS');
assert.match(runtime, /window\\.WPP \\|\\| window\\.WAPLUS_WPP/, 'broadcast runtime must prefer stable WA-JS');
assert.match(recovery, /wpp\\?\\.loader[\\s\\S]*moduleRequire[\\s\\S]*_moduleIdMap/, 'ordinary composer recovery must continue consuming WA-JS loader metadata');
assert.match(main, /resources\\/waplus-wpp\\.js|resources', 'WAPLUS compatibility bundle must remain wired');

console.log('WA-JS 4.6 migration contract passed');
`;
write('test/wa-js-460-migration-contract.cjs', migrationContract);

run('npm', ['install', '@wppconnect/wa-js@4.6.0', '--save-exact', '--package-lock-only', '--ignore-scripts']);
run('npm', ['ci', '--ignore-scripts']);
run(process.execPath, ['scripts/dependency-audit-policy.cjs']);
run('npm', ['test']);
run('git', ['diff', '--check']);

fs.rmSync(rel('.github/workflows/issue-522-migrate.yml'), { force: true });
fs.rmSync(rel('.github/scripts/issue-522-migrate.cjs'), { force: true });

run('git', ['config', 'user.name', 'github-actions[bot]']);
run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
run('git', ['add', '-A']);
run('git', ['commit', '-m', 'fix: migrate WhatsApp runtime to WA-JS 4.6.0 (#522)']);
run('git', ['push', 'origin', 'HEAD:fix/522-wa-js-4-6-migration']);
