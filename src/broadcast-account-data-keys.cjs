'use strict';

// Account-scoped broadcast state intentionally stays on the existing encrypted
// account-data boundary. Keep the extension explicit instead of allowing arbitrary
// renderer-selected keys.
const BROADCAST_ACCOUNT_DATA_KEYS = Object.freeze([
  'broadcastJobSchedules',
  'broadcastLegacyScheduleBackup',
  'broadcastLegacyScheduleNeedsReview',
  'broadcastScheduleMigrationV2',
  'broadcastExecutionCheckpoints',
]);

module.exports = { BROADCAST_ACCOUNT_DATA_KEYS };
