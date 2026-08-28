'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const profile = require('../src/runtime-profile.cjs');

const appData = path.join('C:', 'Users', 'tester', 'AppData', 'Roaming');

assert.equal(profile.resolveRuntimeProfile({ isPackaged: false, packagedProfile: '' }), 'development');
assert.equal(profile.resolveRuntimeProfile({ isPackaged: true, packagedProfile: 'validation' }), 'validation');
assert.equal(profile.resolveRuntimeProfile({ isPackaged: true, packagedProfile: '' }), 'production');
assert.equal(profile.resolveRuntimeProfile({ isPackaged: true, packagedProfile: 'unexpected' }), 'production');

assert.equal(
  profile.defaultUserDataOverride({ appDataDir: appData, profile: 'development', explicitOverride: '' }),
  path.join(appData, 'geek-dev')
);
assert.equal(
  profile.defaultUserDataOverride({ appDataDir: appData, profile: 'validation', explicitOverride: '' }),
  path.join(appData, 'geek-validation')
);
assert.equal(
  profile.defaultUserDataOverride({ appDataDir: appData, profile: 'production', explicitOverride: '' }),
  ''
);

const explicit = path.join('D:', 'isolated', 'geek-test');
assert.equal(
  profile.defaultUserDataOverride({ appDataDir: appData, profile: 'validation', explicitOverride: explicit }),
  path.resolve(explicit),
  'explicit GEEK_USER_DATA_DIR must remain highest priority'
);

{
  const env = {};
  const configured = profile.configureRuntimeEnvironment({
    appDataDir: appData,
    isPackaged: false,
    packagedProfile: '',
    env,
  });
  assert.equal(configured.profile, 'development');
  assert.equal(env.GEEK_USER_DATA_DIR, path.join(appData, 'geek-dev'));
}

{
  const env = {};
  const configured = profile.configureRuntimeEnvironment({
    appDataDir: appData,
    isPackaged: true,
    packagedProfile: 'validation',
    env,
  });
  assert.equal(configured.profile, 'validation');
  assert.equal(env.GEEK_USER_DATA_DIR, path.join(appData, 'geek-validation'));
}

{
  const env = {};
  const configured = profile.configureRuntimeEnvironment({
    appDataDir: appData,
    isPackaged: true,
    packagedProfile: '',
    env,
  });
  assert.equal(configured.profile, 'production');
  assert.equal(env.GEEK_USER_DATA_DIR, undefined, 'production must retain the existing %APPDATA%/geek path logic');
}

console.log('RUNTIME_PROFILE_CONTRACT_OK');
