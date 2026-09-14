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
  const explicitOverride = String(env.GEEK_USER_DATA_DIR || '').trim();

  // The formal packaged client has one fixed profile identity. GEEK_USER_DATA_DIR is
  // an isolation seam for development/validation only; inheriting it in production
  // would redirect accounts, Sessions, single-instance ownership and maintenance to
  // an arbitrary profile before main composition can recover the intended path.
  if (profile === 'production') {
    delete env.GEEK_USER_DATA_DIR;
    return Object.freeze({ profile, userDataOverride: '' });
  }

  const isolatedDir = defaultUserDataOverride({ appDataDir, profile, explicitOverride });
  if (isolatedDir) env.GEEK_USER_DATA_DIR = isolatedDir;
  else delete env.GEEK_USER_DATA_DIR;
  return Object.freeze({ profile, userDataOverride: isolatedDir || '' });
}

module.exports = {
  PROFILE_SUBDIRS,
  resolveRuntimeProfile,
  defaultUserDataOverride,
  configureRuntimeEnvironment,
};
