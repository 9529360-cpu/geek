// Read-only K recipient sources; native RecipientImport remains the sole owner.
// tweb 654ffd809aa402f31357db2a13c462b4e5b69a23: resolvePhone and getParticipants.
function createTelegramAudience({ runtime, captureOwner }) {
  // Telegram requires at least three seconds between contacts.resolvePhone calls.
  // This timestamp spans native batches; it is not a queue or retry mechanism.
  let nextPhoneAt = 0;
  const contactId = (value) => {
    const id = typeof value === 'string' && value.startsWith('tg:') ? runtime.peerNumber(value.slice(3)) : null;
    return id !== null && id > 0 ? id : null;
  };
  const clean = (value) => typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 256) : '';
  const unavailable = () => { throw runtime.issue('CAPABILITY_UNAVAILABLE'); };
  function operation(valid) {
    const snapshot = captureOwner();
    const deadline = performance.now() + 30000;
    const check = () => runtime.check(snapshot, valid);
    check();
    const call = (action) => runtime.wait(() => { check(); return action(); }, snapshot, valid, deadline);
    return { snapshot, check, call };
  }
  function groupMembersAvailable() {
    try {
      const manager = captureOwner().managers.appProfileManager;
      return typeof manager?.getParticipants === 'function' && typeof manager?.getChannelFull === 'function';
    }
    catch { return false; }
  }
  async function resolveContacts(payload, valid) {
    const candidates = payload?.candidates;
    if (!payload || Object.keys(payload).some((key) => !['candidates', 'selfIds'].includes(key))
        || !Array.isArray(candidates) || !candidates.length || candidates.length > 2
        || new Set(candidates).size !== candidates.length
        || candidates.some((value) => typeof value !== 'string'
          || !(/^[0-9]{6,15}$/.test(value) || contactId(value) !== null))) unavailable();
    const { snapshot, check, call } = operation(valid);
    if (payload.selfIds !== undefined && (!Array.isArray(payload.selfIds)
        || payload.selfIds.length !== 1 || payload.selfIds[0] !== `tg:${snapshot.self}`)) unavailable();
    const managers = snapshot.managers;
    const rows = [];
    for (const candidate of candidates) {
      check();
      let id = contactId(candidate);
      if (id === null) {
        if (typeof managers.appUsersManager?.resolvePhone !== 'function') unavailable();
        while (performance.now() < nextPhoneAt) {
          await call(() => new Promise((resolve) => setTimeout(resolve, nextPhoneAt - performance.now())));
        }
        const found = await call(async () => {
          nextPhoneAt = performance.now() + 3000;
          try { return await managers.appUsersManager.resolvePhone(candidate); }
          catch (error) {
            // Only the documented no-user response is an unresolved number.
            // Flood limits, network errors and unknown failures abort the import.
            if (error?.type === 'PHONE_NOT_OCCUPIED') return null;
            throw error;
          }
        });
        if (found === null) { rows.push({ candidate, chat: null }); continue; }
        id = runtime.peerNumber(String(found?.id ?? ''));
        if (id === null || id < 1 || found?._ !== 'user') unavailable();
        if (found.phone !== undefined && found.phone !== candidate) {
          rows.push({ candidate, chat: null }); continue;
        }
      }
      check();
      let peer = snapshot.proxy.getPeer(id);
      if (!runtime.ordinary(peer, id, snapshot.self)
          || contactId(candidate) === null && peer.phone !== undefined && peer.phone !== candidate) {
        rows.push({ candidate, chat: null }); continue;
      }
      const input = await call(() => managers.appPeersManager.getInputPeerById(id));
      check();
      peer = snapshot.proxy.getPeer(id);
      if (!runtime.ordinary(peer, id, snapshot.self)
          || input?._ !== 'inputPeerUser' || input.user_id !== id
          || !/^-?\d{1,20}$/.test(String(input.access_hash))
          || contactId(candidate) === null && peer.phone !== undefined && peer.phone !== candidate) {
        rows.push({ candidate, chat: null }); continue;
      }
      const name = clean([peer.first_name, peer.last_name].filter((value) => typeof value === 'string').join(' '));
      rows.push({ candidate, chat: { id: `tg:${id}`, name, realName: name, kind: 'contact' } });
    }
    check();
    return rows;
  }
  async function groupMembers(payload, valid) {
    if (!payload || Object.keys(payload).length !== 1 || typeof payload.groupId !== 'string'
        || !payload.groupId.startsWith('tg:')) unavailable();
    const id = runtime.peerNumber(payload.groupId.slice(3));
    if (id === null || id >= 0) unavailable();
    const { snapshot, check, call } = operation(valid);
    const original = runtime.readPeer(snapshot, id);
    const type = original._;
    const version = original.version;
    if (type === 'chat' && (!Number.isInteger(version) || version < 0)) unavailable();
    const checkGroup = () => {
      check();
      const current = runtime.readPeer(snapshot, id);
      if (current._ !== type || type === 'chat' && current.version !== version) unavailable();
    };
    if (typeof snapshot.managers.appProfileManager?.getParticipants !== 'function') unavailable();
    const seen = new Set(), candidates = [];
    let skipped = 0, count = null, offset = 0;
    if (type === 'channel') {
      // Recent-participant results can be capped. Bind their total to the real
      // group's full count and reject hidden lists before reading any members.
      const full = await call(() => snapshot.managers.appProfileManager.getChannelFull(-id));
      checkGroup();
      if (full?._ !== 'channelFull' || full.id !== -id || full.pFlags?.can_view_participants !== true
          || full.pFlags.participants_hidden || !Number.isInteger(full.participants_count)
          || full.participants_count < 0 || full.participants_count > 10000) unavailable();
      count = full.participants_count;
    }
    for (let page = 0; page < 50; page += 1) {
      checkGroup();
      // forMessagesSearch would synthesize send-as peers; it must stay absent.
      const result = await call(() => snapshot.managers.appProfileManager.getParticipants({
        id: -id, filter: { _: 'channelParticipantsRecent' }, limit: 200, offset,
      }));
      checkGroup();
      const members = result?.participants;
      if (!Array.isArray(members)) unavailable();
      if (type === 'chat') {
        if (result._ !== 'chatParticipants' || result.chat_id !== -id
            || result.version !== version || offset !== 0) unavailable();
        count = members.length;
      } else {
        if (result._ !== 'channels.channelParticipants' || !Number.isInteger(result.count)
            || result.count < 0 || members.length > 200
            || count !== null && count !== result.count) unavailable();
        count = result.count;
      }
      if (count > 10000 || offset + members.length > count
          || !members.length && offset < count) unavailable();
      const allowed = type === 'chat' ? ['chatParticipant', 'chatParticipantAdmin', 'chatParticipantCreator']
        : ['channelParticipant', 'channelParticipantSelf', 'channelParticipantAdmin', 'channelParticipantCreator'];
      for (const member of members) {
        const userId = runtime.peerNumber(String(member?.user_id ?? ''));
        if (!allowed.includes(member?._) || userId === null || userId < 1
            || member.peer !== undefined || seen.has(userId)) unavailable();
        seen.add(userId);
        if (runtime.ordinary(snapshot.proxy.getPeer(userId), userId, snapshot.self)) candidates.push(`tg:${userId}`);
        else skipped += 1;
      }
      offset += members.length;
      if (offset === count) {
        checkGroup();
        return { candidates, selfIds: [`tg:${snapshot.self}`], skipped };
      }
    }
    // Never publish a capped or partial list as a complete group audience.
    unavailable();
  }
  return { resolveContacts, groupMembers, groupMembersAvailable };
}
