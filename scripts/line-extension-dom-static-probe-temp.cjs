'use strict';

const fs = require('node:fs');
const path = require('node:path');

const JS_DIR = path.join(__dirname, '..', 'resources', 'extensions', 'line-3.5.1', 'static', 'js');
const TOKENS = [
  '/chats/',
  'location.hash',
  'window.location.hash',
  'HashRouter',
  'createHashRouter',
  'useParams',
  'chatId',
  'roomId',
  'talkId',
];
const MAX_SNIPPETS_PER_TOKEN = 12;
const RADIUS = 260;

const files = fs.readdirSync(JS_DIR).filter(name => name.endsWith('.js')).sort();
let totalMatches = 0;
const routeLiterals = new Set();

for (const file of files) {
  const source = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
  const literalRe = /(["'`])([^"'`\r\n]{0,120}(?:chat|talk|room)[^"'`\r\n]{0,120})\1/gi;
  let literalMatch;
  while ((literalMatch = literalRe.exec(source))) {
    const value = literalMatch[2];
    if (/[\/#:]|route|path|hash|navigate/i.test(value)) routeLiterals.add(value);
    if (routeLiterals.size >= 120) break;
  }
}

for (const token of TOKENS) {
  let shown = 0;
  let matches = 0;
  console.log(`LINE_ROUTE_TOKEN_BEGIN ${token}`);
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
        console.log(`LINE_ROUTE_TOKEN_MATCH token=${token} file=${file} index=${index} snippet=${JSON.stringify(snippet)}`);
        shown += 1;
      }
      from = index + token.length;
    }
  }
  console.log(`LINE_ROUTE_TOKEN_END ${token} matches=${matches} shown=${shown}`);
}

console.log('LINE_ROUTE_LITERALS_BEGIN');
for (const value of [...routeLiterals].sort().slice(0, 120)) {
  console.log(`LINE_ROUTE_LITERAL ${JSON.stringify(value)}`);
}
console.log(`LINE_ROUTE_LITERALS_END count=${routeLiterals.size}`);

if (!totalMatches && !routeLiterals.size) {
  throw new Error('No LINE route evidence was found in bundled JavaScript');
}
console.log(`LINE_ROUTE_STATIC_PROBE_OK tokenMatches=${totalMatches} routeLiterals=${routeLiterals.size}`);
