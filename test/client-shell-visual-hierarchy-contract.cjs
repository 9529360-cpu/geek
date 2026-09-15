'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const baseCss = fs.readFileSync(path.join(root, 'ui', 'style.css'), 'utf8');
const shellCss = fs.readFileSync(path.join(root, 'ui', 'style-mac.css'), 'utf8');

assert.match(
  baseCss,
  /\.tab-dot\s*\{[\s\S]*?display:\s*none;/,
  'base shell must keep the unread dot owner',
);
assert.match(
  baseCss,
  /\.tab-item\.flash\s+\.p-icon\s*\{[^}]*animation:\s*tab-flash/,
  'base shell must continue marking unread platform state independently of the visual override',
);
assert.match(
  shellCss,
  /\.tab-item\.flash\s+\.p-icon\s*\{[^}]*animation:\s*none;[^}]*opacity:\s*1;/,
  'active visual layer must use the unread dot without continuously flashing the platform icon',
);

assert.match(
  shellCss,
  /#btn-app-center\s*\{[^}]*background:\s*var\(--accent-soft\);[^}]*border-color:\s*var\(--accent-border\);/,
  'Application Center must remain the emphasized shell entry point',
);
assert.match(
  shellCss,
  /#btn-restart,\s*#btn-lock,\s*#btn-settings\s*\{[^}]*background:\s*transparent;[^}]*border-color:\s*transparent;/,
  'maintenance controls must remain available but visually secondary',
);
assert.doesNotMatch(
  shellCss,
  /#btn-(?:restart|lock|settings)[^{]*\{[^}]*display:\s*none/s,
  'maintenance controls must not be hidden',
);

assert.match(
  shellCss,
  /\.nav-account\.active::before\s*\{[^}]*background:\s*var\(--accent\);/,
  'active account must use a compact accent indicator',
);
assert.match(
  shellCss,
  /\.nav-account\.active\s*\{[^}]*background:\s*var\(--active-bg\);/,
  'active account body should use the neutral active surface',
);
assert.match(
  shellCss,
  /\.win-controls\s*\{[^}]*border-left:\s*1px solid var\(--border-subtle\);/,
  'native window chrome must be visually separated from product actions',
);
assert.match(
  shellCss,
  /\.quick-btn:focus-visible,[\s\S]*?\.nav-account:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\);/,
  'shell controls must expose visible keyboard focus',
);

console.log('client shell visual hierarchy contract: ok');
