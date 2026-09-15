'use strict';

const assert = require('node:assert/strict');
const {
  TRANSLATION_INTENTS,
  createTranslationSmartQueue,
  normalizeTranslationIntent,
} = require('../src/translation-smart-queue.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function tick() {
  await new Promise(resolve => setImmediate(resolve));
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${label}`);
}

(async () => {
  assert.equal(normalizeTranslationIntent('outgoing-send'), 'outgoing-send');
  assert.equal(normalizeTranslationIntent('message-display'), 'message-display');
  assert.equal(normalizeTranslationIntent('unknown'), 'message-display', 'unknown intents must never promote to interactive priority');
  assert.equal(normalizeTranslationIntent(undefined), 'message-display', 'missing intent must fail toward background priority');

  // Reserve capacity for outgoing work even when background translation is saturated.
  {
    const gates = Array.from({ length: 8 }, () => deferred());
    const started = [];
    const queue = createTranslationSmartQueue({ concurrency: 4, outgoingReserve: 1, outgoingBurst: 3 });
    const background = Array.from({ length: 8 }, (_, index) => queue.enqueue({
      partition: 'account-a',
      intent: TRANSLATION_INTENTS.MESSAGE_DISPLAY,
      deadlineAt: Date.now() + 5000,
      task: async () => { started.push(`b${index}`); await gates[index].promise; return index; },
    }));
    await waitFor(() => started.length === 3, 'background reserve saturation');
    assert.deepEqual(started, ['b0', 'b1', 'b2'], 'background may not consume the reserved interactive slot');

    const outgoingGate = deferred();
    const outgoing = queue.enqueue({
      partition: 'account-b',
      intent: TRANSLATION_INTENTS.OUTGOING_SEND,
      deadlineAt: Date.now() + 5000,
      task: async () => { started.push('send'); await outgoingGate.promise; return 'send'; },
    });
    await waitFor(() => started.includes('send'), 'outgoing request to use reserved slot');
    assert.equal(started.indexOf('send'), 3, 'outgoing send must start immediately without waiting behind the background backlog');

    outgoingGate.resolve();
    gates.forEach(gate => gate.resolve());
    await Promise.all([...background, outgoing]);
  }

  // Round-robin partitions: a noisy tenant cannot monopolize every newly freed slot.
  {
    const gate = deferred();
    const started = [];
    const queue = createTranslationSmartQueue({ concurrency: 1, outgoingReserve: 0, outgoingBurst: 2 });
    const first = queue.enqueue({
      partition: 'account-a', intent: 'outgoing-send', deadlineAt: Date.now() + 5000,
      task: async () => { started.push('a1'); await gate.promise; },
    });
    const a2 = queue.enqueue({
      partition: 'account-a', intent: 'outgoing-send', deadlineAt: Date.now() + 5000,
      task: async () => { started.push('a2'); },
    });
    const a3 = queue.enqueue({
      partition: 'account-a', intent: 'outgoing-send', deadlineAt: Date.now() + 5000,
      task: async () => { started.push('a3'); },
    });
    const b1 = queue.enqueue({
      partition: 'account-b', intent: 'outgoing-send', deadlineAt: Date.now() + 5000,
      task: async () => { started.push('b1'); },
    });
    await waitFor(() => started.length === 1, 'first account-a task');
    gate.resolve();
    await Promise.all([first, a2, a3, b1]);
    assert.deepEqual(started, ['a1', 'a2', 'b1', 'a3'], 'same-class work must rotate accounts while preserving per-account FIFO');
  }

  // Weighted classes: outgoing is preferred, but background still makes progress.
  {
    const gate = deferred();
    const started = [];
    const queue = createTranslationSmartQueue({ concurrency: 1, outgoingReserve: 0, outgoingBurst: 2 });
    const blocker = queue.enqueue({
      partition: 'blocker', intent: 'outgoing-send', deadlineAt: Date.now() + 5000,
      task: async () => { started.push('block'); await gate.promise; },
    });
    await waitFor(() => started.length === 1, 'weighted blocker');
    const work = [];
    for (let index = 1; index <= 4; index += 1) {
      work.push(queue.enqueue({
        partition: `send-${index}`, intent: 'outgoing-send', deadlineAt: Date.now() + 5000,
        task: async () => { started.push(`s${index}`); },
      }));
    }
    for (let index = 1; index <= 2; index += 1) {
      work.push(queue.enqueue({
        partition: `background-${index}`, intent: 'message-display', deadlineAt: Date.now() + 5000,
        task: async () => { started.push(`b${index}`); },
      }));
    }
    gate.resolve();
    await blocker;
    await Promise.all(work);
    const afterBlock = started.slice(1);
    assert.deepEqual(afterBlock.slice(0, 3), ['s1', 's2', 'b1'], 'outgoing burst must yield to background after the configured burst');
    assert.ok(afterBlock.indexOf('b2') < afterBlock.length - 1 || afterBlock.at(-1) === 'b2', 'background work must not starve');
  }

  // Background overflow uses a bounded LEAK policy: stale queued display work is dropped.
  {
    const gate = deferred();
    const started = [];
    const queue = createTranslationSmartQueue({
      concurrency: 2,
      outgoingReserve: 1,
      totalQueueLimit: 4,
      partitionQueueLimit: 3,
      backgroundPartitionLimit: 2,
    });
    const active = queue.enqueue({
      partition: 'account-a', intent: 'message-display', deadlineAt: Date.now() + 5000,
      task: async () => { started.push('active'); await gate.promise; },
    });
    await waitFor(() => started.length === 1, 'background active task');
    const stale = queue.enqueue({
      partition: 'account-a', intent: 'message-display', deadlineAt: Date.now() + 5000,
      task: async () => { started.push('stale'); },
    });
    const newer = queue.enqueue({
      partition: 'account-a', intent: 'message-display', deadlineAt: Date.now() + 5000,
      task: async () => { started.push('newer'); },
    });
    const newest = queue.enqueue({
      partition: 'account-a', intent: 'message-display', deadlineAt: Date.now() + 5000,
      task: async () => { started.push('newest'); },
    });
    await assert.rejects(stale, error => error?.code === 'TRANSLATION_BACKGROUND_DROPPED' && error?.category === 'capacity');
    assert.equal(queue.snapshot().queuedBackground, 2, 'background queue must remain bounded after leaking the stale item');
    assert.equal(queue.snapshot().droppedBackground, 1, 'overflow must be observable without exposing account/message identifiers');
    gate.resolve();
    await Promise.all([active, newer, newest]);
    assert.equal(started.includes('stale'), false, 'dropped background work must never reach the task boundary');
  }

  // Queue wait consumes the original deadline.
  {
    const gate = deferred();
    const started = [];
    const queue = createTranslationSmartQueue({ concurrency: 1, outgoingReserve: 0 });
    const active = queue.enqueue({
      partition: 'account-a', intent: 'outgoing-send', deadlineAt: Date.now() + 2000,
      task: async () => { started.push('active'); await gate.promise; },
    });
    await waitFor(() => started.length === 1, 'deadline blocker');
    const expiring = queue.enqueue({
      partition: 'account-b', intent: 'outgoing-send', deadlineAt: Date.now() + 40,
      task: async () => { started.push('expired'); },
    });
    await assert.rejects(expiring, error => error?.code === 'TRANSLATION_DEADLINE_EXCEEDED');
    gate.resolve();
    await active;
    await tick();
    assert.equal(started.includes('expired'), false, 'expired queued work must never start later');
  }

  console.log('TRANSLATION_SMART_QUEUE_CONTRACT_OK');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
