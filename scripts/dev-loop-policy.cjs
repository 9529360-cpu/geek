'use strict';

const path = require('node:path');

const DEV_ACTION = Object.freeze({
  IGNORE: 'ignore',
  RELOAD_SHELL: 'reload-shell',
  RESTART_ELECTRON: 'restart-electron',
});

const ACTION_PRIORITY = Object.freeze({
  [DEV_ACTION.IGNORE]: 0,
  [DEV_ACTION.RELOAD_SHELL]: 1,
  [DEV_ACTION.RESTART_ELECTRON]: 2,
});

const CDP_DEVELOPER_TOOLS = new Set([
  'test/cdp-eval.cjs',
  'test/cdp-reload.cjs',
]);

function normalizeRelativePath(value) {
  return String(value || '')
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
}

function classifyDevChange(relativePath) {
  const filePath = normalizeRelativePath(relativePath);
  if (!filePath) return DEV_ACTION.IGNORE;

  if (filePath === 'package.json' || filePath === 'package-lock.json') {
    return DEV_ACTION.RESTART_ELECTRON;
  }
  if (filePath === 'ui' || filePath.startsWith('ui/')) {
    return DEV_ACTION.RELOAD_SHELL;
  }
  if (
    filePath === 'src'
    || filePath.startsWith('src/')
    || filePath === 'resources'
    || filePath.startsWith('resources/')
  ) {
    return DEV_ACTION.RESTART_ELECTRON;
  }
  return DEV_ACTION.IGNORE;
}

function selectDevAction(relativePaths) {
  let selected = DEV_ACTION.IGNORE;
  for (const relativePath of relativePaths || []) {
    const candidate = classifyDevChange(relativePath);
    if (ACTION_PRIORITY[candidate] > ACTION_PRIORITY[selected]) selected = candidate;
    if (selected === DEV_ACTION.RESTART_ELECTRON) break;
  }
  return selected;
}

function isJavaScriptSource(filePath) {
  return ['.js', '.cjs', '.mjs'].includes(path.posix.extname(filePath));
}

function shouldSyntaxCheck(filePath) {
  if (!isJavaScriptSource(filePath)) return false;
  return [
    'src/',
    'ui/',
    'scripts/',
    'test-support/',
    'e2e/',
  ].some((prefix) => filePath.startsWith(prefix))
    || CDP_DEVELOPER_TOOLS.has(filePath);
}

function isRunnableContract(filePath) {
  return filePath.startsWith('test/')
    && filePath.endsWith('.cjs')
    && !CDP_DEVELOPER_TOOLS.has(filePath);
}

function isWorkerConfig(filePath) {
  return /^wrangler(?:-[a-z0-9-]+)?\.toml$/i.test(filePath);
}

function planDevChanges(relativePaths) {
  const changes = Array.from(new Set(
    (relativePaths || []).map(normalizeRelativePath).filter(Boolean),
  )).sort();
  return Object.freeze({
    changes: Object.freeze(changes),
    runtimeAction: selectDevAction(changes),
    syntaxFiles: Object.freeze(changes.filter(shouldSyntaxCheck)),
    testFiles: Object.freeze(changes.filter(isRunnableContract)),
    manifestFiles: Object.freeze(changes.filter((filePath) => (
      filePath === 'package.json' || filePath === 'package-lock.json'
    ))),
    workerConfigFiles: Object.freeze(changes.filter(isWorkerConfig)),
    requiresLoopRestart: changes.some((filePath) => (
      filePath === 'scripts/dev-loop.cjs' || filePath === 'scripts/dev-loop-policy.cjs'
    )),
  });
}

module.exports = {
  DEV_ACTION,
  classifyDevChange,
  normalizeRelativePath,
  planDevChanges,
  selectDevAction,
};
