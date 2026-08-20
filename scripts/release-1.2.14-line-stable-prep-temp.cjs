'use strict';

const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');

const BASELINE = 'bbebd6c47dd88d8e61b241019e24fdf3ce768bef';
const VERSION = '1.2.14';

function run(args) {
  cp.execFileSync(args[0], args.slice(1), { stdio: 'inherit' });
}
function replaceOnce(text, before, after, label) {
  const normalized = text.replace(/\r\n/g, '\n');
  const needle = before.replace(/\r\n/g, '\n');
  const count = normalized.split(needle).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  return normalized.replace(needle, after);
}
function writeJson(file, mutate) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  mutate(data);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

const restore = [
  '.github/release-client-version',
  'README.md',
  'docs/github-control-plane.md',
  'docs/release-security.md',
  'package-lock.json',
  'package.json',
  'resources/s3loYR.js',
  'scripts/geek-website-worker.js',
  'src/main.cjs',
  'src/preload.cjs',
  'test/account-identity-contract.cjs',
  'ui/index.html',
  'ui/subscription.html',
];
run(['git', 'checkout', BASELINE, '--', ...restore]);
for (const added of [
  'test/line-translation-bridge-contract.cjs',
  'test/profile-center-ux-contract.cjs',
  'ui/profile-center.css',
  'ui/profile-center.js',
]) fs.rmSync(added, { force: true });

require(path.resolve('.release-tmp/line-submit-confirm-v8-temp.cjs'));
fs.copyFileSync('.release-tmp/line-translation-route-contract.cjs', 'test/line-translation-route-contract.cjs');

const imageContract = `'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createInternalCdp } = require('../src/internal-cdp.cjs');

const main = fs.readFileSync('src/main.cjs', 'utf8').replace(/\\r\\n/g, '\\n');
const ui = fs.readFileSync('ui/app.js', 'utf8').replace(/\\r\\n/g, '\\n');
const cdp = fs.readFileSync('src/internal-cdp.cjs', 'utf8').replace(/\\r\\n/g, '\\n');

for (const marker of ['DOM.setFileInputFiles', 'PASTE_DISPATCHED', 'pastedImageList-module__image_list_item__', "targetPlatform === 'line' ? guestId : null"]) assert.ok(main.includes(marker), 'LINE host path missing: ' + marker);
for (const marker of ['submitPastedImages: (msg, beforeIds, expectedImages) =>', 'TEXT_STATE_NOT_READY', 'textStableChecks >= 3', 'pastedCleared && textCleared', "return pastedCleared ? 'LINE_TEXT_NOT_CLEARED' : 'LINE_SUBMIT_NOT_OBSERVED'", "guestId: platform.family === 'line' ? wv.getWebContentsId() : undefined"]) assert.ok(ui.includes(marker), 'LINE renderer path missing: ' + marker);
assert.ok(!ui.includes("action: 'send',\\n                guestId: wv.getWebContentsId()"), 'LINE must not return to modal send-click path');
assert.ok(!ui.includes('LINE_MESSAGE_NOT_CONFIRMED'), 'message DOM ids must not block completion');
for (const marker of ['preferredGuestId', 'Number(g?.id) === Number(preferredGuestId)']) assert.ok(cdp.includes(marker), 'exact LINE guest routing missing: ' + marker);

function guest(id, partitionLeaf) {
  let attached = false;
  const calls = [];
  return {
    id,
    calls,
    getURL: () => 'chrome-extension://line/chat',
    session: { storagePath: 'C:\\\\Users\\\\test\\\\AppData\\\\Roaming\\\\geek\\\\Partitions\\\\' + partitionLeaf },
    debugger: {
      isAttached: () => attached,
      attach: async () => { attached = true; calls.push('attach'); },
      detach: async () => { attached = false; calls.push('detach'); },
      sendCommand: async () => { calls.push('send'); return {}; },
      addListener: () => {},
      removeListener: () => {},
    },
  };
}

(async () => {
  const a = guest(41, 'webview-page-line');
  const b = guest(42, 'webview-page-line');
  const manager = createInternalCdp({ getAllWebContents: () => [a, b], timeoutMs: 100 });
  assert.equal(manager.findGuest('persist:webview-page-line', 'line', 42)?.id, 42, 'must select exact LINE guest id');
  assert.equal(manager.findGuest('persist:webview-page-line', 'line', 99), null, 'unknown exact LINE guest id must fail closed');
  await manager.run('persist:webview-page-line', 'line', ({ send }) => send('Runtime.evaluate'), 42);
  assert.deepEqual(a.calls, [], 'must not touch sibling LINE guest');
  assert.deepEqual(b.calls, ['attach', 'send', 'detach'], 'exact LINE guest must complete CDP transaction');
  console.log('LINE_IMAGE_BROADCAST_CONTRACT_OK');
})().catch(err => { console.error(err); process.exit(1); });
`;
fs.writeFileSync('test/line-image-broadcast-contract.cjs', imageContract);

writeJson('package.json', pkg => { pkg.version = VERSION; });
writeJson('package-lock.json', lock => {
  lock.version = VERSION;
  if (!lock.packages?.['']) throw new Error('package-lock root package missing');
  lock.packages[''].version = VERSION;
});
fs.writeFileSync('.github/release-client-version', VERSION + '\n');

let readme = fs.readFileSync('README.md', 'utf8');
readme = readme.replace('当前维护基线（2026-08-19）', '当前维护基线（2026-08-20）');
readme = readme.replace('客户端与 `package.json` 版本为 **1.2.12**，`.github/release-client-version` 为 **1.2.12**', `客户端与 \`package.json\` 版本为 **${VERSION}**，\`.github/release-client-version\` 为 **${VERSION}**`);
fs.writeFileSync('README.md', readme);

let control = fs.readFileSync('docs/github-control-plane.md', 'utf8');
control = control.replace('Current client/package version and `.github/release-client-version` are both `1.2.12`.', `Current client/package version and \`.github/release-client-version\` are both \`${VERSION}\`.`);
fs.writeFileSync('docs/github-control-plane.md', control);

let security = fs.readFileSync('docs/release-security.md', 'utf8');
security = security.replace('当前正式客户端版本为 `1.2.12`，`package.json.version` 与 `.github/release-client-version` 均为 `1.2.12`。', `当前正式客户端版本为 \`${VERSION}\`，\`package.json.version\` 与 \`.github/release-client-version\` 均为 \`${VERSION}\`。`);
security = security.replace('\n正式客户端发布不是普通维护动作。', `\n\n${VERSION} 从已实机验证的 1.2.12 LINE 兼容产品树恢复构建，仅叠加 LINE hash 路由翻译修复和原生 pasted-image 群发修复；已回滚的 1.2.13 LINE 白屏运行路径不重新引入。\n\n正式客户端发布不是普通维护动作。`);
fs.writeFileSync('docs/release-security.md', security);

let website = fs.readFileSync('scripts/geek-website-worker.js', 'utf8');
website = replaceOnce(website, "const FALLBACK_VERSION = '1.2.11';", "const FALLBACK_VERSION = '1.2.12';", 'website fallback');
fs.writeFileSync('scripts/geek-website-worker.js', website);

if (!fs.readFileSync('ui/translation-adapters.js', 'utf8').includes("pathname.match(/^\\/[^/]+\\/([^/]+)\\/?$/)")) throw new Error('LINE translation route fix missing');
if (!fs.readFileSync('ui/app.js', 'utf8').includes('TEXT_STATE_NOT_READY')) throw new Error('V8 combined text+image stabilization missing');
if (!fs.readFileSync('src/main.cjs', 'utf8').includes('pastedImageList-module__image_list_item__')) throw new Error('V8 LINE pasted image transport missing');
if (!fs.readFileSync('src/internal-cdp.cjs', 'utf8').includes('preferredGuestId')) throw new Error('V8 exact LINE guest routing missing');
const baselineLine = cp.execFileSync('git', ['show', `${BASELINE}:resources/s3loYR.js`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
const baselinePreload = cp.execFileSync('git', ['show', `${BASELINE}:src/preload.cjs`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
if (fs.readFileSync('resources/s3loYR.js', 'utf8') !== baselineLine) throw new Error('LINE startup resource must remain exact 1.2.12 baseline');
if (fs.readFileSync('src/preload.cjs', 'utf8') !== baselinePreload) throw new Error('main preload must remain exact 1.2.12 baseline');

console.log('RELEASE_1_2_14_LINE_STABLE_PREP_OK');
