'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const durableMarkdown = Object.freeze([
  'README.md',
  'AGENTS.md',
  '.agent/HANDOFF.md',
  'docs/README.md',
  'docs/GEEK-MAINTAINER-PROMPT.md',
  'docs/github-control-plane.md',
  'docs/release-security.md',
  'docs/windows-real-client-runner.md',
  'docs/account-password-reset-operations.md',
  'docs/account-number-rollout.md',
  'docs/translation-gateway-auth-design.md',
  'docs/翻译网关接口契约.md',
  'docs/账号沙箱数据边界.md',
  'docs/群发最终实现约束-20260824.md',
]);

function withoutFencedCode(markdown) {
  const output = [];
  let fence = null;
  for (const line of String(markdown || '').split(/\r?\n/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (!fence && marker) {
      fence = marker[1][0];
      output.push('');
      continue;
    }
    if (fence && marker && marker[1][0] === fence) {
      fence = null;
      output.push('');
      continue;
    }
    output.push(fence ? '' : line);
  }
  return output.join('\n');
}

function normalizeCandidate(raw) {
  let value = String(raw || '').trim();
  if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1).trim();
  if (!value || value.startsWith('#')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return null;
  value = value.split('#', 1)[0].split('?', 1)[0].trim();
  if (!value.toLowerCase().endsWith('.md')) return null;
  try { value = decodeURIComponent(value); } catch {}
  return value.replace(/\\/g, '/');
}

function markdownLinkTargets(markdown) {
  const source = withoutFencedCode(markdown);
  const targets = [];
  const linkPattern = /!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
  for (const match of source.matchAll(linkPattern)) {
    const candidate = normalizeCandidate(match[1]);
    if (candidate) targets.push({ raw: match[1], candidate, kind: 'link' });
  }
  return targets;
}

function backtickedMarkdownTargets(markdown) {
  const source = withoutFencedCode(markdown);
  const targets = [];
  const codePattern = /`([^`\r\n]+)`/g;
  for (const match of source.matchAll(codePattern)) {
    const token = String(match[1] || '').trim();
    if (!/^(?:\.\.?\/|[A-Za-z0-9_.\-\u0080-\uFFFF]+\/)*[A-Za-z0-9_.\-\u0080-\uFFFF]+\.md(?:#[^\s`]+)?$/u.test(token)) continue;
    const candidate = normalizeCandidate(token);
    if (candidate) targets.push({ raw: token, candidate, kind: 'backtick' });
  }
  return targets;
}

function isInsideRepository(target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveMarkdownReference(sourceFile, reference) {
  const sourceAbsolute = path.resolve(root, sourceFile);
  const candidate = reference.candidate;
  const attempts = reference.kind === 'backtick'
    ? [path.resolve(root, candidate), path.resolve(path.dirname(sourceAbsolute), candidate)]
    : [path.resolve(path.dirname(sourceAbsolute), candidate)];

  const uniqueAttempts = [...new Set(attempts)];
  for (const absolute of uniqueAttempts) {
    if (!isInsideRepository(absolute)) continue;
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      return { ok: true, absolute };
    }
  }

  const escaped = uniqueAttempts.some(absolute => !isInsideRepository(absolute));
  return { ok: false, escaped, attempts: uniqueAttempts };
}

// Parser behavior is part of the contract: examples/code snippets and network links are not governance references.
{
  const fixture = [
    '[local](docs/example.md)',
    '[external](https://example.com/docs/example.md)',
    '[anchor](#section)',
    '`docs/another.md`',
    '```md',
    '[ignored](docs/in-a-fence.md)',
    '`docs/also-ignored.md`',
    '```',
  ].join('\n');
  assert.deepEqual(markdownLinkTargets(fixture).map(item => item.candidate), ['docs/example.md']);
  assert.deepEqual(backtickedMarkdownTargets(fixture).map(item => item.candidate), ['docs/another.md']);
  assert.equal(normalizeCandidate('../outside.md'), '../outside.md');
}

const failures = [];
for (const sourceFile of durableMarkdown) {
  const absolute = path.resolve(root, sourceFile);
  assert.ok(isInsideRepository(absolute), `durable document path must stay inside repository: ${sourceFile}`);
  assert.ok(fs.existsSync(absolute), `durable governance document is missing: ${sourceFile}`);
  assert.ok(fs.statSync(absolute).isFile(), `durable governance document must be a file: ${sourceFile}`);

  const markdown = fs.readFileSync(absolute, 'utf8');
  const references = [...markdownLinkTargets(markdown), ...backtickedMarkdownTargets(markdown)];
  for (const reference of references) {
    const resolved = resolveMarkdownReference(sourceFile, reference);
    if (resolved.ok) continue;
    failures.push({
      sourceFile,
      raw: reference.raw,
      kind: reference.kind,
      escaped: resolved.escaped,
      attempts: (resolved.attempts || []).map(target => path.relative(root, target) || '.'),
    });
  }
}

assert.deepEqual(
  failures,
  [],
  `durable Markdown contains broken repository-local references:\n${failures.map((failure) => {
    const reason = failure.escaped ? 'escapes repository' : 'missing file';
    return `- ${failure.sourceFile}: ${failure.kind} ${JSON.stringify(failure.raw)} -> ${reason} (${failure.attempts.join(' | ')})`;
  }).join('\n')}`,
);

console.log(`DOCUMENTATION_REFERENCE_AUTHORITY_CONTRACT_OK files=${durableMarkdown.length}`);
