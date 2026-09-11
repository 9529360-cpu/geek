'use strict';

const { config: baseConfig } = require('./wdio.conf.cjs');

exports.config = {
  ...baseConfig,
  specs: ['./restart-specs/scheduled-attachment-restart.e2e.cjs'],
};
