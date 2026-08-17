'use strict';

function formatAccountReference(userId) {
  const numeric = Number(userId);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return '';
  return `GK-${String(numeric).padStart(6, '0')}`;
}

module.exports = { formatAccountReference };
