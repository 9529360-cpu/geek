'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const controllerPath = path.join(root, 'ui', 'whatsapp-direct-composer-controller.js');
const actionablePath = path.join(root, 'test', 'whatsapp-direct-composer-actionable-errors-contract.cjs');
const contractPath = path.join(root, 'test', 'whatsapp-direct-composer-controller-contract.cjs');
const runtimePath = path.join(root, 'e2e', 'specs', 'whatsapp-wa-js-runtime.e2e.cjs');
const workflowPath = path.join(root, '.github', 'workflows', 'apply-translation-failure-discriminator.yml');
const selfPath = __filename;

function patchFile(filePath, patches) {
  let source = fs.readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n');
  for (const [label, before, after] of patches) {
    const first = source.indexOf(before);
    if (first < 0) throw new Error(`Missing patch anchor (${path.basename(filePath)}): ${label}`);
    if (source.indexOf(before, first + before.length) >= 0) throw new Error(`Ambiguous patch anchor (${path.basename(filePath)}): ${label}`);
    source = source.slice(0, first) + after + source.slice(first + before.length);
  }
  fs.writeFileSync(filePath, source);
}

patchFile(controllerPath, [
  [
    'controller generation',
    '  const CONTROLLER_VERSION = 2;',
    '  const CONTROLLER_VERSION = 3;'
  ],
  [
    'typed discriminator notices',
    `    if (category === 'bridge' || code.startsWith('TRANSLATION_BRIDGE_')) {\n      return \`翻译连接状态异常，请刷新当前账号后重试；\${tail}\`;\n    }\n    if (category === 'gateway' || category === 'rate-limit' || status >= 500) {\n      return \`翻译服务暂时不可用，请稍后重试；\${tail}\`;\n    }\n    return restored ? '翻译失败，原文已恢复，请重试' : '翻译失败，原文未发送';`,
    `    if (category === 'bridge' || code.startsWith('TRANSLATION_BRIDGE_')) {\n      return \`翻译连接状态异常，请刷新当前账号后重试；\${tail}\`;\n    }\n    if (category === 'input' || status === 400 || status === 404 || status === 413 || status === 422) {\n      if (code === 'TRANSLATION_TARGET_INVALID' || code === 'invalid_target') {\n        return \`翻译目标语言配置无效，请重新选择目标语言；\${tail}\`;\n      }\n      const safeCode = /^[A-Za-z0-9_.:-]{1,100}$/.test(code) ? code : 'TRANSLATION_INPUT';\n      return \`翻译请求参数无效（\${safeCode}），请检查翻译设置；\${tail}\`;\n    }\n    if (category === 'account' || code === 'TRANSLATION_ACCOUNT_MISSING' || code === 'TRANSLATION_ACCOUNT_DELETED') {\n      return \`翻译账号状态异常，请刷新当前账号后重试；\${tail}\`;\n    }\n    if (category === 'conflict' || status === 409) {\n      return \`翻译请求状态冲突，请重试；\${tail}\`;\n    }\n    if (category === 'gateway' || category === 'rate-limit' || status >= 500) {\n      return \`翻译服务暂时不可用，请稍后重试；\${tail}\`;\n    }\n    const safeCode = /^[A-Za-z0-9_.:-]{1,100}$/.test(code) ? code : '';\n    if (safeCode) return \`翻译失败（\${safeCode}）；\${tail}\`;\n    return restored ? '翻译失败（未分类），原文已恢复，请重试' : '翻译失败（未分类），原文未发送';`
  ]
]);

patchFile(actionablePath, [
  [
    'actionable generation',
    "assert.equal(controller.CONTROLLER_VERSION, 2, 'actionable diagnostics must force a fresh direct-composer generation');",
    "assert.equal(controller.CONTROLLER_VERSION, 3, 'failure discriminator diagnostics must force a fresh direct-composer generation');"
  ],
  [
    'typed discriminator fixtures',
    `for (const fixture of cases) {\n  const direct = controller.parseTranslationFailure(envelopedError(fixture.detail));\n  const legacy = recovery.parseTranslationFailure(envelopedError(fixture.detail));\n\n  assert.equal(direct.code, fixture.detail.code);\n  assert.equal(direct.category, fixture.detail.category);\n  assert.equal(direct.status, fixture.detail.status);\n  assert.equal(direct.retryable, fixture.detail.retryable === true);\n  assert.equal(direct.message, 'safe diagnostic');\n\n  const directNotice = controller.translationFailureNotice(direct, false);\n  const recoveryNotice = recovery.translationFailureNotice(legacy, false);\n  assert.match(directNotice, fixture.expected);\n  assert.equal(directNotice, recoveryNotice, \`direct composer failure semantics drifted for \${fixture.detail.code}\`);\n}\n`,
    `for (const fixture of cases) {\n  const direct = controller.parseTranslationFailure(envelopedError(fixture.detail));\n  const legacy = recovery.parseTranslationFailure(envelopedError(fixture.detail));\n\n  assert.equal(direct.code, fixture.detail.code);\n  assert.equal(direct.category, fixture.detail.category);\n  assert.equal(direct.status, fixture.detail.status);\n  assert.equal(direct.retryable, fixture.detail.retryable === true);\n  assert.equal(direct.message, 'safe diagnostic');\n\n  const directNotice = controller.translationFailureNotice(direct, false);\n  const recoveryNotice = recovery.translationFailureNotice(legacy, false);\n  assert.match(directNotice, fixture.expected);\n  assert.equal(directNotice, recoveryNotice, \`direct composer failure semantics drifted for \${fixture.detail.code}\`);\n}\n\nconst discriminatorCases = [\n  { detail: { code: 'TRANSLATION_TARGET_INVALID', category: 'input', status: 400 }, expected: /目标语言配置无效.*原文未发送/ },\n  { detail: { code: 'invalid_route', category: 'input', status: 400 }, expected: /请求参数无效.*invalid_route.*原文未发送/ },\n  { detail: { code: 'TRANSLATION_ACCOUNT_MISSING', category: 'account' }, expected: /账号状态异常.*原文未发送/ },\n  { detail: { code: 'TRANSLATION_REQUEST_CONFLICT', category: 'conflict', status: 409 }, expected: /状态冲突.*原文未发送/ },\n  { detail: { code: 'FUTURE_TYPED_FAILURE', category: 'other' }, expected: /FUTURE_TYPED_FAILURE.*原文未发送/ },\n];\nfor (const fixture of discriminatorCases) {\n  const direct = controller.parseTranslationFailure(envelopedError(fixture.detail));\n  assert.match(controller.translationFailureNotice(direct, false), fixture.expected);\n}\n`
  ],
  [
    'plain unclassified notice',
    "  assert.equal(controller.translationFailureNotice(legacy, false), '翻译失败，原文未发送');",
    "  assert.equal(controller.translationFailureNotice(legacy, false), '翻译失败（未分类），原文未发送');"
  ],
  [
    'malformed unclassified notice',
    "  assert.equal(controller.translationFailureNotice(malformed, false), '翻译失败，原文未发送');",
    "  assert.equal(controller.translationFailureNotice(malformed, false), '翻译失败（未分类），原文未发送');"
  ]
]);

patchFile(contractPath, [
  ['controller contract generation', '  assert.equal(controller.CONTROLLER_VERSION, 2);', '  assert.equal(controller.CONTROLLER_VERSION, 3);']
]);

patchFile(runtimePath, [
  ['runtime ready generation', '    && state?.directComposerVersion === 2', '    && state?.directComposerVersion === 3'],
  ['runtime assertion generation', "    assert.equal(state.directComposerVersion, 2, 'direct composer controller must match the tested owner generation');", "    assert.equal(state.directComposerVersion, 3, 'direct composer controller must match the tested owner generation');"]
]);

for (const temporary of [selfPath, workflowPath]) {
  try { fs.unlinkSync(temporary); } catch {}
}

console.log('TRANSLATION_FAILURE_DISCRIMINATOR_PATCH_OK');
