'use strict';

const fs = require('node:fs');
const path = require('node:path');

const JS_DIR = path.join(__dirname, '..', 'resources', 'extensions', 'line-3.5.1', 'static', 'js');
const TOKENS = [
  'data-mid',
  'data-message-content',
  'data-is-message-text',
  'messageLayout-module__message__',
  'message-module__message__',
  'textMessageContent-module__content_wrap__',
  '/chats/',
];
const MAX_SNIPPETS_PER_TOKEN = 8;
const RADIUS = 220;

const files = fs.readdirSync(JS_DIR).filter(name => name.endsWith('.js')).sort();
let totalMatches = 0;

for (const token of TOKENS) {
  let shown = 0;
  let matches = 0;
  console.log(`LINE_DOM_TOKEN_BEGIN ${token}`);
  for (const file of files) {
    const source = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    let from = 0;
    while (from < source.length) {
      const index = source.indexOf(token, from);
      if (index < 0) break;
      matches += 1;
      totalMatches += 1;
      if (shown < MAX_SNIPPETS_PER_TOKEN) {
        const start = Math.max(0, index - RADIUS);
        const end = Math.min(source.length, index + token.length + RADIUS);
        const snippet = source.slice(start, end).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ');
        console.log(`LINE_DOM_TOKEN_MATCH token=${token} file=${file} index=${index} snippet=${JSON.stringify(snippet)}`);
        shown += 1;
      }
      from = index + token.length;
    }
  }
  console.log(`LINE_DOM_TOKEN_END ${token} matches=${matches} shown=${shown}`);
}

if (!totalMatches) {
  throw new Error('No known LINE DOM markers were found in bundled JavaScript');
}
console.log(`LINE_DOM_STATIC_PROBE_OK totalMatches=${totalMatches}`);
