'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const durableDocs = [
  'AGENTS.md',
  '.agent/HANDOFF.md',
  'README.md',
  'docs/README.md',
  'docs/GEEK-MAINTAINER-PROMPT.md',
  'docs/github-control-plane.md',
  'docs/release-security.md',
  'docs/FULL-STACK-HARDENING.md',
];

function stripFencedCode(source) {
  return source
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '');
}

function cleanTarget(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1).trim();
  const titleMatch = value.match(/^(\S+)(?:\s+["'][^"']*["'])$/);
  if (titleMatch) value = titleMatch[1];
  value = value.split('#', 1)[0].split('?', 1)[0];
  try { value = decodeURIComponent(value); } catch { /* keep literal path */ }
  return value.replace(/\\/g, '/');
}

function isExternal(value) {
  return !value || value.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//');
}

function resolveMarkdownLink(docPath, target) {
  return path.resolve(root, path.dirname(docPath), target);
}

function resolveBacktickedPath(docPath, target) {
  if (target.startsWith('./') || target.startsWith('../')) {
    return resolveMarkdownLink(docPath, target);
  }
  const repoRelative = path.resolve(root, target);
  if (fs.existsSync(repoRelative)) return repoRelative;
  return path.resolve(root, path.dirname(docPath), target);
}

function assertLocalMarkdownExists(docPath, rawTarget, mode) {
  const target = cleanTarget(rawTarget);
  if (isExternal(target) || !/\.md$/i.test(target)) return;
  const resolved = mode === 'link'
    ? resolveMarkdownLink(docPath, target)
    : resolveBacktickedPath(docPath, target);
  const insideRepo = resolved === root || resolved.startsWith(`${root}${path.sep}`);
  assert.ok(insideRepo, `${docPath} must not reference Markdown outside the repository: ${rawTarget}`);
  assert.ok(fs.existsSync(resolved), `${docPath} references missing repository Markdown: ${rawTarget}`);
  assert.ok(fs.statSync(resolved).isFile(), `${docPath} Markdown reference must be a file: ${rawTarget}`);
}

for (const docPath of durableDocs) {
  const absolute = path.join(root, docPath);
  assert.ok(fs.existsSync(absolute), `durable governance document is missing: ${docPath}`);
  const source = stripFencedCode(fs.readFileSync(absolute, 'utf8'));

  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    assertLocalMarkdownExists(docPath, match[1], 'link');
  }
  for (const match of source.matchAll(/`([^`\n]+\.md(?:[?#][^`\s]*)?)`/g)) {
    assertLocalMarkdownExists(docPath, match[1], 'backtick');
  }
}

console.log('DOCUMENTATION_AUTHORITY_CONTRACT_OK');
