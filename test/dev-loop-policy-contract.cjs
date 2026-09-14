'use strict';

const assert = require('node:assert/strict');
const {
  DEV_ACTION,
  classifyDevChange,
  isIgnoredDevPath,
  normalizeRelativePath,
  planDevChanges,
  selectDevAction,
} = require('../scripts/dev-loop-policy.cjs');

assert.equal(normalizeRelativePath('.\\ui\\app.js'), 'ui/app.js');
assert.equal(normalizeRelativePath('./src/main.cjs'), 'src/main.cjs');

assert.equal(isIgnoredDevPath('ui/app.js~'), true);
assert.equal(isIgnoredDevPath('src/.#main.cjs'), true);
assert.equal(isIgnoredDevPath('scripts/worker.swp'), true);
assert.equal(isIgnoredDevPath('ui/app.js'), false);

assert.equal(classifyDevChange('ui/app.js'), DEV_ACTION.RELOAD_SHELL);
assert.equal(classifyDevChange('ui/styles/app.css'), DEV_ACTION.RELOAD_SHELL);
assert.equal(classifyDevChange('ui'), DEV_ACTION.RELOAD_SHELL);
assert.equal(classifyDevChange('ui-old/app.js'), DEV_ACTION.IGNORE);
assert.equal(classifyDevChange('src/main.cjs'), DEV_ACTION.RESTART_ELECTRON);
assert.equal(classifyDevChange('resources/bridge-preload.cjs'), DEV_ACTION.RESTART_ELECTRON);
assert.equal(classifyDevChange('package.json'), DEV_ACTION.RESTART_ELECTRON);
assert.equal(classifyDevChange('package-lock.json'), DEV_ACTION.RESTART_ELECTRON);
assert.equal(classifyDevChange('docs/README.md'), DEV_ACTION.IGNORE);
assert.equal(classifyDevChange('test/example.cjs'), DEV_ACTION.IGNORE);
assert.equal(classifyDevChange('scripts/geek-website-worker.js'), DEV_ACTION.IGNORE);
assert.equal(classifyDevChange('ui/app.js~'), DEV_ACTION.IGNORE);

assert.equal(selectDevAction(['ui/app.js', 'ui/styles/app.css']), DEV_ACTION.RELOAD_SHELL);
assert.equal(selectDevAction(['ui/app.js', 'src/main.cjs']), DEV_ACTION.RESTART_ELECTRON);
assert.equal(selectDevAction(['docs/README.md', 'test/example.cjs']), DEV_ACTION.IGNORE);

assert.deepEqual(
  planDevChanges([
    'ui/app.js',
    'ui/app.js~',
    'scripts/geek-website-worker.js',
    'test/website-worker-contract.cjs',
    'wrangler-website.toml',
  ]),
  {
    changes: [
      'scripts/geek-website-worker.js',
      'test/website-worker-contract.cjs',
      'ui/app.js',
      'wrangler-website.toml',
    ],
    runtimeAction: DEV_ACTION.RELOAD_SHELL,
    runtimeSyntaxFiles: ['ui/app.js'],
    feedbackSyntaxFiles: ['scripts/geek-website-worker.js'],
    syntaxFiles: ['scripts/geek-website-worker.js', 'ui/app.js'],
    testFiles: ['test/website-worker-contract.cjs'],
    manifestFiles: [],
    workerConfigFiles: ['wrangler-website.toml'],
    requiresLoopRestart: false,
  },
);

const restartPlan = planDevChanges([
  'src/main.cjs',
  'resources/bridge-preload.cjs',
  'ui/app.js',
  'package.json',
  'scripts/dev-loop.cjs',
  'test/cdp-reload.cjs',
]);
assert.equal(restartPlan.runtimeAction, DEV_ACTION.RESTART_ELECTRON);
assert.deepEqual(restartPlan.manifestFiles, ['package.json']);
assert.deepEqual(restartPlan.runtimeSyntaxFiles, ['resources/bridge-preload.cjs', 'src/main.cjs', 'ui/app.js']);
assert.deepEqual(restartPlan.feedbackSyntaxFiles, ['scripts/dev-loop.cjs', 'test/cdp-reload.cjs']);
assert.deepEqual(restartPlan.syntaxFiles, ['resources/bridge-preload.cjs', 'scripts/dev-loop.cjs', 'src/main.cjs', 'test/cdp-reload.cjs', 'ui/app.js']);
assert.equal(restartPlan.requiresLoopRestart, true);
assert.deepEqual(restartPlan.testFiles, []);

const controlPlan = planDevChanges(['src/dev-loop-control.cjs']);
assert.equal(controlPlan.runtimeAction, DEV_ACTION.RESTART_ELECTRON);
assert.equal(controlPlan.requiresLoopRestart, true);

const recoveryPlan = planDevChanges(['scripts/dev-loop-recovery.cjs']);
assert.equal(recoveryPlan.runtimeAction, DEV_ACTION.IGNORE);
assert.equal(recoveryPlan.requiresLoopRestart, true);
assert.deepEqual(recoveryPlan.feedbackSyntaxFiles, ['scripts/dev-loop-recovery.cjs']);

const workerFeedbackPlan = planDevChanges(['scripts/dev-worker-feedback.cjs']);
assert.equal(workerFeedbackPlan.runtimeAction, DEV_ACTION.IGNORE);
assert.equal(workerFeedbackPlan.requiresLoopRestart, true);
assert.deepEqual(workerFeedbackPlan.feedbackSyntaxFiles, ['scripts/dev-worker-feedback.cjs']);

console.log('dev-loop policy contract passed');
