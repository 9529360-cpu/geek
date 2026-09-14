'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const profile = require('../src/runtime-profile.cjs');

const appData = path.join('C:', 'Users', 'tester', 'AppData', 'Roaming');

assert.equal(profile.resolveRuntimeProfile({ isPackaged: false, packagedProfile: '' }), 'development');
assert.equal(profile.resolveRuntimeProfile({ isPackaged: true, packagedProfile: 'validation' }), 'validation');
assert.equal(profile.resolveRuntimeProfile({ isPackaged: true, packagedProfile: '' }), 'production');
assert.equal(profile.resolveRuntimeProfile({ isPackaged: true, packagedProfile: 'unexpected' }), 'production');
assert.equal(profile.defaultUserDataOverride({ appDataDir: appData, profile: 'development', explicitOverride: '' }), path.join(appData, 'geek-dev'));
assert.equal(profile.defaultUserDataOverride({ appDataDir: appData, profile: 'validation', explicitOverride: '' }), path.join(appData, 'geek-validation'));
assert.equal(profile.defaultUserDataOverride({ appDataDir: appData, profile: 'production', explicitOverride: '' }), '');
const explicit = path.join('D:', 'isolated', 'geek-test');
assert.equal(profile.defaultUserDataOverride({ appDataDir: appData, profile: 'validation', explicitOverride: explicit }), path.resolve(explicit));

{
  const env = {};
  const configured = profile.configureRuntimeEnvironment({ appDataDir: appData, isPackaged: false, packagedProfile: '', env });
  assert.equal(configured.profile, 'development');
  assert.equal(configured.userDataOverride, path.join(appData, 'geek-dev'));
  assert.equal(env.GEEK_USER_DATA_DIR, path.join(appData, 'geek-dev'));
}
{
  const env = {};
  const configured = profile.configureRuntimeEnvironment({ appDataDir: appData, isPackaged: true, packagedProfile: 'validation', env });
  assert.equal(configured.profile, 'validation');
  assert.equal(configured.userDataOverride, path.join(appData, 'geek-validation'));
  assert.equal(env.GEEK_USER_DATA_DIR, path.join(appData, 'geek-validation'));
}
{
  const env = {};
  const configured = profile.configureRuntimeEnvironment({ appDataDir: appData, isPackaged: true, packagedProfile: '', env });
  assert.equal(configured.profile, 'production');
  assert.equal(configured.userDataOverride, '');
  assert.equal(env.GEEK_USER_DATA_DIR, undefined);
}
{
  const override = path.join('D:', 'isolated', '..', 'validation-profile');
  const env = { GEEK_USER_DATA_DIR: override };
  const configured = profile.configureRuntimeEnvironment({ appDataDir: appData, isPackaged: true, packagedProfile: 'validation', env });
  const normalized = path.resolve(override);
  assert.equal(configured.profile, 'validation');
  assert.equal(configured.userDataOverride, normalized, 'validation explicit override must be normalized before use');
  assert.equal(env.GEEK_USER_DATA_DIR, normalized, 'validation env must expose only the normalized isolated profile');
}
{
  const override = path.join('D:', 'isolated', '..', 'development-profile');
  const env = { GEEK_USER_DATA_DIR: override };
  const configured = profile.configureRuntimeEnvironment({ appDataDir: appData, isPackaged: false, packagedProfile: '', env });
  const normalized = path.resolve(override);
  assert.equal(configured.profile, 'development');
  assert.equal(configured.userDataOverride, normalized, 'development explicit override must be normalized before use');
  assert.equal(env.GEEK_USER_DATA_DIR, normalized, 'development env must expose only the normalized isolated profile');
}
{
  const env = { GEEK_USER_DATA_DIR: path.join('D:', 'should-not-be-production') };
  const configured = profile.configureRuntimeEnvironment({ appDataDir: appData, isPackaged: true, packagedProfile: '', env });
  assert.equal(configured.profile, 'production');
  assert.equal(configured.userDataOverride, '', 'formal production must never inherit the test profile override');
  assert.equal(Object.hasOwn(env, 'GEEK_USER_DATA_DIR'), false, 'production must remove the override before later runtime path resolution');
}
{
  const env = { GEEK_USER_DATA_DIR: '   ' };
  const configured = profile.configureRuntimeEnvironment({ appDataDir: appData, isPackaged: true, packagedProfile: 'validation', env });
  assert.equal(configured.userDataOverride, path.join(appData, 'geek-validation'), 'blank override must fall back to the validation profile');
  assert.equal(env.GEEK_USER_DATA_DIR, path.join(appData, 'geek-validation'));
}

console.log('RUNTIME_PROFILE_CONTRACT_OK');
