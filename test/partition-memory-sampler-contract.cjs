'use strict';

const assert = require('node:assert/strict');

const { samplePartitionMemory } = require('../src/partition-memory-sampler.cjs');

const metrics = [
  { pid: 100, type: 'browser', memory: { workingSetSize: 5000, peakWorkingSetSize: 6000, privateBytes: 4000, sharedBytes: 1000 } },
  { pid: 200, type: 'renderer', memory: { workingSetSize: 1200, peakWorkingSetSize: 1500, privateBytes: 900, sharedBytes: 300 } },
  { pid: 201, type: 'renderer', memory: { workingSetSize: 800, peakWorkingSetSize: 1100, privateBytes: 600, sharedBytes: 200 } },
  { pid: 300, type: 'renderer', memory: { workingSetSize: 700, peakWorkingSetSize: 700, privateBytes: 500, sharedBytes: 100 } },
  { pid: 400, type: 'gpu', memory: { workingSetSize: 900, peakWorkingSetSize: 900, privateBytes: 800, sharedBytes: 50 } },
  // Current Electron reports renderer processes as 'Tab', not 'renderer'.
  { pid: 600, type: 'Tab', memory: { workingSetSize: 400, peakWorkingSetSize: 500, privateBytes: 300, sharedBytes: 100 } },
  { pid: 601, type: 'Tab', memory: { workingSetSize: 250, peakWorkingSetSize: 250, privateBytes: 200, sharedBytes: 50 } },
  // Guest pid match wins over the type name, whatever Electron calls it.
  { pid: 602, type: 'Service Worker', memory: { workingSetSize: 150, peakWorkingSetSize: 150, privateBytes: 100, sharedBytes: 0 } },
  // Malformed entries are skipped, never thrown.
  { pid: 'not-a-pid', type: 'renderer', memory: {} },
  null,
  { pid: 500, type: 'renderer' },
];
const guests = [
  { processId: 200, partition: 'persist:account-b' },
  { processId: 201, partition: 'persist:account-a' },
  { processId: 200, partition: 'persist:duplicate-loses' },
  { processId: 600, partition: 'persist:account-c' },
  { processId: 602, partition: 'persist:account-c' },
  { processId: 999, partition: '' },
  { processId: 'bad', partition: 'persist:ignored' },
  null,
];

const sample = samplePartitionMemory({ metrics, guests });

// Partitions sorted by name; first guest wins for a shared pid.
assert.deepEqual(sample.partitions.map(part => part.partition), ['persist:account-a', 'persist:account-b', 'persist:account-c']);
const accountA = sample.partitions[0];
assert.equal(accountA.processCount, 1);
assert.equal(accountA.workingSetSize, 800);
assert.equal(accountA.peakWorkingSetSize, 1100);
assert.equal(accountA.privateBytes, 600);
assert.deepEqual(accountA.processes, [
  { pid: 201, type: 'renderer', memory: { workingSetSize: 800, peakWorkingSetSize: 1100, privateBytes: 600, sharedBytes: 200 } },
]);
const accountB = sample.partitions[1];
assert.equal(accountB.processCount, 1);
assert.equal(accountB.workingSetSize, 1200);

// 'Tab' guests attribute by pid; pid match wins even for unexpected types.
const accountC = sample.partitions[2];
assert.equal(accountC.processCount, 2);
assert.deepEqual(accountC.processes.map(entry => entry.pid), [600, 602]);
assert.equal(accountC.workingSetSize, 550);

// Renderer with no guest -> unattributed (e.g. main window renderer),
// whether Electron calls it 'renderer' or 'Tab'; browser/gpu -> shared.
// Peaks take the max, not the sum.
assert.equal(sample.unattributed.processCount, 3);
assert.deepEqual(sample.unattributed.processes.map(entry => entry.pid), [300, 500, 601]);
assert.equal(sample.unattributed.workingSetSize, 950);
assert.equal(sample.unattributed.peakWorkingSetSize, 700);
assert.equal(sample.shared.processCount, 2);
assert.deepEqual(sample.shared.processes.map(entry => entry.pid), [100, 400]);
assert.equal(sample.shared.workingSetSize, 5900);
assert.equal(sample.shared.peakWorkingSetSize, 6000);

// Totals cover every bucket.
assert.equal(sample.totals.processCount, 1 + 1 + 2 + 3 + 2);
assert.equal(sample.totals.workingSetSize, 800 + 1200 + 550 + 950 + 5900);

// Guests without a partition label still count, under 'unpartitioned'.
const unpartitioned = samplePartitionMemory({
  metrics: [{ pid: 700, type: 'renderer', memory: { workingSetSize: 10 } }],
  guests: [{ processId: 700, partition: '' }],
});
assert.deepEqual(unpartitioned.partitions.map(part => part.partition), ['unpartitioned']);

// Empty and non-array inputs degrade to an empty sample, never a throw.
assert.deepEqual(samplePartitionMemory({}), {
  partitions: [],
  shared: { processCount: 0, workingSetSize: 0, peakWorkingSetSize: 0, privateBytes: 0, processes: [] },
  unattributed: { processCount: 0, workingSetSize: 0, peakWorkingSetSize: 0, privateBytes: 0, processes: [] },
  totals: { processCount: 0, workingSetSize: 0 },
});
assert.deepEqual(samplePartitionMemory({ metrics: 'nope', guests: 42 }).totals, { processCount: 0, workingSetSize: 0 });

// Output is frozen throughout.
assert.equal(Object.isFrozen(sample), true);
assert.equal(Object.isFrozen(sample.partitions), true);
assert.equal(Object.isFrozen(sample.partitions[0].processes), true);

console.log('partition-memory-sampler contract: ok');
