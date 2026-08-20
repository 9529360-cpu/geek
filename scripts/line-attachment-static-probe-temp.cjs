'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'resources', 'extensions', 'line-3.5.1');
const terms = [
  'icon_send_file',
  'send_file',
  'sendFile',
  'fileInput',
  'type:"file"',
  "type:'file'",
  'input[type="file"]',
  'FileReader',
  'DataTransfer',
  'dragover',
  'ondrop',
  'upload',
  'accept:"image',
  'accept:"*',
  '.files',
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(?:js|css|html)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function countOf(haystack, needle) {
  let count = 0;
  let from = 0;
  while (true) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + Math.max(1, needle.length);
  }
}

function contexts(text, needle, max = 8) {
  const out = [];
  let from = 0;
  while (out.length < max) {
    const at = text.indexOf(needle, from);
    if (at < 0) break;
    const start = Math.max(0, at - 320);
    const end = Math.min(text.length, at + needle.length + 520);
    out.push(text.slice(start, end).replace(/\s+/g, ' ').trim());
    from = at + Math.max(1, needle.length);
  }
  return out;
}

console.log('LINE_ATTACHMENT_STATIC_PROBE');
const files = walk(root);
console.log(`asset_text_files=${files.length}`);
let totalHits = 0;
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const hits = terms.map(term => [term, countOf(text, term)]).filter(([, count]) => count > 0);
  if (!hits.length) continue;
  totalHits += hits.reduce((sum, [, count]) => sum + count, 0);
  console.log(`FILE ${rel} bytes=${Buffer.byteLength(text)}`);
  for (const [term, count] of hits) {
    console.log(`  TERM ${JSON.stringify(term)} count=${count}`);
    for (const snippet of contexts(text, term, 6)) console.log(`    CTX ${snippet}`);
  }
}
console.log(`total_hits=${totalHits}`);
if (!totalHits) throw new Error('No attachment-related bundle evidence found');
