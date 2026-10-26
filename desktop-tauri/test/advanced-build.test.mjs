import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { composeAdvanced } = require('../scripts/prepare-advanced.cjs');
const { compose, prepare } = require('../scripts/prepare-frontend.cjs');
const root = fileURLToPath(new URL('../../', import.meta.url));
const original = fs.readFileSync(path.join(root, 'ui/advanced-tools-workbench.js'), 'utf8').replace(/\r\n?/g, '\n');

// Observe the active original module's actual assignments. This reference does
// not use the extraction expressions or any Tauri view implementation.
async function originalPresentation() {
  const created = [];
  let click;
  const node = () => {
    const children = [];
    const selectors = new Map();
    const value = { children, dataset: {}, append(...items) { children.push(...items); }, appendChild(item) { children.push(item); },
      replaceChildren(...items) { children.splice(0, children.length, ...items); }, setAttribute() {}, addEventListener() {},
      classList: { add() {}, remove() {} },
      querySelector(selector) { if (!selectors.has(selector)) selectors.set(selector, node()); return selectors.get(selector); } };
    created.push(value); return value;
  };
  const document = { readyState: 'loading', head: node(), body: node(), createElement: node,
    getElementById: (id) => created.find((item) => item.id === id) || null,
    addEventListener(type, fn, capture) { if (type === 'click') { assert.equal(capture, true); click = fn; } } };
  const context = vm.createContext({ window: {}, document, module: { exports: {} } });
  vm.runInContext(original, context, { filename: 'original-advanced-tools-workbench.js' });
  context.module.exports.install(document);
  let intercepted = false;
  click({ target: { closest: (selector) => selector === '#bc-menu-export' ? {} : null },
    preventDefault() {}, stopImmediatePropagation() { intercepted = true; } });
  await Promise.resolve();
  assert.equal(intercepted, true);
  return { css: document.getElementById('advanced-tools-workbench-style').textContent,
    overlay: document.getElementById('advanced-tools-overlay') };
}

test('advanced shell and CSS are identical to the active original module presentation', async () => {
  const reference = await originalPresentation();
  const actual = composeAdvanced(original);
  assert.equal(actual.css, reference.css);
  assert.equal(actual.html, `<div id="${reference.overlay.id}" class="${reference.overlay.className}">${reference.overlay.innerHTML}</div>`);
  const built = compose(root);
  assert.ok(built.html.includes(actual.html));
  assert.equal(built.advancedCss, reference.css);
  assert.match(built.html, /href="advanced-original\.css"/);
  assert.doesNotMatch(built.html, /<script[^>]+advanced-tools-workbench|<style|\sonclick=/i);
});

test('unreviewed source structure and dynamic presentation cannot silently enter the shell', () => {
  for (const changed of [
    original.replace('function ensureShell(doc = document)', 'function changedShell(doc = document)'),
    original.replace('style.textContent = `', 'style.textContent = `${window.synthetic}'),
    original.replace('<div class="at-dialog">', '<div class="at-dialog" onclick="synthetic()">'),
    original.replace('overlay.innerHTML =', "overlay.innerHTML = '<div></div>';\n    overlay.innerHTML ="),
    original.replace('#advanced-tools-overlay{z-index:1200}', '@import "unreviewed.css";'),
  ]) assert.throws(() => composeAdvanced(changed), /Original|Unreviewed/);
});

test('prepared artifact has extracted external CSS and exact original source provenance', () => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'geek-advanced-build-'));
  try {
    prepare(root, output);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'ui-provenance.json'), 'utf8'));
    assert.equal(manifest['ui/advanced-tools-workbench.js'],
      createHash('sha256').update(fs.readFileSync(path.join(root, 'ui/advanced-tools-workbench.js'))).digest('hex'));
    assert.equal(fs.readFileSync(path.join(output, 'advanced-original.css'), 'utf8'), composeAdvanced(original).css);
    assert.equal(fs.existsSync(path.join(output, 'advanced-tools-workbench.js')), false);
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});
