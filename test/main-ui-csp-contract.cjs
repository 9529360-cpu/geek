'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'ui', 'index.html');
const fontCssPath = path.join(root, 'ui', 'fonts.css');
const fontPath = path.join(root, 'ui', 'fonts', 'InterVariable.woff2');
const licensePath = path.join(root, 'ui', 'fonts', 'LICENSE.txt');
const builderPath = path.join(root, 'electron-builder.yml');

const html = fs.readFileSync(indexPath, 'utf8');
const builder = fs.readFileSync(builderPath, 'utf8');

function parseAttributes(tag) {
  const attributes = new Map();
  const body = tag.replace(/^<\w+\s*/i, '').replace(/\/?\s*>$/, '');
  const attributePattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = attributePattern.exec(body))) {
    const name = String(match[1] || '').toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attributes.set(name, value);
  }
  return attributes;
}

function parseCsp(value) {
  const directives = new Map();
  for (const rawDirective of String(value || '').split(';')) {
    const tokens = rawDirective.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const name = tokens.shift().toLowerCase();
    assert.equal(directives.has(name), false, `CSP directive must not be duplicated: ${name}`);
    directives.set(name, tokens);
  }
  return directives;
}

const metaTags = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => ({
  index: match.index,
  tag: match[0],
  attrs: parseAttributes(match[0]),
}));
const cspMetas = metaTags.filter(({ attrs }) => String(attrs.get('http-equiv') || '').toLowerCase() === 'content-security-policy');
assert.equal(cspMetas.length, 1, 'main UI must declare exactly one CSP meta tag');

const cspMeta = cspMetas[0];
const csp = parseCsp(cspMeta.attrs.get('content'));

const firstResourceIndex = [
  ...[...html.matchAll(/<script\b/gi)].map(match => match.index),
  ...[...html.matchAll(/<link\b[^>]*>/gi)]
    .filter(match => {
      const attrs = parseAttributes(match[0]);
      const rel = String(attrs.get('rel') || '').toLowerCase().split(/\s+/).filter(Boolean);
      return rel.some(value => ['stylesheet', 'preload', 'prefetch', 'preconnect', 'modulepreload'].includes(value));
    })
    .map(match => match.index),
].sort((a, b) => a - b)[0];
assert.ok(Number.isInteger(firstResourceIndex), 'main UI must contain resource/script tags for ordering check');
assert.ok(cspMeta.index < firstResourceIndex, 'CSP meta must appear before every stylesheet/script/resource link');

function directive(name) {
  assert.ok(csp.has(name), `CSP must declare ${name}`);
  return csp.get(name);
}

assert.deepEqual(directive('default-src'), ["'self'"], 'default-src must fail closed to local main-UI resources');
assert.deepEqual(directive('script-src'), ["'self'"], 'main renderer scripts must be local external files only');
assert.deepEqual(new Set(directive('style-src')), new Set(["'self'", "'unsafe-inline'"]), 'style-src may only keep self plus the temporary historical inline-style compatibility exception');
assert.deepEqual(directive('font-src'), ["'self'"], 'fonts must load only from the packaged application');
assert.deepEqual(directive('object-src'), ["'none'"], 'plugin/object content must be disabled');
assert.deepEqual(directive('base-uri'), ["'none'"], 'base URL rewriting must be disabled');
assert.deepEqual(directive('form-action'), ["'none'"], 'main renderer must not submit forms to arbitrary origins');

const forbiddenScriptSources = new Set(["'unsafe-inline'", "'unsafe-eval'", '*', 'http:', 'https:', 'data:', 'blob:']);
for (const source of directive('script-src')) {
  assert.equal(forbiddenScriptSources.has(source), false, `script-src must not contain ${source}`);
  assert.equal(/^https?:/i.test(source), false, `script-src must not contain public network source ${source}`);
}
for (const source of directive('style-src')) {
  assert.equal(source === "'self'" || source === "'unsafe-inline'", true, `style-src must not contain external source ${source}`);
}

assert.doesNotMatch(html, /fonts\.googleapis\.com/i, 'runtime main UI must not reference Google Fonts CSS');
assert.doesNotMatch(html, /fonts\.gstatic\.com/i, 'runtime main UI must not reference Google Fonts font hosts');
assert.match(html, /<link\b[^>]*href=["'](?:\.\/)?fonts\.css["'][^>]*>/i, 'main UI must load the local font stylesheet');

assert.equal(fs.existsSync(fontCssPath), true, 'local Inter stylesheet must exist');
assert.equal(fs.existsSync(fontPath), true, 'official Inter variable WOFF2 must exist');
assert.equal(fs.existsSync(licensePath), true, 'Inter OFL license must be retained next to the bundled font');

const fontCss = fs.readFileSync(fontCssPath, 'utf8');
assert.match(fontCss, /@font-face\s*\{/i, 'local font stylesheet must define @font-face');
assert.match(fontCss, /font-family\s*:\s*['"]Inter['"]/i, 'local font must preserve the existing Inter family name');
assert.match(fontCss, /font-style\s*:\s*normal/i, 'only the normal Inter face is required by the runtime UI');
assert.match(fontCss, /font-weight\s*:\s*100\s+900/i, 'Inter variable face must cover the official 100-900 weight range');
assert.match(fontCss, /font-display\s*:\s*swap/i, 'local Inter should retain upstream font-display behavior');
assert.match(fontCss, /url\(\s*['"]?\.\/fonts\/InterVariable\.woff2['"]?\s*\)/i, 'font CSS must reference the packaged WOFF2');
for (const match of fontCss.matchAll(/url\(([^)]+)\)/gi)) {
  const rawUrl = match[1].trim().replace(/^['"]|['"]$/g, '');
  assert.doesNotMatch(rawUrl, /^https?:/i, `font CSS must not reference network URL ${rawUrl}`);
}

assert.match(builder, /^\s*-\s+ui\/\*\*\/\*\s*$/m, 'electron-builder must keep packaging ui/**/* so the local font ships');

const productionSources = [
  path.join(root, 'src', 'main.cjs'),
  path.join(root, 'src', 'index.cjs'),
].filter(fs.existsSync).map(file => fs.readFileSync(file, 'utf8')).join('\n');
assert.doesNotMatch(productionSources, /--no-sandbox/i, 'production source must not disable the Chromium sandbox');
assert.doesNotMatch(productionSources, /webSecurity\s*:\s*false/i, 'production source must not disable webSecurity');
assert.doesNotMatch(productionSources, /allowRunningInsecureContent\s*:\s*true/i, 'production source must not allow insecure active content');
assert.doesNotMatch(productionSources, /bypassCSP\s*:\s*true/i, 'production source must not bypass renderer CSP');

const fuseFiles = fs.readdirSync(path.join(root, 'src')).filter(name => /fuse/i.test(name));
for (const name of fuseFiles) {
  const source = fs.readFileSync(path.join(root, 'src', name), 'utf8');
  assert.doesNotMatch(source, /runAsNode|enableNodeOptionsEnvironmentVariable|enableNodeCliInspectArguments/i, `main-UI CSP work must not loosen production Electron fuses via ${name}`);
}

console.log('main-ui-csp-contract: ok');
