// Read-only identity resolution for a bounded native-selected recipient batch.
// No opening/activating chats, composer access, send or account-wide enumeration.
function createBroadcastContactResolver({ runtime, identity, supported, requireMethods, selfGuard }) {
  const userId = (value) => /^[0-9]{1,30}@(c\.us|lid)$/.test(value);
  const issue = (code) => Object.assign(new Error(code), { code });
  return async function resolveContacts(payload, valid) {
    const candidates = payload?.candidates;
    if (!Array.isArray(candidates) || !candidates.length || candidates.length > 2
        || new Set(candidates).size !== candidates.length
        || candidates.some((v) => typeof v !== 'string'
          || !(/^[0-9]{6,15}$/.test(v) || userId(v)))) throw issue('CAPABILITY_UNAVAILABLE');
    const W = runtime();
    requireMethods(W, ['conn.isMainReady', 'contact.queryExists', 'chat.find', 'chat.get']);
    const own = payload.selfIds === undefined ? null : selfGuard(W, payload.selfIds);
    const check = () => {
      if (!valid() || runtime() !== W) throw issue('GUEST_CHANGED');
      own?.check();
    };
    const wait = async (action) => {
      check();
      let timer;
      try {
        const result = await Promise.race([Promise.resolve().then(() => { check(); return action(); }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(issue('TIMED_OUT')), 5000); })]);
        check();
        return result;
      } finally { clearTimeout(timer); }
    };
    if (await wait(() => W.conn.isMainReady()) !== true) throw issue('ACCOUNT_UNAVAILABLE');
    const rows = [];
    for (const candidate of candidates) {
      const requested = candidate.includes('@') ? candidate : `${candidate}@c.us`;
      if (own?.isSelf(requested)) { rows.push({ candidate, chat: null }); continue; }
      const found = await wait(() => W.contact.queryExists(requested));
      const aliases = new Set([identity(found?.wid), identity(found?.lid)].filter(userId));
      if (!aliases.has(requested)) { rows.push({ candidate, chat: null }); continue; }
      // Prefer the proved LID when present so a PN and its LID resolve to the
      // same ChatStore model and are deduplicated by Rust before job creation.
      const destination = identity(found?.lid) || identity(found?.wid);
      if (!userId(destination)) { rows.push({ candidate, chat: null }); continue; }
      let model;
      try { model = await wait(() => W.chat.find(destination)); }
      catch (error) {
        if (error.code === 'TIMED_OUT' || error.code === 'GUEST_CHANGED') throw error;
        rows.push({ candidate, chat: null }); continue;
      }
      const id = identity(model?.id);
      if (userId(id) && !aliases.has(id) && typeof W.contact.getPnLidEntry === 'function') {
        const pair = await wait(() => W.contact.getPnLidEntry(destination));
        const pn = identity(pair?.phoneNumber), lid = identity(pair?.lid);
        if (userId(pn) && pn.endsWith('@c.us') && userId(lid) && lid.endsWith('@lid')
            && (aliases.has(pn) || aliases.has(lid))) { aliases.add(pn); aliases.add(lid); }
      }
      const loaded = W.chat.get(id);
      if (!userId(id) || !aliases.has(id) || !supported(model, id)
          || !supported(loaded, id) || identity(loaded?.id) !== id) {
        rows.push({ candidate, chat: null }); continue;
      }
      if (own?.isSelf(id)) { rows.push({ candidate, chat: null }); continue; }
      const name = (value) => typeof value === 'string' && !aliases.has(value)
        && !/^[+\d\s()-]+$/.test(value) ? value.slice(0, 256) : '';
      rows.push({ candidate, chat: { id, kind: 'contact',
        name: name(loaded.name) || name(loaded.formattedTitle) || name(loaded.contact?.name),
        realName: name(loaded.contact?.pushname) || name(loaded.contact?.name) || name(loaded.contact?.shortName),
      } });
    }
    check();
    return rows;
  };
}
