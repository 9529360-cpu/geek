'use strict';

const fs = require('node:fs');
const path = require('node:path');

const JS_DIR = path.join(__dirname, '..', 'resources', 'extensions', 'line-3.5.1', 'static', 'js');
const files = fs.readdirSync(JS_DIR).filter(name => name.endsWith('.js')).sort();
const NEEDLES = [
  '/:routeSegment/:messageBoxId',
  '/:currentSegment/:messageBoxId',
  '/:_/:messageBoxId',
  'messageBoxId',
  'routeSegment',
  'currentSegment',
];
const RADIUS = 1100;
let total = 0;

for (const needle of NEEDLES) {
  let shown = 0;
  let matches = 0;
  console.log(`LINE_MESSAGE_ROUTE_BEGIN ${needle}`);
  for (const file of files) {
    const source = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
    let from = 0;
    while (from < source.length) {
      const index = source.indexOf(needle, from);
      if (index < 0) break;
      matches += 1;
      total += 1;
      if (shown < 10) {
        const start = Math.max(0, index - RADIUS);
        const end = Math.min(source.length, index + needle.length + RADIUS);
        const snippet = source.slice(start, end).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ');
        console.log(`LINE_MESSAGE_ROUTE_MATCH token=${needle} file=${file} index=${index} snippet=${JSON.stringify(snippet)}`);
        shown += 1;
      }
      from = index + needle.length;
    }
  }
  console.log(`LINE_MESSAGE_ROUTE_END ${needle} matches=${matches} shown=${shown}`);
}

if (!total) throw new Error('No LINE message route definitions found');
console.log(`LINE_MESSAGE_ROUTE_PROBE_OK total=${total}`);
