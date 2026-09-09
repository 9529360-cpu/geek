'use strict';

const path = require('node:path');

function isPathInside(parentDir, candidateDir) {
  const relative = path.relative(path.resolve(parentDir), path.resolve(candidateDir));
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function isE2EShellLaunchAllowed({ isPackaged, profile, env = process.env, tempDir }) {
  if (env.GEEK_E2E !== '1') return false;
  if (isPackaged || profile !== 'development') return false;
  const rawUserData = String(env.GEEK_USER_DATA_DIR || '').trim();
  if (!rawUserData || !tempDir) return false;
  const resolved = path.resolve(rawUserData);
  if (!path.basename(resolved).startsWith('geek-e2e-')) return false;
  return isPathInside(tempDir, resolved);
}

function configureE2ESafeStorageBackend({
  isPackaged,
  profile,
  env = process.env,
  tempDir,
  commandLine,
  platform = process.platform,
}) {
  if (!isE2EShellLaunchAllowed({ isPackaged, profile, env, tempDir })) return false;
  if (platform !== 'linux') return true;
  if (!commandLine || typeof commandLine.appendSwitch !== 'function') return false;
  commandLine.appendSwitch('password-store', 'gnome-libsecret');
  return true;
}

function installSubscriptionStartupBypass({
  isPackaged,
  profile,
  env = process.env,
  tempDir,
  subscriptionModule,
}) {
  if (!isE2EShellLaunchAllowed({ isPackaged, profile, env, tempDir })) return false;
  if (!subscriptionModule || typeof subscriptionModule.createSubscriptionStore !== 'function') return false;

  const originalFactory = subscriptionModule.createSubscriptionStore;
  let startupReadPending = true;
  subscriptionModule.createSubscriptionStore = function createE2EStartupStore(...args) {
    const store = originalFactory(...args);
    if (!store || typeof store.getState !== 'function') return store;
    const realGetState = store.getState.bind(store);
    return Object.freeze({
      ...store,
      getState: async (...stateArgs) => {
        if (startupReadPending) {
          startupReadPending = false;
          return Object.freeze({ loggedIn: true, e2eShellOnly: true });
        }
        return realGetState(...stateArgs);
      },
    });
  };
  return true;
}

module.exports = {
  isPathInside,
  isE2EShellLaunchAllowed,
  configureE2ESafeStorageBackend,
  installSubscriptionStartupBypass,
};
