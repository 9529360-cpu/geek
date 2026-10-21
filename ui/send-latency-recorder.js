(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekSendLatencyRecorder = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Bucket edges are measurement bins only, not performance targets.
  // No target is asserted anywhere in this module: targets can only be set
  // after the first real measurement run (see Issue #787).
  const BUCKET_EDGES_MS = Object.freeze([100, 500, 1000, 2000, 4000, 8000]);
  const OUTCOMES = Object.freeze(new Set(['sent', 'failed', 'cancelled']));

  // Timing records deliberately carry no message content, no chat id, no
  // account id and no partition: only platform, send path, outcome and
  // duration. A record is one transport attempt (broadcast retries record
  // each attempt separately).
  function createSendLatencyRecorder(options = {}) {
    const now = typeof options.now === 'function' ? options.now : () => Date.now();
    const maxRecords = options.maxRecords == null ? 256 : Number(options.maxRecords);
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
      throw new TypeError('send latency maxRecords is invalid');
    }
    const entries = [];

    // Measurement must never break a send: invalid input is dropped and
    // reported as false, never thrown.
    function record(input = {}) {
      try {
        const platform = String(input.platform || '').trim();
        const path = String(input.path || '').trim();
        const outcome = String(input.outcome || '').trim();
        const durationMs = Number(input.durationMs);
        if (!platform || !path || !OUTCOMES.has(outcome)) return false;
        if (!Number.isFinite(durationMs) || durationMs < 0) return false;
        if (entries.length >= maxRecords) entries.shift();
        entries.push(Object.freeze({
          platform,
          path,
          outcome,
          durationMs,
          at: now(),
        }));
        return true;
      } catch {
        return false;
      }
    }

    function bucketLabel(durationMs) {
      for (const edge of BUCKET_EDGES_MS) {
        if (durationMs <= edge) return '<=' + edge + 'ms';
      }
      return '>' + BUCKET_EDGES_MS[BUCKET_EDGES_MS.length - 1] + 'ms';
    }

    function summary() {
      const out = {};
      for (const entry of entries) {
        const key = entry.platform + '|' + entry.path + '|' + entry.outcome;
        let group = out[key];
        if (!group) {
          const buckets = {};
          for (const edge of BUCKET_EDGES_MS) buckets['<=' + edge + 'ms'] = 0;
          buckets['>' + BUCKET_EDGES_MS[BUCKET_EDGES_MS.length - 1] + 'ms'] = 0;
          group = {
            platform: entry.platform,
            path: entry.path,
            outcome: entry.outcome,
            count: 0,
            minMs: Infinity,
            maxMs: -Infinity,
            totalMs: 0,
            buckets,
          };
          out[key] = group;
        }
        group.count += 1;
        group.minMs = Math.min(group.minMs, entry.durationMs);
        group.maxMs = Math.max(group.maxMs, entry.durationMs);
        group.totalMs += entry.durationMs;
        group.buckets[bucketLabel(entry.durationMs)] += 1;
      }
      for (const group of Object.values(out)) {
        group.meanMs = group.count ? group.totalMs / group.count : 0;
        Object.freeze(group.buckets);
        Object.freeze(group);
      }
      return Object.freeze(out);
    }

    return Object.freeze({
      record,
      records: () => Object.freeze(entries.slice()),
      summary,
      size: () => entries.length,
    });
  }

  return Object.freeze({
    BUCKET_EDGES_MS,
    OUTCOMES: Object.freeze(Array.from(OUTCOMES)),
    createSendLatencyRecorder,
  });
});
