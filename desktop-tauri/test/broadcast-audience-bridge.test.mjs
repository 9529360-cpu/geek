import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { fixture, ids, wid, chat, deferred } = require('./platform-bridge-fixture.cjs');

const mePn = '999000@c.us', meLid = '999001@lid';
function setup() {
  const f = fixture();
  f.self = { pn: mePn, lid: meLid };
  f.WPP.whatsapp.UserPrefs = { getMaybeMePnUser: () => wid(f.self.pn), getMaybeMeLidUser: () => wid(f.self.lid) };
  f.WPP.contact.queryExists = async (id) => ({ wid: wid(id) });
  f.WPP.chat.find = async (id) => {
    if (!f.models.has(id)) f.models.set(id, chat(id));
    return f.models.get(id);
  };
  f.labels = [{ id: '1', name: 'Clients' }, { id: '2', name: '1' }];
  f.WPP.labels = { getAllLabels: async () => f.labels,
    getLabelById: async (id) => f.labels.find((label) => label.id === id) };
  return f;
}
async function result(f, operation, payload) {
  const call = f.start(operation, payload);
  assert.equal(call.accepted, true);
  await f.flush();
  const entry = f.read(call.id);
  assert.equal(entry.pending, false);
  return entry;
}

test('catalog discovers bounded platform label metadata and group-member capability without sending', async () => {
  const f = setup(), active = String(f.WPP.chat.getActiveChat().id);
  f.labels[0].name = 'Clie\nnts';
  const catalog = await result(f, 'catalog');
  assert.equal(catalog.error, undefined);
  assert.equal(catalog.value.capabilities.groupMembers, true);
  assert.deepEqual(catalog.value.labels, [{ id: '1', name: 'Clients' }, { id: '2', name: '1' }]);
  assert.equal(String(f.WPP.chat.getActiveChat().id), active);
  assert.deepEqual(f.sends, []);
});

test('missing, malformed or timed-out optional labels do not disable the original directory', async () => {
  for (const labels of [null, [{ id: '1', name: 'One' }, { id: '1', name: 'Duplicate' }],
    [{ id: 'bad/id', name: 'Invalid' }], [{ id: '1', name: 1 }], Array(257).fill({ id: '1', name: 'Too many' })]) {
    const f = setup(); f.labels = labels;
    const entry = await result(f, 'catalog');
    assert.equal(entry.error, undefined); assert.equal(entry.value.labels, null);
    assert.equal(entry.value.chats.length, 3);
  }
  const empty = setup(); empty.labels = [];
  assert.deepEqual((await result(empty, 'catalog')).value.labels, []);
  const f = setup(), pending = deferred(); f.WPP.labels.getAllLabels = () => pending.promise;
  const call = f.start('catalog'); await f.advance(5001);
  assert.equal(f.read(call.id).value.labels, null);
  pending.resolve([{ id: 'late', name: 'Late' }]); await f.flush();
  assert.equal(f.read(call.id).value.labels, null);
});

test('group discovery keeps duplicate candidates for native accounting and excludes both own identities', async () => {
  const f = setup();
  f.behavior.participants = () => [mePn, ids.contact, meLid, ids.lid, ids.contact].map((id) => ({ id: wid(id) }));
  const entry = await result(f, 'groupMembers', { groupId: ids.group });
  assert.deepEqual(entry.value, { candidates: [ids.contact, ids.lid, ids.contact],
    selfIds: [mePn, meLid], skipped: 2 });
  assert.deepEqual(f.sends, []);
});

test('a self alias must be proved by a matching PN/LID pair before mixed-namespace member discovery', async () => {
  for (const known of ['pn', 'lid']) {
    const f = setup(); f.self[known === 'pn' ? 'lid' : 'pn'] = '';
    f.WPP.contact.getPnLidEntry = async () => ({ phoneNumber: wid(mePn), lid: wid(meLid) });
    f.behavior.participants = () => [mePn, meLid, ids.contact, ids.lid].map((id) => ({ id: wid(id) }));
    assert.deepEqual((await result(f, 'groupMembers', { groupId: ids.group })).value,
      { candidates: [ids.contact, ids.lid], selfIds: [mePn, meLid], skipped: 2 });
  }
  for (const pair of [null, { phoneNumber: wid(mePn) }, { phoneNumber: wid('111@c.us'), lid: wid(meLid) }]) {
    const f = setup(); f.self.lid = ''; f.WPP.contact.getPnLidEntry = async () => pair;
    assert.equal((await result(f, 'groupMembers', { groupId: ids.group })).error, 'CAPABILITY_UNAVAILABLE');
  }
  const f = setup(); f.self.lid = ''; f.WPP.contact.getPnLidEntry = async () => null;
  f.behavior.participants = () => [{ id: wid(mePn) }, { id: wid(ids.contact) }];
  assert.deepEqual((await result(f, 'groupMembers', { groupId: ids.group })).value,
    { candidates: [ids.contact], selfIds: [mePn], skipped: 1 });
});

test('unknown self, unsupported group, invalid members and oversized raw member lists cannot grant recipients', async () => {
  for (const mutate of [f => { f.self.pn = ''; f.self.lid = ''; },
    f => { delete f.WPP.whatsapp.UserPrefs; }, f => { f.self.pn = meLid; },
    f => { f.models.get(ids.group).isParentGroup = true; },
    f => { f.models.get(ids.group).id = wid('333@g.us'); },
    f => { f.behavior.participants = () => [{ id: wid('status@broadcast') }]; },
    f => { f.behavior.participants = () => Array(10001).fill({ id: wid(ids.contact) }); }]) {
    const f = setup(); mutate(f);
    assert.equal((await result(f, 'groupMembers', { groupId: ids.group })).error, 'CAPABILITY_UNAVAILABLE');
    assert.deepEqual(f.sends, []);
  }
  const f = setup();
  assert.equal((await result(f, 'groupMembers', { groupId: ids.contact })).error, 'CAPABILITY_UNAVAILABLE');
});

test('group enumeration checks cancellation, timeout, runtime replacement and self changes after every await', async () => {
  for (const change of ['cancel', 'revoke', 'timeout', 'identity', 'runtime']) {
    const f = setup(), pending = deferred();
    f.behavior.participants = () => pending.promise;
    const call = f.start('groupMembers', { groupId: ids.group }); await f.flush();
    if (change === 'cancel') f.bridge.cancel(f.generation, call.id);
    if (change === 'revoke') f.bridge.revoke(f.generation);
    if (change === 'timeout') await f.advance(5001);
    if (change === 'identity') f.self.pn = '888000@c.us';
    if (change === 'runtime') f.window.WPP = { ...f.WPP };
    pending.resolve([{ id: wid(ids.contact) }]); await f.flush();
    const entry = f.read(call.id);
    if (['cancel', 'revoke'].includes(change)) assert.equal(entry, null);
    else assert.equal(entry.error, change === 'timeout' ? 'TIMED_OUT' : 'GUEST_CHANGED');
    assert.deepEqual(f.sends, []);
  }
});

test('group contact verification excludes a canonical self alias and refuses uncovered namespaces', async () => {
  const f = setup();
  f.WPP.contact.queryExists = async () => ({ wid: wid(ids.contact), lid: wid(meLid) });
  const entry = await result(f, 'resolveContacts', { candidates: [ids.contact], selfIds: [mePn, meLid] });
  assert.deepEqual(entry.value, [{ candidate: ids.contact, chat: null }]);
  f.self.lid = '';
  assert.equal((await result(f, 'resolveContacts', { candidates: [ids.contact], selfIds: [mePn] })).error,
    'CAPABILITY_UNAVAILABLE');
  assert.deepEqual(f.sends, []);
});

test('group verification rechecks frozen self identity during the shared lookup and never proceeds after a change', async () => {
  const f = setup(), pending = deferred(), finds = [];
  f.WPP.contact.queryExists = () => pending.promise;
  f.WPP.chat.find = (id) => { finds.push(id); return f.models.get(id); };
  const call = f.start('resolveContacts', { candidates: [ids.contact], selfIds: [mePn, meLid] });
  await f.flush(); f.self.pn = '888000@c.us'; pending.resolve({ wid: wid(ids.contact) }); await f.flush();
  assert.equal(f.read(call.id).error, 'GUEST_CHANGED'); assert.deepEqual(finds, []);
  assert.deepEqual(f.sends, []);
});

test('label membership uses exact model IDs, keeps ordinary groups and never invokes name-based lookup', async () => {
  const f = setup();
  f.models.get(ids.contact).labels = ['1']; f.models.get(ids.group).labels = ['1']; f.models.get(ids.lid).labels = ['2'];
  f.WPP.chat.list = () => { throw new Error('No name-first label query'); };
  const entry = await result(f, 'labelMembers', { labelId: '1', chatIds: Object.values(ids) });
  assert.deepEqual(entry.value, { labelId: '1', chatIds: [ids.contact, ids.group] });
  assert.deepEqual(f.sends, []);
});

test('deleted labels, mismatched labels and changed directory models cannot produce a partial audience', async () => {
  for (const change of ['deleted', 'wrong-id', 'model', 'membership']) {
    const f = setup();
    f.models.get(ids.contact).labels = ['1'];
    if (change === 'deleted') f.labels = [];
    if (change === 'wrong-id') f.WPP.labels.getLabelById = () => f.labels[1];
    if (change === 'model') f.models.get(ids.lid).id = wid('777@lid');
    if (change === 'membership') f.models.get(ids.lid).labels = ['1', null];
    const entry = await result(f, 'labelMembers', { labelId: '1', chatIds: [ids.contact, ids.lid] });
    assert.equal(entry.error, 'CAPABILITY_UNAVAILABLE'); assert.equal(entry.value, undefined);
  }
});

test('label calls are bounded and a late lookup cannot read models after cancellation', async () => {
  for (const payload of [{ labelId: 'bad/id', chatIds: [ids.contact] }, { labelId: '1', chatIds: [] },
    { labelId: '1', chatIds: [ids.contact, ids.contact] }, { labelId: '1', chatIds: ['status@broadcast'] },
    { labelId: '1', chatIds: Array.from({ length: 201 }, (_, index) => `${index}@c.us`) }]) {
    const f = setup(); let queries = 0; f.WPP.labels.getLabelById = () => { queries++; return f.labels[0]; };
    assert.equal((await result(f, 'labelMembers', payload)).error, 'CAPABILITY_UNAVAILABLE');
    assert.equal(queries, 0);
  }
  const f = setup(), pending = deferred(); let reads = 0;
  f.WPP.labels.getLabelById = () => pending.promise;
  f.WPP.chat.get = () => { reads++; throw new Error('late model read'); };
  const call = f.start('labelMembers', { labelId: '1', chatIds: [ids.contact] });
  await f.flush(); f.bridge.cancel(f.generation, call.id); pending.resolve(f.labels[0]); await f.flush();
  assert.equal(reads, 0); assert.equal(f.read(call.id), null); assert.deepEqual(f.sends, []);
});
