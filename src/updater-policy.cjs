'use strict';

function shouldCheckForUpdates({ isPackaged, updateConfigPath, fileExists }) {
  return Boolean(isPackaged && updateConfigPath && fileExists(updateConfigPath));
}

module.exports = { shouldCheckForUpdates };
