'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { classifyGatewayResponse } = require('../src/translation-runtime.cjs');

const workerPath = path.join(__dirname, '../scripts/geek-translate-worker.js');
const workerSource = fs.readFileSync(workerPath, 'utf8').replace(/\r\n?/g, '\n');

function loadDeadlineHelpers() {
  const executable = workerSource.replace(/^export default\s*/m, 'this.__worker = ')
    + '\nthis.__deadlineHelpers = { requestDeadlineAt, remainingBudgetMs, providerAttemptBudget };';
  const sandbox = {
    Response, Request, Headers, URL, TextEncoder, TextDecoder, AbortController, crypto,
    btoa, atob, console, setTimeout, clearTimeout,
  };
  vm.createContext(sandbox);
  vm.runInContext(executable, sandbox, { filename: 'geek-translate-worker.js' });
  return sandbox.__deadlineHelpers;
}

(() => {
  const { requestDeadlineAt, remainingBudgetMs, providerAttemptBudget } = loadDeadlineHelpers();

  assert.equal(typeof requestDeadlineAt, 'function');
  assert.equal(typeof remainingBudgetMs, 'function');
  assert.equal(typeof providerAttemptBudget, 'function');

  const now = 1_000;
  const requestWith = value => ({ headers: { get(name) { return name === 'X-Geek-Deadline-Ms' ? value : null; } } });

  assert.equal(requestDeadlineAt(requestWith('45000'), now), 31_000, 'Worker must cap any caller budget at the desktop 30s contract');
  assert.equal(requestDeadlineAt(requestWith('12000'), now), 13_000, 'Worker must honor a shorter remaining caller budget');
  assert.equal(requestDeadlineAt(requestWith(null), now), 31_000, 'legacy callers without a deadline header keep the bounded 30s compatibility budget');

  const deadlineAt = requestDeadlineAt(requestWith('30000'), now);
  assert.equal(providerAttemptBudget(deadlineAt, now), 15_000, 'first provider may use at most the provider timeout');
  assert.equal(providerAttemptBudget(deadlineAt, now + 15_000), 14_500, 'second provider receives only the remaining request budget minus finish reserve');
  assert.equal(providerAttemptBudget(deadlineAt, now + 29_500), 0, 'a provider must not start after the request budget is consumed');
  assert.equal(remainingBudgetMs(deadlineAt, now + 30_500), 0, 'remaining budget never goes negative');

  const shortDeadlineAt = requestDeadlineAt(requestWith('10000'), now);
  assert.equal(providerAttemptBudget(shortDeadlineAt, now), 9_500, 'short caller budgets must truncate the very first provider attempt');

  assert.match(workerSource, /X-Geek-Deadline-Ms/, 'Worker must accept the propagated desktop deadline header');
  assert.match(workerSource, /error:\s*'deadline_exceeded'[^\n]*504/, 'Worker must return a typed 504 deadline response rather than a generic provider failure');
  assert.match(
    workerSource,
    /translate\(text, target, env, deadlineAt, request\.signal\)/,
    'provider failover must share one absolute request deadline while also observing caller cancellation'
  );

  const classified = classifyGatewayResponse(504, { error: 'deadline_exceeded' });
  assert.equal(classified.code, 'TRANSLATION_DEADLINE_EXCEEDED');
  assert.equal(classified.category, 'deadline');
  assert.equal(classified.retryable, true);
  assert.equal(classified.endpointFailure, false, 'caller budget exhaustion must not poison gateway health');

  console.log('TRANSLATION_WORKER_DEADLINE_CONTRACT_OK');
})();
