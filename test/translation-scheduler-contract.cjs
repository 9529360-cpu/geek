'use strict';

const assert = require('node:assert/strict');
const {
  createTranslationScheduler,
  PRIORITY_INTERACTIVE,
  PRIORITY_BACKGROUND,
} = require('../src/translation-scheduler.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function flush(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) await new Promise(resolve => setImmediate(resolve));
}

(async () => {
  {
    const scheduler = createTranslationScheduler({
      concurrency: 4,
      interactiveReserve: 1,
      backgroundPerPartitionActive: 2,
    });
    const gates = [];
    const started = [];
    const background = [];
    for (let index = 0; index < 4; index += 1) {
      const gate = deferred();
      gates.push(gate);
      background.push(scheduler.enqueue({
        partition: 'a',
        priority: PRIORITY_BACKGROUND,
        deadlineAt: Date.now() + 5000,
        task: async () => { started.push(`bg-${index}`); await gate.promise; },
      }));
    }
    await flush();
    assert.equal(started.length, 2, 'one partition cannot monopolize background active slots');

    const interactiveGate = deferred();
    const interactive = scheduler.enqueue({
      partition: 'a',
      priority: PRIORITY_INTERACTIVE,
      deadlineAt: Date.now() + 5000,
      task: async () => { started.push('interactive'); await interactiveGate.promise; return 'ok'; },
    });
    await flush();
    assert.ok(started.includes('interactive'), 'reserved capacity must remain available for interactive sends');
    interactiveGate.resolve();
    gates.forEach(gate => gate.resolve());
    await Promise.all([interactive, ...background]);
  }

  {
    const scheduler = createTranslationScheduler({
      concurrency: 4,
      interactiveReserve: 1,
      backgroundPerPartitionActive: 1,
    });
    const a = deferred();
    const b = deferred();
    const started = [];
    const jobs = [
      scheduler.enqueue({ partition: 'a', priority: PRIORITY_BACKGROUND, deadlineAt: Date.now() + 5000, task: async () => { started.push('a1'); await a.promise; } }),
      scheduler.enqueue({ partition: 'a', priority: PRIORITY_BACKGROUND, deadlineAt: Date.now() + 5000, task: async () => { started.push('a2'); } }),
      scheduler.enqueue({ partition: 'b', priority: PRIORITY_BACKGROUND, deadlineAt: Date.now() + 5000, task: async () => { started.push('b1'); await b.promise; } }),
    ];
    await flush();
    assert.deepEqual(new Set(started), new Set(['a1', 'b1']), 'background scheduler must make cross-partition progress');
    a.resolve();
    b.resolve();
    await Promise.all(jobs);
    assert.ok(started.includes('a2'));
  }

  {
    const scheduler = createTranslationScheduler({ concurrency: 1, interactiveReserve: 1 });
    const blocker = deferred();
    const first = scheduler.enqueue({ partition: 'a', priority: PRIORITY_INTERACTIVE, deadlineAt: Date.now() + 5000, task: () => blocker.promise });
    const expired = scheduler.enqueue({ partition: 'b', priority: PRIORITY_INTERACTIVE, deadlineAt: Date.now() + 30, task: () => Promise.resolve('late') });
    await assert.rejects(expired, error => error.code === 'TRANSLATION_DEADLINE_EXCEEDED' && error.category === 'deadline');
    blocker.resolve();
    await first;
  }

  {
    const scheduler = createTranslationScheduler({ concurrency: 1, interactiveReserve: 1, backgroundPerPartitionQueued: 1 });
    const blocker = deferred();
    const first = scheduler.enqueue({ partition: 'blocker', priority: PRIORITY_INTERACTIVE, deadlineAt: Date.now() + 5000, task: () => blocker.promise });
    const queued = scheduler.enqueue({ partition: 'a', priority: PRIORITY_BACKGROUND, deadlineAt: Date.now() + 5000, task: () => Promise.resolve() });
    const busy = scheduler.enqueue({ partition: 'a', priority: PRIORITY_BACKGROUND, deadlineAt: Date.now() + 5000, task: () => Promise.resolve() });
    await assert.rejects(busy, error => error.code === 'TRANSLATION_BUSY' && error.category === 'busy');

    const deleted = new Error('deleted');
    deleted.code = 'TRANSLATION_ACCOUNT_DELETED';
    assert.equal(scheduler.cancelPartition('a', deleted), 1);
    await assert.rejects(queued, error => error.code === 'TRANSLATION_ACCOUNT_DELETED');
    blocker.resolve();
    await first;
  }

  console.log('TRANSLATION_SCHEDULER_CONTRACT_OK');
})().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
