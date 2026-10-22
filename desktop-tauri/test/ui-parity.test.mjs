import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { families, visibleAccounts, viewportOf } from '../frontend/models/shell.mjs';
const { compose, prepare, STYLES } = createRequire(import.meta.url)('../scripts/prepare-frontend.cjs');
const root = fileURLToPath(new URL('../../', import.meta.url));

test('build reuses the canonical original markup and styles without copying Electron execution', () => {
  const { html, original } = compose();
  const main = (text) => text.slice(text.indexOf('<main class="app">'), text.indexOf('</main>') + 7);
  const withoutInline = (s) => s.replace(/\s(?:style|data-original-style)="[^"]*"/g, '');
  assert.equal(withoutInline(main(html)), withoutInline(main(original)));
  const oldIds = [...original.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  for (const id of oldIds) assert.ok(html.includes(`id="${id}"`), id);
  assert.equal([...html.matchAll(/<script\b/g)].length, 1);
  assert.match(html, /<script type="module" src="app.mjs">/);
  assert.doesNotMatch(html, /\sstyle=|\sonclick=|unsafe-inline|<script src=/);
  const output = mkdtempSync(join(tmpdir(), 'geek original UI '));
  try {
    prepare(root, output);
    for (const name of STYLES) assert.deepEqual(readFileSync(join(output, name)), readFileSync(join(root, 'ui', name)));
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test('family grouping follows canonical platform metadata, not one tab per account', () => {
  const state = { platforms: [{ id: 'tg-z', family: 'telegram', name: 'TelegramZ' },
    { id: 'tg-k', family: 'telegram', name: 'TelegramK' }], accounts: [
    { id: 'a', platformId: 'tg-z' }, { id: 'b', platformId: 'tg-k' }, { id: 'c', platformId: 'tg-z', archived: true }] };
  assert.equal(families(state).length, 1);
  assert.deepEqual(visibleAccounts(state, 'telegram').map((a) => a.id), ['a', 'b']);
});

test('viewport DTO excludes owner, URL and scripts and refuses invalid measurements', () => {
  const element = { getBoundingClientRect: () => ({ x: 176, y: 35, width: 784, height: 605, secret: 'never transmitted' }) };
  assert.deepEqual(viewportOf(element, false), { x: 176, y: 35, width: 784, height: 605, visible: false });
  assert.throws(() => viewportOf({ getBoundingClientRect: () => ({ x: NaN, y: 0, width: 10, height: 10 }) }, true));
});
