'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const branch = 'agent/reject-unknown-webview-partition';
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_HEAD_REF !== branch) {
  console.log('TMP_WEBVIEW_PATCH_SKIPPED');
  process.exit(0);
}

const root = path.join(__dirname, '..');
function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

git(['fetch', 'origin', branch]);
git(['checkout', '-B', branch, `origin/${branch}`]);

const mainPath = path.join(root, 'src', 'main.cjs');
let main = fs.readFileSync(mainPath, 'utf8');
const old = `    const hostname = parsedSource.hostname.toLowerCase();\n\n    let customAllowed = false;\n`;
const replacement = `    if (!account || !config) {\n      event.preventDefault();\n      return;\n    }\n\n    const hostname = parsedSource.hostname.toLowerCase();\n\n    let customAllowed = false;\n`;
if (main.includes(old)) main = main.replace(old, replacement);
else if (!main.includes(replacement)) throw new Error('webview guard insertion point not found');

const oldReject = `    if (!account || !config || !isAllowed) {\n      event.preventDefault();\n      return;\n    }\n`;
const newReject = `    if (!isAllowed) {\n      event.preventDefault();\n      return;\n    }\n`;
if (main.includes(oldReject)) main = main.replace(oldReject, newReject);
else if (!main.includes(newReject)) throw new Error('webview final reject block not found');
fs.writeFileSync(mainPath, main, 'utf8');

const finalTestPath = path.join(root, 'test', 'webview-unknown-partition-contract.cjs');
fs.writeFileSync(finalTestPath, `'use strict';\n\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst path = require('node:path');\n\nconst root = path.join(__dirname, '..');\nconst main = fs.readFileSync(path.join(root, 'src', 'main.cjs'), 'utf8');\nconst start = main.indexOf('function configureWebviewSecurity(window)');\nconst end = main.indexOf("window.webContents.on('did-attach-webview'", start);\nassert.ok(start >= 0 && end > start, 'configureWebviewSecurity block must exist');\nconst block = main.slice(start, end);\n\nconst parseIndex = block.indexOf('parsedSource = new URL(source);');\nconst guardIndex = block.indexOf('if (!account || !config) {');\nconst customAccountIndex = block.indexOf("if (account.type === 'website' && account.customUrl)");\nconst lineAccountIndex = block.indexOf("(account.type === 'line' || account.type === 'line-business')");\n\nassert.ok(parseIndex >= 0, 'source URL parsing must remain present');\nassert.ok(guardIndex > parseIndex, 'unknown account/config guard must run after URL parsing');\nassert.ok(customAccountIndex > guardIndex, 'account.type custom-site access must occur only after the null guard');\nassert.ok(lineAccountIndex > guardIndex, 'account.type LINE access must occur only after the null guard');\nassert.match(block, /if \\(!account \\|\\| !config\\) \\{\\s*event\\.preventDefault\\(\\);\\s*return;\\s*\\}/, 'unknown or stale partitions must be rejected without dereferencing account');\nassert.match(block, /if \\(!isAllowed\\) \\{\\s*event\\.preventDefault\\(\\);\\s*return;\\s*\\}/, 'known accounts with disallowed URLs must still fail closed');\n\nconsole.log('WEBVIEW_UNKNOWN_PARTITION_CONTRACT_OK');\n`, 'utf8');

const focused = spawnSync(process.execPath, [finalTestPath], { cwd: root, stdio: 'inherit' });
if (focused.status !== 0) process.exit(focused.status || 1);

git(['diff', '--check']);
git(['config', 'user.name', 'github-actions[bot]']);
git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
git(['add', 'src/main.cjs', 'test/webview-unknown-partition-contract.cjs']);
const staged = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: root });
if (staged.status !== 0) {
  git(['commit', '-m', 'fix: reject unknown webview partitions safely']);
  git(['push', 'origin', `HEAD:${branch}`]);
}

console.log('TMP_WEBVIEW_PATCH_APPLIED');
