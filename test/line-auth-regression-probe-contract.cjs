'use strict';

const assert = require('node:assert/strict');
const {
  collectAuthenticatedLineState,
  buildProbeExpression
} = require('../scripts/line-auth-regression-probe.cjs');

(async () => {
  const fakeToken = 'secret-access-token-value';
  const fakeHmac = 'secret-hmac-value';
  const calls = [];
  const fakeRoot = {
    GeekAuthenticatedEventSource() {},
    _pluginKD() {},
    g_plugin_enc: () => ({ getAccessToken: () => fakeToken }),
    g_plugin_hmac: () => ({
      getHmac: async input => {
        calls.push(input);
        return fakeHmac;
      }
    })
  };

  const state = await collectAuthenticatedLineState(fakeRoot, { readyState: 'complete' });
  assert.deepEqual(state, {
    pageReady: true,
    tokenManagerAvailable: true,
    accessTokenPresent: true,
    hmacManagerAvailable: true,
    hmacProduced: true,
    authenticatedEventSourceAvailable: true,
    pluginKeyWrapperAvailable: true
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].accessToken, fakeToken);
  assert.equal(calls[0].path, '/api/operation/receive');

  const serialized = JSON.stringify(state);
  assert.doesNotMatch(serialized, /secret-access-token-value/);
  assert.doesNotMatch(serialized, /secret-hmac-value/);

  const expression = buildProbeExpression();
  assert.match(expression, /accessTokenPresent/);
  assert.match(expression, /hmacProduced/);
  assert.doesNotMatch(expression, /console\./);
  assert.doesNotMatch(expression, /document\.cookie/);
  assert.doesNotMatch(expression, /localStorage/);
  assert.doesNotMatch(expression, /location\.href/);

  const missing = await collectAuthenticatedLineState({}, { readyState: 'loading' });
  assert.deepEqual(missing, {
    pageReady: false,
    tokenManagerAvailable: false,
    accessTokenPresent: false,
    hmacManagerAvailable: false,
    hmacProduced: false,
    authenticatedEventSourceAvailable: false,
    pluginKeyWrapperAvailable: false
  });

  console.log('LINE_AUTH_REGRESSION_PROBE_CONTRACT_OK');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
