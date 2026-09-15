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

patch('ui/version-label.js', [[
  'remove legacy recovery startup',
  "  ensureScript('./whatsapp-translation-hook-recovery.js', 'data-geek-whatsapp-translation-hook-recovery');\n",
  ''
]]);

patch('test/whatsapp-translation-hook-recovery-contract.cjs', [[
  'legacy recovery no longer bootstraps',
  `  assert.match(bootstrap, /ensureScript\\('\\.\\/whatsapp-translation-hook-recovery\\.js', 'data-geek-whatsapp-translation-hook-recovery'\\)/,\n    'lightweight shell bootstrap must load the recovery owner');`,
  `  assert.doesNotMatch(bootstrap, /whatsapp-translation-hook-recovery\\.js/,\n    'legacy recovery must remain available only as compatibility code and must not bootstrap beside the direct-composer owner');`
]]);

patch('test/whatsapp-direct-composer-controller-contract.cjs', [[
  'bootstrap single owner contract',
  `  assert.match(bootstrapSource, /whatsapp-direct-composer-controller\\.js/, 'shell bootstrap must load the direct composer controller');\n  assert.doesNotMatch(bootstrapSource, /whatsapp-composer-public-fallback\\.js/, 'superseded fallback must leave the startup chain');`,
  `  assert.match(bootstrapSource, /whatsapp-direct-composer-controller\\.js/, 'shell bootstrap must load the direct composer controller');\n  assert.doesNotMatch(bootstrapSource, /whatsapp-translation-hook-recovery\\.js/, 'legacy translation recovery must not bootstrap beside the direct composer owner');\n  assert.doesNotMatch(bootstrapSource, /whatsapp-composer-public-fallback\\.js/, 'superseded fallback must leave the startup chain');`
]]);

patch('e2e/specs/whatsapp-wa-js-runtime.e2e.cjs', [
  [
    'runtime recovery absence evidence',
    `        recoveryInactive: !recovery?.controller || recovery.controller.signal?.aborted === true,\n        legacyFallbackInactive: !legacyFallback?.controller || legacyFallback.controller.signal?.aborted === true,`,
    `        recoveryAbsent: !recovery,\n        recoveryInactive: !recovery?.controller || recovery.controller.signal?.aborted === true,\n        legacyFallbackInactive: !legacyFallback?.controller || legacyFallback.controller.signal?.aborted === true,`
  ],
  [
    'runtime requires recovery absent',
    `    && state?.directComposerNativeReady === true\n    && state?.recoveryInactive === true`,
    `    && state?.directComposerNativeReady === true\n    && state?.recoveryAbsent === true\n    && state?.recoveryInactive === true`
  ],
  [
    'runtime recovery absence assertion',
    `    assert.equal(state.directComposerNativeReady, true, 'native private-send fallback must delegate into the same controller owner');\n    assert.equal(state.recoveryInactive, true, 'legacy recovery capture listener must be retired by the direct composer owner');`,
    `    assert.equal(state.directComposerNativeReady, true, 'native private-send fallback must delegate into the same controller owner');\n    assert.equal(state.recoveryAbsent, true, 'legacy recovery module must not bootstrap into a fresh WhatsApp guest');\n    assert.equal(state.recoveryInactive, true, 'legacy recovery capture listener must be retired by the direct composer owner');`
  ]
]);

for (const rel of [
  'scripts/apply-retire-whatsapp-recovery-bootstrap.cjs',
  '.github/workflows/apply-retire-whatsapp-recovery-bootstrap.yml',
]) {
  try { fs.unlinkSync(path.join(root, rel)); } catch {}
}

console.log('RETIRE_WHATSAPP_RECOVERY_BOOTSTRAP_PATCH_OK');
