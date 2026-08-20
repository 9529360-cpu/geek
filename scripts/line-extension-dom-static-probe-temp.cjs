'use strict';

const fs = require('node:fs');
const path = require('node:path');

const JS_DIR = path.join(__dirname, '..', 'resources', 'extensions', 'line-3.5.1', 'static', 'js');
const files = fs.readdirSync(JS_DIR).filter(name => name.endsWith('.js')).sort();
const pathLiterals = new Set();
const routeContext = [];

for (const file of files) {
  const source = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
  const literalRe = /(["'`])([^"'`\r\n]{1,100})\1/g;
  let match;
  while ((match = literalRe.exec(source))) {
    const value = match[2];
    const normalized = value.replace(/\\\//g, '/');
    const looksLikeRoute =
      /^\/[a-z0-9_:-]+(?:\/[a-z0-9_:.?&=-]+)*\/?$/i.test(normalized) ||
      /^(?:chat|chats|talk|room|rooms|friends|home|main)(?:\/[a-z0-9_:-]+)+\/?$/i.test(normalized);
    if (!looksLikeRoute) continue;
    if (/^\/(?:api|r|static|assets?|images?|fonts?|sounds?|talk\/thrift)\b/i.test(normalized)) continue;
    pathLiterals.add(normalized);
  }

  for (const needle of ['location.hash.substr(1)', "window.location.hash.replace(/^#/, '')"]) {
    let from = 0;
    while (from < source.length) {
      const index = source.indexOf(needle, from);
      if (index < 0) break;
      const start = Math.max(0, index - 1800);
      const end = Math.min(source.length, index + needle.length + 1800);
      routeContext.push({ file, needle, index, snippet: source.slice(start, end).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ') });
      from = index + needle.length;
    }
  }
}

console.log('LINE_ROUTE_PATHS_BEGIN');
for (const value of [...pathLiterals].sort()) console.log(`LINE_ROUTE_PATH ${JSON.stringify(value)}`);
console.log(`LINE_ROUTE_PATHS_END count=${pathLiterals.size}`);

console.log('LINE_ROUTE_CONTEXT_BEGIN');
for (const item of routeContext.slice(0, 12)) {
  console.log(`LINE_ROUTE_CONTEXT file=${item.file} needle=${JSON.stringify(item.needle)} index=${item.index} snippet=${JSON.stringify(item.snippet)}`);
}
console.log(`LINE_ROUTE_CONTEXT_END count=${routeContext.length}`);

if (!pathLiterals.size && !routeContext.length) throw new Error('No LINE route path evidence found');
console.log(`LINE_ROUTE_PATH_PROBE_OK paths=${pathLiterals.size} contexts=${routeContext.length}`);
