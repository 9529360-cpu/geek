'use strict';
// Build-time only. Do not create a second hand-maintained platform URL authority.
const { PLATFORM_CATALOG } = require('../../src/platform-catalog.cjs');
function exportPlatforms() {
  return Object.entries(PLATFORM_CATALOG).map(([id, p]) => ({
    id, name: p.name, family: p.navigationKind || id,
    familyLabel: p.familyLabel || (p.navigationKind || id).replace(/^./, (c) => c.toUpperCase()), url: p.url || null,
    hostnames: p.hostnames || [], allowSuffix: p.allowSuffix || null,
    needsExtension: p.needsExtension === true,
  }));
}
if (require.main === module) process.stdout.write(JSON.stringify(exportPlatforms()));
module.exports = { exportPlatforms };
