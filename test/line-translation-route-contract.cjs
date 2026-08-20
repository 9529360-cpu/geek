'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adapters = fs.readFileSync(path.join(root, 'ui', 'translation-adapters.js'), 'utf8');
const lineBundle = fs.readFileSync(path.join(root, 'resources', 'extensions', 'line-3.5.1', 'static', 'js', 'main.js'), 'utf8');

assert.match(
  lineBundle,
  /\/:routeSegment\/:messageBoxId/,
  'bundled LINE must retain the two-segment message-box route used by the adapter contract'
);
assert.match(
  adapters,
  /const chatId = \(\) => \{\s*try \{\s*const pathname = String\(location\.hash \|\| ''\)\.replace\(\/\^#\/, ''\)\.split\('\?'\)\[0\];\s*const match = pathname\.match\(\/\^\\\/\[\^\\\/\]\+\\\/\(\[\^\\\/\]\+\)\\\/?\$\/\);\s*return match \? decodeURIComponent\(match\[1\]\) : '';\s*\} catch \{ return ''; \}\s*\};/,
  'LINE adapter must read messageBoxId from /:routeSegment/:messageBoxId hash routes'
);
assert.doesNotMatch(
  adapters,
  /location\.hash[^\n]*\/chats\//,
  'LINE adapter must not hard-code a /chats/ route that is absent from the bundled LINE router'
);

console.log('LINE_TRANSLATION_ROUTE_CONTRACT_OK');
