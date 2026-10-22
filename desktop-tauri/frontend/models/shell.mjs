export function familyOf(id, platforms) {
  return platforms.find((platform) => platform.id === id)?.family || id;
}

export function visibleAccounts(snapshot, family) {
  return snapshot.accounts.filter((account) => !account.archived
    && familyOf(account.platformId, snapshot.platforms) === family);
}

export function families(snapshot) {
  const found = new Map();
  for (const platform of snapshot.platforms) {
    const key = platform.family || platform.id;
    if (!found.has(key) && snapshot.accounts.some((account) => !account.archived
        && familyOf(account.platformId, snapshot.platforms) === key)) {
      found.set(key, { key, name: platform.familyLabel || platform.name, icon: platform.id });
    }
  }
  return [...found.values()];
}

export function viewportOf(element, visible) {
  const rect = element.getBoundingClientRect();
  const bounds = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: Boolean(visible) };
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
      || bounds.x < 0 || bounds.y < 0 || bounds.width < 1 || bounds.height < 1) {
    throw 'LAYOUT_INVALID';
  }
  return bounds;
}
