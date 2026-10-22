'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { CODE, GENERATED_DIRS, REVIEW_LINES, MAX_LINES, checkFile, lineCount } = require('./architecture-policy.cjs');

function collect(root) {
  const files = new Map();
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (entry.isSymbolicLink()) throw new Error(`${relative}: source symlinks are not allowed`);
      if (entry.isDirectory()) {
        if (!GENERATED_DIRS.has(relative)) visit(full);
      } else if (entry.isFile() && CODE.test(relative)) {
        files.set(relative, fs.readFileSync(full, 'utf8'));
      }
    }
  }
  visit(root);
  return files;
}

function sameNames(actual, expected, label, failures) {
  const ordered = [...actual].sort();
  if (new Set(actual).size !== actual.length
      || JSON.stringify(ordered) !== JSON.stringify([...expected].sort())) {
    failures.push(`${label}: command list differs from contracts/commands.json`);
  }
}

function checkCommands(files) {
  const failures = [];
  const get = (name) => {
    if (!files.has(name)) throw new Error(`Missing architecture input: ${name}`);
    return files.get(name);
  };
  const manifest = JSON.parse(get('contracts/commands.json'));
  const names = manifest.commands.map((command) => command.name);
  if (manifest.version !== 1 || names.some((name) => !/^[a-z]+(?:_[a-z]+)+$/.test(name))) {
    failures.push('Invalid version or command identifier in contracts/commands.json');
  }
  const source = get('src-tauri/src/desktop/commands.rs');
  sameNames([...source.matchAll(/#\[tauri::command\]\s+pub async fn (\w+)/g)].map((m) => m[1]), names,
    'Rust ingress', failures);
  for (const command of manifest.commands) {
    const signature = new RegExp(`pub async fn ${command.name}\\s*\\(([\\s\\S]*?)\\)\\s*->\\s*Result<([^>]+)>`).exec(source);
    if (!signature) { failures.push(`${command.name}: missing typed command signature`); continue; }
    const inputs = [...signature[1].matchAll(/\b([a-z_]+)\s*:(?!:)/g)]
      .map((match) => match[1]).filter((name) => !['webview', 'state'].includes(name))
      .map((name) => name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()));
    sameNames(inputs, command.arguments, `${command.name} arguments`, failures);
    const response = signature[2].trim() === '()' ? 'unit' : signature[2].trim();
    if (response !== command.response) failures.push(`${command.name}: response type differs from manifest`);
  }
  sameNames([...get('src-tauri/src/bootstrap.rs').matchAll(/commands::(\w+)/g)].map((m) => m[1]), names,
    'Rust handler registration', failures);
  const permission = get('src-tauri/permissions/shell.toml').match(/commands\.allow\s*=\s*\[([^\]]*)\]/s);
  sameNames([...(permission?.[1] || '').matchAll(/"([a-z_]+)"/g)].map((m) => m[1]), names,
    'Tauri permission', failures);
  sameNames([...get('frontend/api/desktop.mjs').matchAll(/invoke\(\s*'([a-z_]+)'/g)].map((m) => m[1]), names,
    'Frontend gateway', failures);
  if (!get('src-tauri/build.rs').includes('command-manifest.cjs')) {
    failures.push('Build must read AppManifest commands from the canonical command manifest');
  }
  for (const section of source.split('#[tauri::command]').slice(1)) {
    if (!/\{\s*execute\(webview, state,/.test(section)) {
      failures.push('Rust command bypasses shared sender authorization/execution boundary');
    }
  }
  return failures;
}

function frontendOwner(name) {
  if (name === 'frontend/app.mjs') return 'app';
  if (name.startsWith('frontend/api/')) return 'api';
  for (const owner of ['controller', 'view', 'model']) {
    if (name === `frontend/${owner}.mjs` || name.startsWith(`frontend/${owner}s/`)) return owner;
  }
  return null;
}

function checkFrontendGraph(files) {
  const failures = [];
  const graph = new Map();
  for (const [name, source] of files) {
    if (!name.startsWith('frontend/') || !name.endsWith('.mjs')) continue;
    const dependencies = [];
    for (const [, specifier] of source.matchAll(/\b(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
      if (!specifier.startsWith('.')) {
        failures.push(`${name}: undeclared external frontend dependency`);
        continue;
      }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier));
      if (!target.startsWith('frontend/') || !files.has(target)) {
        failures.push(`${name}: dependency escapes frontend or is missing: ${target}`);
      }
      const owner = frontendOwner(name);
      const targetOwner = frontendOwner(target);
      const allowed = {
        app: ['api', 'controller'], controller: ['controller', 'view', 'model'],
        view: ['view', 'model'], model: ['model'], api: ['api'],
      };
      if (!owner || !targetOwner || !allowed[owner].includes(targetOwner)) {
        failures.push(`${name}: frontend dependency direction violation: ${target}`);
      }
      dependencies.push(target);
    }
    if (/\b(?:import|require)\s*\(/.test(source)) failures.push(`${name}: dynamic module loading needs explicit review`);
    graph.set(name, dependencies);
  }
  const active = new Set();
  const done = new Set();
  function visit(name) {
    if (active.has(name)) { failures.push(`${name}: frontend import cycle`); return; }
    if (done.has(name)) return;
    active.add(name);
    for (const target of graph.get(name) || []) visit(target);
    active.delete(name);
    done.add(name);
  }
  for (const name of graph.keys()) visit(name);
  return failures;
}

function inspect(root) {
  const files = collect(root);
  const failures = [...files].flatMap(([name, source]) => checkFile(name, source));
  failures.push(...checkCommands(files), ...checkFrontendGraph(files));
  const sizes = [...files].map(([name, source]) => ({ name, lines: lineCount(source) }))
    .sort((a, b) => b.lines - a.lines || a.name.localeCompare(b.name));
  return { failures, sizes };
}

if (require.main === module) {
  try {
    const result = inspect(path.resolve(__dirname, '..'));
    for (const size of result.sizes.filter((file) => file.lines > REVIEW_LINES)) {
      console.warn(`REVIEW_SIZE ${size.name}: ${size.lines} lines (split by responsibility)`);
    }
    if (result.failures.length) throw new Error(result.failures.join('\n'));
    console.log(`ARCHITECTURE_OK files=${result.sizes.length} max=${result.sizes[0]?.lines || 0} hardLimit=${MAX_LINES}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { collect, inspect, checkCommands, checkFrontendGraph };
