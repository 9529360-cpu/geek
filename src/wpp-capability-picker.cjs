'use strict';

function installWppCapabilityPicker(target) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
    throw new TypeError('WPP capability picker target is required');
  }

  const resolvePath = (root, path) => String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((value, key) => value == null ? undefined : value[key], root);

  target.__geekPickWpp = (requirements = []) => {
    const paths = (Array.isArray(requirements) ? requirements : [requirements])
      .map(value => String(value || '').trim())
      .filter(Boolean);
    const candidates = [target.WPP, target.WAPLUS_WPP]
      .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
    if (!paths.length) return candidates[0] || null;
    return candidates.find(candidate => paths.every(path => resolvePath(candidate, path) != null)) || null;
  };
  return true;
}

const WPP_CAPABILITY_PICKER_SOURCE = `(${installWppCapabilityPicker.toString()})(window)`;

module.exports = {
  installWppCapabilityPicker,
  WPP_CAPABILITY_PICKER_SOURCE,
};
