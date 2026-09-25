'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const adapters = fs.readFileSync(path.join(root, 'ui', 'translation-adapters.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const lineBundle = fs.readFileSync(path.join(root, 'resources', 'extensions', 'line-3.5.1', 'static', 'js', 'main.js'), 'utf8');

assert.match(
  lineBundle,
  /\/:routeSegment\/:messageBoxId/,
  'bundled LINE must retain the two-segment message-box route used by the adapter contract'
);
assert.ok(
  adapters.includes("const pathname = String(location.hash || '').replace(/^#/, '').split('?')[0];"),
  'LINE adapter must normalize the hash-history pathname'
);
assert.ok(
  adapters.includes('const match = pathname.match(/^\\/[^/]+\\/([^/]+)\\/?$/);'),
  'LINE adapter must match exactly /:routeSegment/:messageBoxId'
);
assert.ok(
  adapters.includes("return match ? decodeURIComponent(match[1]) : '';"),
  'LINE adapter must decode the second route segment as messageBoxId'
);
assert.doesNotMatch(
  adapters,
  /location\.hash[^\n]*\/chats\//,
  'LINE adapter must not hard-code a /chats/ route that is absent from the bundled LINE router'
);

const platformStart = app.indexOf('const currentChatScripts = {');
const platformEnd = app.indexOf('const adapter = Object.freeze({', platformStart);
assert.ok(platformStart >= 0 && platformEnd > platformStart, 'LINE platform transport route owner must exist');
const platformRoute = app.slice(platformStart, platformEnd);
assert.ok(
  platformRoute.includes("const pathname = String(location.hash || '').replace(/^#/, '').split('?')[0];"),
  'LINE platform transport must normalize the hash-history pathname'
);
assert.ok(
  platformRoute.includes('const match = pathname.match(/^\\\\/[^/]+\\\\/([^/]+)\\\\/?$/);'),
  'LINE platform transport must match exactly /:routeSegment/:messageBoxId'
);
assert.ok(
  platformRoute.includes("return match ? decodeURIComponent(match[1]) : null;"),
  'LINE platform transport must decode the second route segment as messageBoxId'
);
assert.doesNotMatch(
  platformRoute,
  /\/chats\//,
  'LINE platform transport must not reintroduce the obsolete /chats/ route assumption'
);

console.log('LINE_TRANSLATION_ROUTE_CONTRACT_OK');
