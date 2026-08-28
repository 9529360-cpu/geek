'use strict';

const path = require('node:path');

const PROFILE_SUBDIRS = Object.freeze({
  development: 'geek-dev',
  validation: 'geek-validation',
});

function resolveRuntimeProfile({ isPackaged, packagedProfile }) {
  if (!isPackaged) return 'development';
  return String(packagedProfile || '').trim().toLowerCase() === 'validation'
    ? 'validation'
    : 'production';
}

function defaultUserDataOverride({ appDataDir, profile, explicitOverride }) {
  if (explicitOverride) return path.resolve(explicitOverride);
  const subdir = PROFILE_SUBDIRS[profile];
  return subdir ? path.join(appDataDir, subdir) : '';
}

function configureRuntimeEnvironment({ appDataDir, isPackaged, packagedProfile, env = process.env }) {
  const profile = resolveRuntimeProfile({ isPackaged, packagedProfile });
  const explicitOverride = env.GEEK_USER_DATA_DIR;
  const isolatedDir = defaultUserDataOverride({ appDataDir, profile, explicitOverride });
  if (!explicitOverride && isolatedDir) env.GEEK_USER_DATA_DIR = isolatedDir;
  return Object.freeze({ profile, userDataOverride: explicitOverride || isolatedDir || '' });
}

module.exports = {
  PROFILE_SUBDIRS,
  resolveRuntimeProfile,
  defaultUserDataOverride,
  configureRuntimeEnvironment,
};
