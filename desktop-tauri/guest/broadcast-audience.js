// Read-only WhatsApp audience discovery. Rust retains the account lease, absolute
// deadline, canonical recipient validation and the sole broadcast job owner.
function createBroadcastAudienceResolver({ runtime, identity, supported, requireMethods }) {
  const issue = (code) => Object.assign(new Error(code), { code });
  const userId = (id) => /^[0-9]{1,30}@(c\.us|lid)$/.test(id);
  const groupId = (id) => /^[0-9]{1,30}(?:-[0-9]{1,20})?@g\.us$/.test(id);
  const labelId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
  const namespace = (id) => id.split('@')[1];

  function rawSelf(W) {
    requireMethods(W, ['whatsapp.UserPrefs.getMaybeMePnUser', 'whatsapp.UserPrefs.getMaybeMeLidUser']);
    const prefs = W.whatsapp.UserPrefs;
    const pn = identity(prefs.getMaybeMePnUser()), lid = identity(prefs.getMaybeMeLidUser());
    if ((pn && (!userId(pn) || !pn.endsWith('@c.us'))) || (lid && (!userId(lid) || !lid.endsWith('@lid')))
      || (!pn && !lid)) throw issue('CAPABILITY_UNAVAILABLE');
    return [pn, lid].filter(Boolean).sort();
  }

  function selfGuard(W, expected) {
    if (!Array.isArray(expected) || !expected.length || expected.length > 2
        || expected.some((id) => typeof id !== 'string' || !userId(id))
        || new Set(expected.map(namespace)).size !== expected.length) throw issue('CAPABILITY_UNAVAILABLE');
    const ids = [...expected].sort();
    const check = () => {
      if (runtime() !== W || rawSelf(W).some((id) => !ids.includes(id))) throw issue('GUEST_CHANGED');
    };
    check();
    return { ids, check, isSelf(id) {
      if (!userId(id) || !ids.some((known) => namespace(known) === namespace(id))) throw issue('CAPABILITY_UNAVAILABLE');
      return ids.includes(id);
    } };
  }

  function operation(valid, useSelf = false) {
    const W = runtime();
    let guard = useSelf ? selfGuard(W, rawSelf(W)) : null;
    const check = () => {
      if (!valid() || runtime() !== W) throw issue('GUEST_CHANGED');
      guard?.check();
    };
    const wait = async (action) => {
      check();
      let timer;
      try {
        const value = await Promise.race([Promise.resolve().then(() => { check(); return action(); }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(issue('TIMED_OUT')), 5000); })]);
        check();
        return value;
      } finally { clearTimeout(timer); }
    };
    return { W, check, wait, get guard() { return guard; }, async proveSelfAliases() {
      if (guard.ids.length === 2 || typeof W.contact?.getPnLidEntry !== 'function') return;
      const pair = await wait(() => W.contact.getPnLidEntry(guard.ids[0]));
      const pn = identity(pair?.phoneNumber), lid = identity(pair?.lid);
      if (!pn || !lid) return;
      if (!userId(pn) || !pn.endsWith('@c.us') || !userId(lid) || !lid.endsWith('@lid')
          || !guard.ids.every((known) => [pn, lid].includes(known))) throw issue('CAPABILITY_UNAVAILABLE');
      guard = selfGuard(W, [pn, lid]);
    } };
  }

  async function audienceOptions(valid) {
    try {
      const op = operation(valid);
      requireMethods(op.W, ['labels.getAllLabels', 'labels.getLabelById']);
      const labels = await op.wait(() => op.W.labels.getAllLabels());
      if (!Array.isArray(labels) || labels.length > 256) throw issue('CAPABILITY_UNAVAILABLE');
      const seen = new Set();
      return labels.map((label) => {
        if (!labelId(label?.id) || seen.has(label.id) || typeof label.name !== 'string') throw issue('CAPABILITY_UNAVAILABLE');
        seen.add(label.id);
        return { id: label.id, name: label.name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 256) };
      });
    } catch (error) {
      // Label discovery is optional; its absence must not disable the chat directory.
      if (error.code === 'GUEST_CHANGED') throw error;
      return null;
    }
  }

  async function groupMembers(payload, valid) {
    const id = payload?.groupId;
    if (typeof id !== 'string' || !groupId(id)) throw issue('CAPABILITY_UNAVAILABLE');
    const op = operation(valid, true), W = op.W;
    requireMethods(W, ['conn.isMainReady', 'chat.get', 'group.getParticipants']);
    if (await op.wait(() => W.conn.isMainReady()) !== true) throw issue('ACCOUNT_UNAVAILABLE');
    const group = () => {
      const model = W.chat.get(id);
      if (!supported(model, id) || identity(model?.id) !== id) throw issue('CAPABILITY_UNAVAILABLE');
    };
    group();
    await op.proveSelfAliases();
    const members = await op.wait(() => W.group.getParticipants(id));
    group();
    if (!Array.isArray(members) || members.length > 10000) throw issue('CAPABILITY_UNAVAILABLE');
    const candidates = [];
    let skipped = 0;
    for (const member of members) {
      const candidate = identity(member?.id);
      if (op.guard.isSelf(candidate)) skipped += 1;
      else candidates.push(candidate);
    }
    op.check();
    return { candidates, selfIds: op.guard.ids, skipped };
  }

  async function labelMembers(payload, valid) {
    const id = payload?.labelId, ids = payload?.chatIds;
    if (!labelId(id) || !Array.isArray(ids) || !ids.length || ids.length > 200
        || new Set(ids).size !== ids.length || ids.some((chatId) => typeof chatId !== 'string'
          || (!userId(chatId) && !groupId(chatId)))) throw issue('CAPABILITY_UNAVAILABLE');
    const op = operation(valid), W = op.W;
    requireMethods(W, ['conn.isMainReady', 'chat.get', 'labels.getLabelById']);
    if (await op.wait(() => W.conn.isMainReady()) !== true) throw issue('ACCOUNT_UNAVAILABLE');
    const label = await op.wait(() => W.labels.getLabelById(id));
    if (label?.id !== id) throw issue('CAPABILITY_UNAVAILABLE');
    const selected = [];
    for (const chatId of ids) {
      const model = W.chat.get(chatId);
      if (!supported(model, chatId) || identity(model?.id) !== chatId) throw issue('CAPABILITY_UNAVAILABLE');
      // Do not use chat.list({withLabels}): its name-first lookup can remap an ID.
      const labels = model.labels;
      if (labels !== undefined && (!Array.isArray(labels) || labels.length > 256
          || labels.some((value) => !labelId(value)))) throw issue('CAPABILITY_UNAVAILABLE');
      if (labels?.includes(id)) selected.push(chatId);
    }
    op.check();
    return { labelId: id, chatIds: selected };
  }

  return { audienceOptions, groupMembers, labelMembers, selfGuard };
}
