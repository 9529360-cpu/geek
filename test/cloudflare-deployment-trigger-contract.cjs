'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const normalize = (value) => String(value).replace(/\r\n?/g, '\n');
const read = (relativePath) => normalize(fs.readFileSync(path.join(root, relativePath), 'utf8'));

const services = [
  { name: 'website', workflow: '.github/workflows/deploy-website.yml', config: 'wrangler-website.toml' },
  { name: 'subscription', workflow: '.github/workflows/deploy-subscription.yml', config: 'wrangler-subscription.toml' },
  { name: 'translation', workflow: '.github/workflows/deploy-translate.yml', config: 'wrangler-translate.toml' },
  { name: 'release', workflow: '.github/workflows/deploy-release-worker.yml', config: 'wrangler.toml' },
];

function stripYamlQuotes(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function pushPaths(workflowPath) {
  const lines = read(workflowPath).split('\n');
  const result = [];
  let inPush = false;
  let inPaths = false;

  for (const line of lines) {
    if (/^  push:\s*$/.test(line)) {
      inPush = true;
      inPaths = false;
      continue;
    }
    if (inPush && /^  [A-Za-z0-9_-]+:\s*$/.test(line)) break;
    if (inPush && /^    paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (!inPaths) continue;

    const item = line.match(/^      -\s+(.+?)\s*$/);
    if (item) {
      result.push(stripYamlQuotes(item[1]));
      continue;
    }
    if (line.trim() && !/^      /.test(line)) break;
  }

  assert.ok(inPush, `${workflowPath} must keep a push trigger`);
  assert.ok(inPaths, `${workflowPath} must define push.paths`);
  assert.ok(result.length > 0, `${workflowPath} push.paths must not be empty`);
  assert.equal(new Set(result).size, result.length, `${workflowPath} push.paths must not contain duplicates`);
  return result;
}

function wranglerMain(configPath) {
  const match = read(configPath).match(/^\s*main\s*=\s*["']([^"']+)["']\s*$/m);
  assert.ok(match, `${configPath} must define a Wrangler main entry`);
  return match[1].replace(/\\/g, '/');
}

function localModuleSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s+[\s\S]*?\sfrom\s*(["'])(\.{1,2}\/[^"'\n]+)\1/g,
    /\bimport\s*(["'])(\.{1,2}\/[^"'\n]+)\1/g,
    /\bimport\s*\(\s*(["'])(\.{1,2}\/[^"'\n]+)\1\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) specifiers.add(match[2]);
  }
  return [...specifiers];
}

function resolveLocalModule(importerPath, specifier) {
  const clean = specifier.split(/[?#]/, 1)[0];
  const importerDir = path.dirname(path.join(root, importerPath));
  const base = path.resolve(importerDir, clean);
  const candidates = path.extname(base)
    ? [base]
    : [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, path.join(base, 'index.js'), path.join(base, 'index.mjs'), path.join(base, 'index.cjs')];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  assert.ok(resolved, `${importerPath} imports missing local module ${specifier}`);
  const relative = path.relative(root, resolved).replace(/\\/g, '/');
  assert.ok(!relative.startsWith('../') && relative !== '..', `${importerPath} import ${specifier} must stay inside the repository`);
  return relative;
}

function dependencyClosure(entryPath) {
  const visited = new Set();
  const pending = [entryPath];

  while (pending.length > 0) {
    const current = pending.pop();
    if (visited.has(current)) continue;
    visited.add(current);
    const source = read(current);
    for (const specifier of localModuleSpecifiers(source)) {
      const dependency = resolveLocalModule(current, specifier);
      if (!visited.has(dependency)) pending.push(dependency);
    }
  }

  return [...visited].sort();
}

const forbiddenAutomaticInputs = [
  (value) => value.startsWith('test/'),
  (value) => value.startsWith('docs/'),
  (value) => value.startsWith('.github/workflows/'),
  (value) => value === 'scripts/cloudflare-deploy-report.cjs',
  (value) => value === 'scripts/account-live-smoke.mjs',
];

for (const service of services) {
  const automaticPaths = pushPaths(service.workflow);
  const entry = wranglerMain(service.config);
  const closure = dependencyClosure(entry);
  const expected = new Set([service.config, ...closure]);
  const actual = new Set(automaticPaths);

  for (const automaticPath of automaticPaths) {
    assert.ok(
      !forbiddenAutomaticInputs.some((predicate) => predicate(automaticPath)),
      `${service.name}: non-production input must not automatically deploy production: ${automaticPath}`
    );
    assert.ok(
      expected.has(automaticPath),
      `${service.name}: non-deployable automatic production input: ${automaticPath}`
    );
  }

  for (const deployablePath of expected) {
    assert.ok(
      actual.has(deployablePath),
      `${service.name}: missing deployable dependency from production push.paths: ${deployablePath}`
    );
  }

  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    `${service.name}: production push.paths must equal Wrangler config + local deployable dependency closure`
  );
}

const validationPath = '.github/workflows/cloudflare-worker-validation.yml';
const validation = read(validationPath);
assert.match(validation, /^name: cloudflare-worker-validation$/m);
assert.match(validation, /^  pull_request:$/m, 'Worker validation must run on pull requests');
assert.match(validation, /^  push:$/m, 'Worker validation must run on master pushes');
assert.match(validation, /^      - master$/m, 'Worker validation master push boundary is required');
assert.match(validation, /^permissions:\n  contents: read$/m, 'Worker validation permissions must be read-only');
assert.doesNotMatch(validation, /^\s+issues:\s*write\s*$/m, 'Worker validation must not write Issues');
assert.doesNotMatch(validation, /^\s+environment:\s*$/m, 'Worker validation must not enter a production environment');
assert.doesNotMatch(validation, /secrets\.|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_INFRA_API_TOKEN/, 'Worker validation must not consume production credentials');
assert.match(validation, /run: npm ci --ignore-scripts/);
assert.match(validation, /run: npm test/);
assert.match(validation, /node --check/, 'Worker validation must syntax-check Worker/deployment JavaScript');
assert.match(validation, /- 'scripts\/\*\*'/, 'Worker/deployment script changes must trigger validation');
assert.match(validation, /- 'test\/\*\*'/, 'contract/test changes must trigger validation');
assert.match(validation, /- 'wrangler\*\.toml'/, 'Wrangler config changes must trigger validation');
assert.match(validation, /- '\.github\/workflows\/deploy-\*\.yml'/, 'production deploy workflow changes must trigger validation');
assert.match(validation, /- '\.github\/workflows\/cloudflare-worker-validation\.yml'/, 'validation workflow changes must validate themselves');

const dryRunLines = validation.split('\n').filter((line) => /wrangler@4\.36\.0 deploy\b/.test(line));
assert.equal(dryRunLines.length, 4, 'Worker validation must dry-run all four Wrangler production configs');
for (const line of dryRunLines) {
  assert.match(line, /\bdeploy\s+--dry-run\b/, 'every validation Wrangler deploy command must be dry-run only');
  assert.match(line, /\s--outdir\s+/, 'every validation Wrangler dry-run must emit an inspectable bundle');
  assert.match(line, /\s--config\s+/, 'every validation Wrangler dry-run must name an explicit config');
}
for (const configPath of services.map((service) => service.config)) {
  const escaped = configPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(validation, new RegExp(`wrangler@4\\.36\\.0 deploy --dry-run .* --config ${escaped}`), `${configPath} must have a Wrangler dry-run`);
}

console.log('CLOUDFLARE_DEPLOYMENT_TRIGGER_CONTRACT_OK');
