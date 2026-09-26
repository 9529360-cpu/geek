'use strict';

const assert = require('node:assert/strict');
const {
  LINE_CONTEXT_ISOLATION_CANDIDATE_ENV,
  isLineContextIsolationCandidateEnabled,
  applyLineContextIsolationPolicy,
  lineWebPreferencesAttribute,
} = require('../src/line-context-isolation-policy.cjs');

assert.equal(
  isLineContextIsolationCandidateEnabled({ isPackaged: false, env: {} }),
  false,
);
assert.equal(
  isLineContextIsolationCandidateEnabled({
    isPackaged: false,
    env: { [LINE_CONTEXT_ISOLATION_CANDIDATE_ENV]: '1' },
  }),
  true,
);
assert.equal(
  isLineContextIsolationCandidateEnabled({
    isPackaged: false,
    env: { [LINE_CONTEXT_ISOLATION_CANDIDATE_ENV]: ' 1 ' },
  }),
  true,
);
assert.equal(
  isLineContextIsolationCandidateEnabled({
    isPackaged: false,
    env: { [LINE_CONTEXT_ISOLATION_CANDIDATE_ENV]: 'true' },
  }),
  false,
);
assert.equal(
  isLineContextIsolationCandidateEnabled({
    isPackaged: true,
    env: { [LINE_CONTEXT_ISOLATION_CANDIDATE_ENV]: '1' },
  }),
  false,
  'packaged clients must never opt into an unapproved candidate through inherited environment',
);

{
  const webPreferences = { preload: 'legacy.js', contextIsolation: false, sandbox: true };
  const result = applyLineContextIsolationPolicy({
    webPreferences,
    candidateEnabled: true,
    legacyPreloadPath: 'legacy.js',
    candidatePreloadPath: 'C:/app/resources/extensions/line-3.5.1/geek-isolated-preload.cjs',
  });
  assert.equal(result.candidateEnabled, true);
  assert.equal(webPreferences.contextIsolation, true);
  assert.equal(webPreferences.preload, 'C:/app/resources/extensions/line-3.5.1/geek-isolated-preload.cjs');
  assert.equal(webPreferences.sandbox, true);
}

{
  const webPreferences = { contextIsolation: true, sandbox: true };
  const result = applyLineContextIsolationPolicy({
    webPreferences,
    candidateEnabled: false,
    legacyPreloadPath: 'C:/app/resources/s3loYR.js',
  });
  assert.equal(result.candidateEnabled, false);
  assert.equal(webPreferences.contextIsolation, false);
  assert.equal(webPreferences.preload, 'C:/app/resources/s3loYR.js');
  assert.equal(webPreferences.sandbox, true);
}

assert.throws(
  () => applyLineContextIsolationPolicy({ webPreferences: {}, candidateEnabled: true }),
  /candidatePreloadPath is required/,
);
assert.throws(
  () => applyLineContextIsolationPolicy({ webPreferences: {}, candidateEnabled: false }),
  /legacyPreloadPath is required/,
);
assert.equal(
  lineWebPreferencesAttribute(false),
  'contextIsolation=no,sandbox=true,nativeWindowOpen=yes,spellcheck=no,backgroundThrottling=false',
);
assert.equal(
  lineWebPreferencesAttribute(true),
  'contextIsolation=yes,sandbox=true,nativeWindowOpen=yes,spellcheck=no,backgroundThrottling=false',
);

console.log('LINE_CONTEXT_ISOLATION_POLICY_CONTRACT_OK');
