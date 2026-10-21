'use strict';

// Per-partition memory sampler (Issue #787, item 2).
//
// Pure function over Electron-reported data; it imports no Electron module
// so contract tests run without Electron. The main process feeds it
// app.getAppMetrics() entries plus WebContents-derived guest entries (see
// collectPartitionMemorySample in src/main.cjs) and exposes the result on
// demand via the 'diagnostics:partition-memory-sample' IPC channel, so a
// baseline can be taken at 1/3/5 accounts from devtools or an E2E shell
// without any periodic background sampling.
//
// Memory values are passed through exactly as Electron reports them; this
// module performs no unit conversion and invents no numbers. Aggregates:
// workingSetSize and privateBytes are summed, peakWorkingSetSize takes the
// max (peaks do not sum meaningfully). Entries with malformed shapes are
// skipped, never thrown: sampling is diagnostics and must never break the
// app. Nothing here identifies a user or a chat: partitions are Electron
// session partition labels, which is precisely the grouping #787 asks for.

// Renderer processes are reported under different type names across
// Electron versions: older releases report 'renderer', current releases
// report 'Tab' (observed live in CI: Browser/GPU/Utility/Tab). Attribution
// therefore keys on the guest pid match first and only falls back to the
// type name for guest-less processes; type strings are passed through
// exactly as Electron reports them.
const RENDERER_TYPES = Object.freeze(new Set(['renderer', 'tab']));

const MEMORY_FIELDS = Object.freeze([
  'workingSetSize',
  'peakWorkingSetSize',
  'privateBytes',
  'sharedBytes',
]);

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cleanMemory(memory) {
  const out = {};
  if (memory && typeof memory === 'object') {
    for (const field of MEMORY_FIELDS) {
      if (Number.isFinite(Number(memory[field]))) out[field] = Number(memory[field]);
    }
  }
  return Object.freeze(out);
}

function emptyBucket() {
  return {
    processCount: 0,
    workingSetSize: 0,
    peakWorkingSetSize: 0,
    privateBytes: 0,
    processes: [],
  };
}

function addProcess(bucket, entry) {
  bucket.processCount += 1;
  bucket.workingSetSize += finiteNumber(entry.memory.workingSetSize);
  bucket.peakWorkingSetSize = Math.max(bucket.peakWorkingSetSize, finiteNumber(entry.memory.peakWorkingSetSize));
  bucket.privateBytes += finiteNumber(entry.memory.privateBytes);
  bucket.processes.push(entry);
}

function freezeBucket(bucket) {
  bucket.processes.sort((a, b) => a.pid - b.pid);
  return Object.freeze({
    processCount: bucket.processCount,
    workingSetSize: bucket.workingSetSize,
    peakWorkingSetSize: bucket.peakWorkingSetSize,
    privateBytes: bucket.privateBytes,
    processes: Object.freeze(bucket.processes),
  });
}

function samplePartitionMemory(input = {}) {
  const metrics = Array.isArray(input.metrics) ? input.metrics : [];
  const guests = Array.isArray(input.guests) ? input.guests : [];

  // First guest wins for a process id; guests without a partition label
  // still count, under 'unpartitioned', rather than vanishing.
  const guestPartitionByPid = new Map();
  for (const guest of guests) {
    if (!guest || typeof guest !== 'object') continue;
    const pid = Number(guest.processId);
    if (!Number.isFinite(pid) || guestPartitionByPid.has(pid)) continue;
    const partition = String(guest.partition || '').trim();
    guestPartitionByPid.set(pid, partition || 'unpartitioned');
  }

  const partitionsByName = new Map();
  const shared = emptyBucket();
  const unattributed = emptyBucket();

  for (const metric of metrics) {
    if (!metric || typeof metric !== 'object') continue;
    const pid = Number(metric.pid);
    if (!Number.isFinite(pid)) continue;
    const entry = Object.freeze({
      pid,
      type: String(metric.type || ''),
      memory: cleanMemory(metric.memory),
    });
    // Guest pid match wins over the type name: a guest renderer is its
    // partition's process whatever Electron calls the type this release.
    if (guestPartitionByPid.has(pid)) {
      const name = guestPartitionByPid.get(pid);
      if (!partitionsByName.has(name)) partitionsByName.set(name, emptyBucket());
      addProcess(partitionsByName.get(name), entry);
    } else if (RENDERER_TYPES.has(entry.type.toLowerCase())) {
      addProcess(unattributed, entry);
    } else {
      addProcess(shared, entry);
    }
  }

  const partitions = [...partitionsByName.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([partition, bucket]) => Object.freeze({
      partition,
      ...freezeBucket(bucket),
    }));

  let totalProcesses = 0;
  let totalWorkingSetSize = 0;
  for (const bucket of [...partitions, shared, unattributed]) {
    totalProcesses += bucket.processCount;
    totalWorkingSetSize += bucket.workingSetSize;
  }

  return Object.freeze({
    partitions: Object.freeze(partitions),
    shared: freezeBucket(shared),
    unattributed: freezeBucket(unattributed),
    totals: Object.freeze({
      processCount: totalProcesses,
      workingSetSize: totalWorkingSetSize,
    }),
  });
}

module.exports = { samplePartitionMemory, MEMORY_FIELDS };
