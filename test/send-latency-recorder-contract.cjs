'use strict';

const assert = require('node:assert/strict');

const api = require('../ui/send-latency-recorder.js');

const recorder = api.createSendLatencyRecorder({ now: () => 9000, maxRecords: 3 });

// Invalid input is dropped, never thrown (measurement must never break a send).
assert.equal(recorder.record({}), false);
assert.equal(recorder.record({ platform: '', path: 'sendDirect', outcome: 'sent', durationMs: 10 }), false);
assert.equal(recorder.record({ platform: 'whatsapp', path: '', outcome: 'sent', durationMs: 10 }), false);
assert.equal(recorder.record({ platform: 'whatsapp', path: 'sendDirect', outcome: 'maybe', durationMs: 10 }), false);
assert.equal(recorder.record({ platform: 'whatsapp', path: 'sendDirect', outcome: 'sent', durationMs: -1 }), false);
assert.equal(recorder.record({ platform: 'whatsapp', path: 'sendDirect', outcome: 'sent', durationMs: NaN }), false);
assert.equal(recorder.record({ platform: 'whatsapp', path: 'sendDirect', outcome: 'sent', durationMs: Infinity }), false);
assert.equal(recorder.size(), 0);

// Capacity: oldest record is dropped, order preserved.
assert.equal(recorder.record({ platform: 'whatsapp', path: 'sendDirect', outcome: 'sent', durationMs: 50 }), true);
assert.equal(recorder.record({ platform: 'whatsapp', path: 'sendDirect', outcome: 'sent', durationMs: 600 }), true);
assert.equal(recorder.record({ platform: 'whatsapp', path: 'broadcast-file', outcome: 'failed', durationMs: 9000 }), true);
assert.equal(recorder.record({ platform: 'telegram', path: 'composer-submit', outcome: 'sent', durationMs: 250 }), true);
assert.equal(recorder.size(), 3);
assert.deepEqual(recorder.records().map(entry => entry.durationMs), [600, 9000, 250]);
// Records carry no message content, chat id, account id or partition.
assert.deepEqual(Object.keys(recorder.records()[0]).sort(), ['at', 'durationMs', 'outcome', 'path', 'platform']);
assert.equal(Object.isFrozen(recorder.records()[0]), true);

// Summary aggregates per platform|path|outcome with fixed bins (bins, not targets).
const summary = recorder.summary();
assert.equal(summary['whatsapp|sendDirect|sent'].count, 1);
assert.equal(summary['whatsapp|sendDirect|sent'].minMs, 600);
assert.equal(summary['whatsapp|sendDirect|sent'].maxMs, 600);
assert.equal(summary['whatsapp|sendDirect|sent'].totalMs, 600);
assert.equal(summary['whatsapp|sendDirect|sent'].meanMs, 600);
assert.equal(summary['whatsapp|sendDirect|sent'].buckets['<=1000ms'], 1);
assert.equal(summary['whatsapp|sendDirect|sent'].buckets['<=100ms'], 0);
assert.equal(summary['whatsapp|broadcast-file|failed'].buckets['>8000ms'], 1);
assert.equal(summary['telegram|composer-submit|sent'].buckets['<=500ms'], 1);
assert.equal(Object.isFrozen(summary), true);
assert.equal(Object.isFrozen(summary['whatsapp|sendDirect|sent'].buckets), true);

// Mean over several records in one group.
const multi = api.createSendLatencyRecorder({ maxRecords: 16 });
multi.record({ platform: 'line', path: 'composer-submit', outcome: 'sent', durationMs: 100 });
multi.record({ platform: 'line', path: 'composer-submit', outcome: 'sent', durationMs: 300 });
const group = multi.summary()['line|composer-submit|sent'];
assert.equal(group.count, 2);
assert.equal(group.minMs, 100);
assert.equal(group.maxMs, 300);
assert.equal(group.totalMs, 400);
assert.equal(group.meanMs, 200);
assert.equal(group.buckets['<=100ms'], 1);
assert.equal(group.buckets['<=500ms'], 1);

// Invalid maxRecords fails fast at construction.
assert.throws(() => api.createSendLatencyRecorder({ maxRecords: 0 }), /maxRecords/);

console.log('send-latency-recorder contract: ok');
