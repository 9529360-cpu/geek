'use strict';

const fs = require('node:fs');

function cleanupPendingPartitions(pending, options = {}) {
  const removeSync = typeof options.removeSync === 'function'
    ? options.removeSync
    : (target) => fs.rmSync(target, { recursive: true, force: true });

  const targets = pending && typeof pending[Symbol.iterator] === 'function'
    ? Array.from(pending)
    : [];

  let removed = 0;
  let failed = 0;
  for (const target of targets) {
    try {
      removeSync(target);
      removed += 1;
      if (pending && typeof pending.delete === 'function') pending.delete(target);
    } catch {
      failed += 1;
    }
  }

  return {
    attempted: targets.length,
    removed,
    failed
  };
}

module.exports = { cleanupPendingPartitions };
