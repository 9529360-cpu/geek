'use strict';
// This is a build adapter, not a second UI design. Original files remain untouched.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { composeSession } = require('./prepare-session.cjs');
const ROOT = path.resolve(__dirname, '../..');
const OUTPUT = path.join(ROOT, 'desktop-tauri/src-tauri/target/ui');
const STYLES = ['fonts.css', 'style.css', 'style-mac.css', 'translation-settings.css',
  'contact-notes.css', 'settings-controller.css', 'broadcast-original.css', 'group-tools-original.css'];
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function compose(root = ROOT) {
  const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n?/g, '\n');
  const original = read('ui/index.html');
  const session = composeSession(read('ui/subscription.html'));
  if ((original.match(/<main class="app">/g) || []).length !== 1) throw new Error('Original UI structure changed');
  const css = [];
  let html = original
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s*<!-- Main file:[\s\S]*?-->/, '')
    .replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/i, '')
    .replace(/\sstyle="([^"]*)"/g, (_, declarations) => {
      if (/[{}<>]|url\s*\(|@/i.test(declarations)) throw new Error('Unreviewed original inline style');
      const name = `original-inline-${css.length}`;
      // Preserve the precedence of original inline declarations without unsafe-inline.
      css.push(`[data-original-style="${name}"] { ${declarations.replace(/;?\s*$/, ';')
        .replace(/([^;]+);/g, (_, rule) => `${rule.replace(/\s*!important\s*$/, '')} !important;`)} }`);
      return ` data-original-style="${name}"`;
    });
  if (/\son[a-z]+\s*=/i.test(html)) throw new Error('Original markup gained inline event code');
  const app = read('ui/app.js');
  const inventory = app.match(/const ICON_PATHS = \{([\s\S]*?)\n  \};/);
  if (!inventory) throw new Error('Original platform icons moved; review extraction');
  const icons = [...inventory[1].matchAll(/(\w+): '([^']+)'/g)].map(([, name, d]) => {
    if (!/^[a-z]+$/.test(name) || !/^[MmLlHhVvCcSsQqTtAaZz0-9., +\-]+$/.test(d)) throw new Error('Invalid original SVG');
    return `<template id="icon-${name}"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg></template>`;
  });
  if (icons.length !== 3) throw new Error('Review original icon inventory');
  icons.push('<template id="icon-website"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/>'
    + '<path d="M3 12h18M12 3c2.7 2.5 4 5.5 4 9s-1.3 6.5-4 9M12 3c-2.7 2.5-4 5.5-4 9s1.3 6.5 4 9"/></svg></template>');
  html = html.replace('</head>', '  <link rel="stylesheet" href="original-inline.css">\n'
    + '  <link rel="stylesheet" href="runtime.css">\n  <script type="module" src="app.mjs"></script>\n</head>')
    .replace('</body>', icons.join('\n') + '\n' + read('desktop-tauri/frontend/dialogs.html') + '\n' + session.html + '\n</body>');
  return { html, inlineCss: css.join('\n') + '\n', sessionCss: session.css, original };
}

function prepare(root = ROOT, output = OUTPUT) {
  const { html, inlineCss, sessionCss } = compose(root);
  fs.mkdirSync(output, { recursive: true });
  // A stale bundle must not retain removed scripts/assets between builds.
  for (const entry of fs.readdirSync(output)) fs.rmSync(path.join(output, entry), { recursive: true, force: true });
  fs.cpSync(path.join(root, 'desktop-tauri/frontend'), output, { recursive: true });
  fs.rmSync(path.join(output, 'dialogs.html'));
  fs.writeFileSync(path.join(output, 'index.html'), html);
  fs.writeFileSync(path.join(output, 'original-inline.css'), inlineCss);
  fs.writeFileSync(path.join(output, 'session-original.css'), sessionCss);
  const inputs = ['ui/index.html', 'ui/subscription.html', 'ui/app.js', ...STYLES.map((name) => `ui/${name}`)];
  for (const name of STYLES) fs.copyFileSync(path.join(root, 'ui', name), path.join(output, name));
  fs.cpSync(path.join(root, 'ui/fonts'), path.join(output, 'fonts'), { recursive: true });
  const manifest = Object.fromEntries(inputs.map((name) => [name, digest(fs.readFileSync(path.join(root, name)))]));
  fs.writeFileSync(path.join(output, 'ui-provenance.json'), JSON.stringify(manifest, null, 2) + '\n');
  return output;
}
if (require.main === module) console.log(`ORIGINAL_UI_PREPARED ${prepare()}`);
module.exports = { compose, prepare, STYLES, OUTPUT };
