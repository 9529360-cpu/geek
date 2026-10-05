'use strict';

const UNSAFE_ELECTRON_SWITCHES = Object.freeze([
  'ignore-certificate-errors',
  'disable-web-security',
  'no-sandbox',
  'allow-running-insecure-content',
]);

function argvSwitchNames(argv = []) {
  if (!Array.isArray(argv)) return [];
  const names = [];
  for (const rawValue of argv) {
    const raw = String(rawValue || '').trim();
    if (raw === '--') break;
    if (!raw.startsWith('--') || raw.length <= 2) continue;
    const name = raw.slice(2).split('=', 1)[0].trim().toLowerCase();
    if (name) names.push(name);
  }
  return names;
}

function findUnsafeElectronSwitches({ argv = [], commandLine = null } = {}) {
  const requested = new Set(argvSwitchNames(argv));
  if (commandLine && typeof commandLine.hasSwitch === 'function') {
    for (const name of UNSAFE_ELECTRON_SWITCHES) {
      if (commandLine.hasSwitch(name)) requested.add(name);
    }
  }
  return Object.freeze(UNSAFE_ELECTRON_SWITCHES.filter(name => requested.has(name)));
}

function assertSafeElectronStartup(options = {}) {
  const unsafe = findUnsafeElectronSwitches(options);
  const allowed = new Set(Array.isArray(options.allowUnsafeForIsolatedE2E) ? options.allowUnsafeForIsolatedE2E : []);
  const blocked = unsafe.filter(name => !allowed.has(name));
  if (!blocked.length) return Object.freeze({ ok: true, blocked: Object.freeze(unsafe) });
  const error = new Error('UNSAFE_ELECTRON_STARTUP_SWITCH');
  error.code = 'UNSAFE_ELECTRON_STARTUP_SWITCH';
  error.switches = Object.freeze(blocked);
  throw error;
}

module.exports = {
  UNSAFE_ELECTRON_SWITCHES,
  argvSwitchNames,
  findUnsafeElectronSwitches,
  assertSafeElectronStartup,
};
