'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'resources', 'extensions', 'line-3.5.1');
const mainPath = path.join(root, 'static', 'js', 'main.js');
const mapPath = path.join(root, 'static', 'js', 'main.js.map');
const main = fs.readFileSync(mainPath, 'utf8');
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

const terms = [
  'icon_send_file',
  'type="file"',
  "type='file'",
  'input[type="file"]',
  'FileReader',
  'DataTransfer',
  'dragover',
  'drop',
  'upload',
  'sendFile',
  'sendImage',
  'attachment',
  'attachFile',
];

console.log('LINE_ATTACHMENT_STATIC_PROBE');
console.log(`main_bytes=${Buffer.byteLength(main)}`);
console.log(`map_sources=${Array.isArray(map.sources) ? map.sources.length : 0}`);

for (const term of terms) {
  let count = 0;
  let from = 0;
  while (true) {
    const at = main.indexOf(term, from);
    if (at < 0) break;
    count += 1;
    from = at + term.length;
  }
  console.log(`main_term ${JSON.stringify(term)} count=${count}`);
}

const sourceHits = [];
const sources = Array.isArray(map.sources) ? map.sources : [];
const contents = Array.isArray(map.sourcesContent) ? map.sourcesContent : [];
for (let i = 0; i < Math.min(sources.length, contents.length); i += 1) {
  const source = String(sources[i] || '');
  const content = String(contents[i] || '');
  if (!content) continue;
  const lower = content.toLowerCase();
  const matched = terms.filter(term => lower.includes(term.toLowerCase()));
  if (!matched.length) continue;
  sourceHits.push({ source, content, matched });
}

console.log(`source_hits=${sourceHits.length}`);
for (const hit of sourceHits.slice(0, 80)) {
  console.log(`SOURCE ${hit.source} TERMS ${hit.matched.join(',')}`);
  const lines = hit.content.split(/\r?\n/);
  let emitted = 0;
  for (let lineNo = 0; lineNo < lines.length && emitted < 16; lineNo += 1) {
    const line = lines[lineNo];
    if (!hit.matched.some(term => line.toLowerCase().includes(term.toLowerCase()))) continue;
    const safe = line.replace(/\s+/g, ' ').trim().slice(0, 500);
    console.log(`  L${lineNo + 1}: ${safe}`);
    emitted += 1;
  }
}

if (!sourceHits.length) {
  throw new Error('No attachment-related source-map modules found');
}
