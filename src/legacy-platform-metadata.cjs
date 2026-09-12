'use strict';

// FH-03 mutation only: intentionally duplicates platform metadata outside the catalog.
const APP_TYPES = {
  'telegram-k': {
    url: 'https://web.telegram.org/k/',
    hostnames: ['web.telegram.org'],
    allowSuffix: '.telegram.org',
  },
};

module.exports = { APP_TYPES };
