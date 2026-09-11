'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const uiDir = path.join(root, 'ui');
const stylePath = path.join(uiDir, 'style.css');
const styleMacPath = path.join(uiDir, 'style-mac.css');
const indexPath = path.join(uiDir, 'index.html');

const CORE_TOKENS = [
  'card-bg',
  'btn-bg',
  'hover-bg',
  'overlay-bg',
  'active-bg',
  'hover-strong',
  'input-bg',
  'scroll-thumb',
];
const FORBIDDEN_PATCH_STYLESHEETS = [
  'design-system.css',
  'theme-v2.css',
  'fix.css',
];

function extractRule(css, selector) {
  const marker = `${selector} {`;
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, `missing CSS rule: ${selector}`);

  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  assert.fail(`unterminated CSS rule: ${selector}`);
}

function parseDeclarations(ruleBody) {
  const declarations = new Map();
  const declarationPattern = /--([a-z0-9-]+)\s*:\s*([^;{}]+);/gi;
  let match;
  while ((match = declarationPattern.exec(ruleBody)) !== null) {
    declarations.set(match[1], match[2].trim());
  }
  return declarations;
}

function refs(value) {
  return [...String(value).matchAll(/var\(\s*--([a-z0-9-]+)/gi)].map((match) => match[1]);
}

function assertNoCycles(declarations, label) {
  const visiting = new Set();
  const visited = new Set();

  function visit(token, trail) {
    if (visiting.has(token)) {
      assert.fail(`${label}: custom-property dependency cycle: ${[...trail, token].map((name) => `--${name}`).join(' -> ')}`);
    }
    if (visited.has(token) || !declarations.has(token)) return;

    visiting.add(token);
    for (const dependency of refs(declarations.get(token))) {
      if (dependency === token) {
        assert.fail(`${label}: direct self-reference: --${token}`);
      }
      visit(dependency, [...trail, token]);
    }
    visiting.delete(token);
    visited.add(token);
  }

  for (const token of declarations.keys()) visit(token, []);
}

function assertResolves(token, declarations, label, stack = []) {
  assert.ok(declarations.has(token), `${label}: missing --${token}`);
  assert.ok(!stack.includes(token), `${label}: --${token} resolves through a dependency cycle`);

  for (const dependency of refs(declarations.get(token))) {
    assert.ok(declarations.has(dependency), `${label}: --${token} references missing --${dependency}`);
    assertResolves(dependency, declarations, label, [...stack, token]);
  }
}

function overlay(base, overrides) {
  return new Map([...base, ...overrides]);
}

function stylesheetOrder(indexHtml) {
  return [...indexHtml.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']\.\/([^"']+\.css)["'][^>]*>/gi)]
    .map((match) => match[1]);
}

function validateContract(styleCss, styleMacCss, indexHtml) {
  const darkBase = parseDeclarations(extractRule(styleCss, ':root'));
  const lightOverrides = parseDeclarations(extractRule(styleCss, ":root[data-theme='light']"));
  const macOverrides = parseDeclarations(extractRule(styleMacCss, ':root'));

  for (const token of CORE_TOKENS) {
    assert.ok(darkBase.has(token), `style.css dark base missing --${token}`);
    assert.ok(lightOverrides.has(token), `style.css light theme missing --${token}`);
  }

  assertNoCycles(darkBase, 'style.css dark base');
  assertNoCycles(lightOverrides, 'style.css light overrides');
  assertNoCycles(macOverrides, 'style-mac.css overrides');

  for (const token of CORE_TOKENS) {
    assertResolves(token, darkBase, 'style.css dark base');
  }

  const bgHoverDefinitions = [...styleCss.matchAll(/--bg-hover\s*:/g)].length;
  assert.equal(bgHoverDefinitions, 1, '--bg-hover must have exactly one compatibility-alias definition in style.css');
  assert.equal([...styleMacCss.matchAll(/--bg-hover\s*:/g)].length, 0, 'style-mac.css must not own --bg-hover');
  assert.equal(darkBase.get('bg-hover'), 'var(--hover-bg)', '--bg-hover must be a one-way alias to canonical --hover-bg');
  assert.ok(!refs(darkBase.get('hover-bg')).includes('bg-hover'), '--hover-bg must not point back to compatibility alias --bg-hover');

  const darkRuntime = overlay(darkBase, macOverrides);
  const lightRuntime = overlay(darkRuntime, lightOverrides);
  assertNoCycles(darkRuntime, 'dark runtime cascade');
  assertNoCycles(lightRuntime, 'light runtime cascade');
  for (const token of [...CORE_TOKENS, 'bg-hover']) {
    assertResolves(token, darkRuntime, 'dark runtime cascade');
    assertResolves(token, lightRuntime, 'light runtime cascade');
  }

  const stylesheets = stylesheetOrder(indexHtml);
  const styleIndex = stylesheets.indexOf('style.css');
  const styleMacIndex = stylesheets.indexOf('style-mac.css');
  assert.notEqual(styleIndex, -1, 'main Renderer must load style.css');
  assert.notEqual(styleMacIndex, -1, 'main Renderer must load style-mac.css');
  assert.ok(styleIndex < styleMacIndex, 'style.css must load before style-mac.css');

  for (const filename of FORBIDDEN_PATCH_STYLESHEETS) {
    assert.equal(fs.existsSync(path.join(uiDir, filename)), false, `${filename} must not be introduced as a token patch layer`);
  }
}

const styleCss = fs.readFileSync(stylePath, 'utf8');
const styleMacCss = fs.readFileSync(styleMacPath, 'utf8');
const indexHtml = fs.readFileSync(indexPath, 'utf8');

validateContract(styleCss, styleMacCss, indexHtml);

const selfReferenceMutation = styleCss.replace(
  /(--card-bg\s*:)\s*[^;]+;/,
  '$1 var(--card-bg);',
);
assert.notEqual(selfReferenceMutation, styleCss, 'self-reference mutation fixture must modify --card-bg');
assert.throws(
  () => validateContract(selfReferenceMutation, styleMacCss, indexHtml),
  /self-reference|dependency cycle/,
  'contract must fail when --card-bg is mutated back to a self-reference',
);

console.log('UI_DESIGN_TOKEN_CONTRACT_OK');
