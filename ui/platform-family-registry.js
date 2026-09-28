(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GeekPlatformFamilyRegistry = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function normalizeEntry(entry) {
    const type = String(entry?.type || '').trim();
    if (!type) throw new TypeError('platform type is required');
    const family = String(entry?.family || type).trim() || type;
    return Object.freeze({
      type,
      family,
      name: String(entry?.name || type).trim() || type,
      familyLabel: String(entry?.familyLabel || '').trim(),
      short: String(entry?.short || '').trim(),
      needsExtension: entry?.needsExtension === true,
      isWebsite: entry?.isWebsite === true,
    });
  }

  function familyLabel(entry) {
    if (!entry) return '';
    if (entry.familyLabel) return entry.familyLabel;
    if (entry.type === entry.family) return entry.name;
    return entry.family ? entry.family.charAt(0).toUpperCase() + entry.family.slice(1) : entry.name;
  }

  function create() {
    let entries = Object.freeze([]);

    function replace(nextEntries) {
      if (!Array.isArray(nextEntries)) throw new TypeError('platform catalog entries must be an array');
      const seenTypes = new Set();
      const normalized = nextEntries.map(item => {
        const entry = normalizeEntry(item);
        if (seenTypes.has(entry.type)) throw new Error('platform type already registered: ' + entry.type);
        seenTypes.add(entry.type);
        return entry;
      });
      entries = Object.freeze(normalized);
      return entries;
    }

    function families() {
      const grouped = new Map();
      for (const entry of entries) {
        let family = grouped.get(entry.family);
        if (!family) {
          family = {
            key: entry.family,
            label: familyLabel(entry),
            iconType: entry.type,
            types: [],
          };
          grouped.set(entry.family, family);
        }
        family.types.push(entry.type);
      }
      return Object.freeze(Array.from(grouped.values(), family => Object.freeze({
        ...family,
        types: Object.freeze([...family.types]),
      })));
    }

    function familyOf(type) {
      const key = String(type || '').trim();
      const entry = entries.find(item => item.type === key);
      if (entry) {
        const family = families().find(item => item.key === entry.family);
        if (family) return family;
      }
      return Object.freeze({
        key: key || 'website',
        label: key || 'Website',
        iconType: key || 'website',
        types: Object.freeze(key ? [key] : []),
      });
    }

    function platform(type) {
      const key = String(type || '').trim();
      return entries.find(item => item.type === key) || null;
    }

    return Object.freeze({
      replace,
      families,
      familyOf,
      platform,
      entries: () => entries,
    });
  }

  return Object.freeze({ create });
});
