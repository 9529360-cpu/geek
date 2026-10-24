import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { telegramFixture, deferred, flush } from './helpers/telegram-send.mjs';

const { compose } = createRequire(import.meta.url)('../scripts/prepare-platform.cjs');
const copy = (value) => JSON.parse(JSON.stringify(value));
const phone = '12025550101';
const user = (id, extra = {}) => ({ _: 'user', id, pFlags: {}, first_name: `User ${id}`, ...extra });
const members = (ids, count = ids.length) => ({ _: 'channels.channelParticipants', count,
  participants: ids.map((user_id) => ({ _: 'channelParticipant', user_id })), users: [], chats: [] });
const resolve = (f, candidates = [phone], extra = {}, valid = () => true) =>
  f.adapter.resolveContacts({ candidates, ...extra }, valid);
const group = (f, groupId = 'tg:-202', valid = () => true) => f.adapter.groupMembers({ groupId }, valid);
const noWrites = (f) => {
  assert.equal(f.state.sends.length, 0); assert.equal(f.state.stages.length, 0);
  assert.equal(f.state.clears.length, 0); assert.equal(f.editor.innerText, 'Please send tomorrow.');
  assert.equal(f.chat.peerId, 101); assert.equal(f.location.hash, '#101');
};

test('actual composed catalog matches the same ready fixture consumed by Rust native ingress', async () => {
  const f = telegramFixture({ install: false });
  f.run(compose());
  const bridge = f.window.__geekTauriPlatform;
  const generation = '10000000-0000-4000-8000-000000000001';
  const id = '20000000-0000-4000-8000-000000000001';
  assert.equal(bridge.bind(generation), true);
  assert.equal(bridge.begin({ id, generation, platformId: 'telegram-k', operation: 'catalog', payload: {} }), true);
  let response;
  await f.until(() => { response = bridge.read(generation, id); return response && !response.pending; });
  assert.equal(response.error, undefined);
  const expected = JSON.parse(readFileSync(new URL('./fixtures/telegram-catalog-ready.json', import.meta.url), 'utf8'));
  assert.deepEqual(copy(response.value), expected);
  noWrites(f);
});

test('phone and cached canonical user IDs resolve to the same exact current-account peer', async () => {
  const f = telegramFixture();
  const result = await resolve(f, [phone, 'tg:101']);
  assert.deepEqual(copy(result), [phone, 'tg:101'].map((candidate) => ({ candidate,
    chat: { id: 'tg:101', name: 'Alice', realName: 'Alice', kind: 'contact' } })));
  assert.deepEqual(f.state.phoneLookups, [{ account: 1, phone, at: 0 }]);
  noWrites(f);
});

test('phone resolution can load a new peer without opening its chat or inventing a number-based ID', async () => {
  const f = telegramFixture();
  f.window.createProxiedManagersForAccount(1).appUsersManager.resolvePhone = async (value) => {
    assert.equal(value, phone);
    const peer = user(321, { first_name: '实际\n姓名', phone });
    f.state.peers.set(321, peer); return { ...peer, first_name: 'Query projection' };
  };
  assert.deepEqual(copy(await resolve(f)), [{ candidate: phone,
    chat: { id: 'tg:321', name: '实际姓名', realName: '实际姓名', kind: 'contact' } }]);
  noWrites(f);
});

test('documented no-user response is unresolved; unknown failures abort without partial results or retries', async () => {
  const f = telegramFixture();
  assert.deepEqual(copy(await resolve(f, ['12025550999'])), [{ candidate: '12025550999', chat: null }]);
  for (const error of [{ type: 'FLOOD_WAIT_30' }, { code: 'PHONE_NOT_OCCUPIED' }, new Error('private network details')]) {
    const failed = telegramFixture(); failed.state.phoneError = error;
    await assert.rejects(resolve(failed), (value) => value.code === 'RUNTIME_FAILED');
    assert.equal(failed.state.phoneLookups.length, 1); noWrites(failed);
  }
});

test('phone calls remain three seconds apart across distinct native batches', async () => {
  const f = telegramFixture();
  await resolve(f);
  const pending = resolve(f, ['12025550999']);
  await flush(); await f.advance(2999); assert.equal(f.state.phoneLookups.length, 1);
  await f.advance(1);
  assert.deepEqual(copy(await f.finish(pending)), [{ candidate: '12025550999', chat: null }]);
  assert.deepEqual(f.state.phoneLookups.map((value) => value.at), [0, 3000]);
  noWrites(f);
});

test('batch fields, namespace and current self identity are checked before any query', async () => {
  for (const candidates of [[], [phone, phone], [phone, 'tg:101', 'tg:102'], ['tg:-202'],
    ['101@c.us'], ['+12025550101'], ['tg:01'], ['tg:9007199254740992'], ['tg:0'], [null]]) {
    const f = telegramFixture(); await assert.rejects(resolve(f, candidates));
    assert.equal(f.state.phoneLookups.length, 0); noWrites(f);
  }
  for (const extra of [{ selfIds: ['tg:91'] }, { selfIds: ['tg:90', 'tg:90'] }, { method: 'send' }]) {
    const f = telegramFixture(); await assert.rejects(resolve(f, [phone], extra));
    assert.equal(f.state.phoneLookups.length, 0);
  }
});

test('self, unknown, mismatched phones and unsupported user models never acquire recipient authority', async () => {
  for (const candidate of ['tg:90', 'tg:888']) {
    const f = telegramFixture();
    assert.equal((await resolve(f, [candidate]))[0].chat, null); noWrites(f);
  }
  for (const extra of [{ phone: '12025550102' }, { pFlags: { min: true } }, { pFlags: { deleted: true } },
    { pFlags: { self: true } }, { send_paid_messages_stars: '1' }]) {
    const f = telegramFixture(); Object.assign(f.state.peers.get(101), extra);
    assert.equal((await resolve(f))[0].chat, null); noWrites(f);
  }
  const f = telegramFixture();
  f.window.createProxiedManagersForAccount(1).appPeersManager.getInputPeerById = async () =>
    ({ _: 'inputPeerUser', user_id: 102, access_hash: '1' });
  assert.equal((await resolve(f))[0].chat, null); noWrites(f);
});

test('cancel while pacing cannot issue the next phone lookup', async () => {
  const f = telegramFixture(); let valid = true;
  const pending = resolve(f, [phone, '12025550102'], {}, () => valid);
  const rejected = assert.rejects(pending, (error) => error.code === 'CANCELLED');
  await f.until(() => f.state.phoneLookups.length === 1); valid = false;
  await f.advance(50); await rejected; await f.advance(3000);
  assert.equal(f.state.phoneLookups.length, 1); noWrites(f);
});

test('account A to B to A during lookup permanently invalidates that bridge owner', async () => {
  const f = telegramFixture(); f.state.phoneGate = deferred();
  const pending = resolve(f, [phone, 'tg:101']);
  const rejected = assert.rejects(pending, (error) => error.code === 'ACCOUNT_UNAVAILABLE');
  await f.until(() => f.state.phoneLookups.length === 1);
  f.switchAccount(); f.switchAccount(1, 90); await f.advance(50); await rejected;
  f.state.phoneGate.resolve(); await flush();
  await assert.rejects(resolve(f, ['tg:101']), (error) => error.code === 'ACCOUNT_UNAVAILABLE');
  assert.equal(f.state.phoneLookups.length, 1); noWrites(f);
});

test('hung lookup has a finite deadline and its late result cannot continue a batch', async () => {
  const f = telegramFixture(); f.state.phoneGate = deferred();
  const pending = resolve(f, [phone, '12025550102']);
  const rejected = assert.rejects(pending, (error) => error.code === 'TIMED_OUT');
  await f.until(() => f.state.phoneLookups.length === 1); await f.advance(30000); await rejected;
  f.state.phoneGate.resolve(); await flush();
  assert.equal(f.state.phoneLookups.length, 1); noWrites(f);
});

test('ordinary group audience filters self and resolves through the same canonical contact path', async () => {
  const f = telegramFixture();
  const audience = await group(f);
  assert.deepEqual(copy(audience), { candidates: ['tg:101'], selfIds: ['tg:90'], skipped: 1 });
  assert.deepEqual(f.state.memberLookups, [{ account: 1,
    options: { id: 202, filter: { _: 'channelParticipantsRecent' }, limit: 200, offset: 0 } }]);
  assert.equal((await resolve(f, audience.candidates, { selfIds: audience.selfIds }))[0].chat.id, 'tg:101');
  assert.equal(f.state.phoneLookups.length, 0); noWrites(f);
});

test('basic groups bind chatParticipants to the requested group and version', async () => {
  const f = telegramFixture();
  f.state.peers.set(-202, { _: 'chat', id: 202, pFlags: {}, version: 5, title: 'Basic' });
  f.state.memberPages.set('202:0', { _: 'chatParticipants', chat_id: 202, version: 5,
    participants: [{ _: 'chatParticipantCreator', user_id: 90 }, { _: 'chatParticipant', user_id: 101 }] });
  assert.deepEqual(copy(await group(f)), { candidates: ['tg:101'], selfIds: ['tg:90'], skipped: 1 });
  f.state.memberPages.get('202:0').chat_id = 203;
  await assert.rejects(group(f)); noWrites(f);
});

test('complete megagroup pagination uses exact offsets and preserves member order', async () => {
  const f = telegramFixture();
  const ids = Array.from({ length: 205 }, (_, index) => 1000 + index);
  f.state.fullGroups.get(202).participants_count = ids.length;
  for (const id of ids) f.state.peers.set(id, user(id));
  f.state.memberPages.set('202:0', members(ids.slice(0, 200), ids.length));
  f.state.memberPages.set('202:200', members(ids.slice(200), ids.length));
  assert.deepEqual(copy((await group(f)).candidates), ids.map((id) => `tg:${id}`));
  assert.deepEqual(f.state.memberLookups.map((value) => value.options.offset), [0, 200]);
  noWrites(f);
});

test('a recent-only participant result cannot stand in for the full megagroup count', async () => {
  const f = telegramFixture();
  f.state.fullGroups.get(202).participants_count = 500;
  await assert.rejects(group(f));
  assert.equal(f.state.memberLookups.length, 1); noWrites(f);
});

test('hidden or unavailable full participant metadata rejects before enumeration', async () => {
  for (const patch of [{ pFlags: { can_view_participants: true, participants_hidden: true } },
    { pFlags: {} }, { id: 203 }, { participants_count: undefined }, { participants_count: 10001 }]) {
    const f = telegramFixture(); Object.assign(f.state.fullGroups.get(202), patch);
    await assert.rejects(group(f));
    assert.equal(f.state.memberLookups.length, 0); noWrites(f);
  }
});

test('hidden, truncated, repeated and changing participant pages never publish a partial audience', async () => {
  for (const result of [members([], 2), members([101], 10001),
    members([101, 101]), { _: 'channels.channelParticipantsNotModified' },
    { ...members([101]), participants: [{ _: 'channelParticipantBanned', user_id: 101 }] },
    { ...members([101]), participants: [{ _: 'channelParticipant', user_id: 101, peer: { _: 'peerUser', user_id: 101 } }] },
    { ...members([101]), participants: [{ _: 'channelParticipant', user_id: 0 }] }]) {
    const f = telegramFixture(); f.state.memberPages.set('202:0', result);
    await assert.rejects(group(f)); noWrites(f);
  }
  for (const next of [members([], 2), members([101], 2), members([102], 3)]) {
    const f = telegramFixture(); f.state.memberPages.set('202:0', members([101], 2));
    f.state.memberPages.set('202:1', next); await assert.rejects(group(f)); noWrites(f);
  }
});

test('group becomes unsupported or changes basic version during lookup before any list is returned', async () => {
  for (const basic of [false, true]) {
    const f = telegramFixture();
    if (basic) f.state.peers.set(-202, { _: 'chat', id: 202, version: 5, pFlags: {}, title: 'Basic' });
    f.state.memberHook = () => {
      if (basic) f.state.peers.get(-202).version = 6;
      else f.state.peers.get(-202).pFlags.forum = true;
    };
    await assert.rejects(group(f)); assert.equal(f.state.memberLookups.length, 1); noWrites(f);
  }
});

test('group cancellation and account change discard a late read before the next page', async () => {
  for (const changeAccount of [false, true]) {
    const f = telegramFixture(); f.state.memberGate = deferred(); let valid = true;
    f.state.memberPages.set('202:0', members([101], 2));
    const pending = group(f, 'tg:-202', () => valid);
    const rejected = assert.rejects(pending, (error) =>
      error.code === (changeAccount ? 'ACCOUNT_UNAVAILABLE' : 'CANCELLED'));
    await f.until(() => f.state.memberLookups.length === 1);
    if (changeAccount) f.switchAccount(); else valid = false;
    await f.advance(50); await rejected;
    f.state.memberGate.resolve(); await flush();
    assert.equal(f.state.memberLookups.length, 1); noWrites(f);
  }
});
