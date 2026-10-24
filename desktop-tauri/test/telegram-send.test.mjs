import assert from 'node:assert/strict';
import test from 'node:test';
import { telegramFixture, deferred, flush } from './helpers/telegram-send.mjs';

test('K stages an exact fractional pending identity and confirms its own server ID', async () => {
  const f = telegramFixture();
  const text = '**literal text** 🎲 https://example.test';
  const prepared = await f.adapter.prepare(f.request({ message: text }));
  assert.equal(f.state.sends.length, 0);
  const result = await f.finish(f.adapter.dispatch(prepared, () => true));
  assert.equal(result.status, 'confirmed'); assert.equal(result.receipt, 'tg:101:700');
  assert.equal(f.state.sends.length, 1);
  const send = f.state.sends[0];
  assert.equal(send.method, 'messages.sendMessage'); assert.equal(send.account, 1);
  assert.equal(send.params.random_id, f.state.stages[0].message.random_id);
  assert.equal(send.params.message, text);
  assert.equal(send.params.clear_draft, false); assert.equal(send.params.no_webpage, true);
  assert.equal(send.options.rawError, true);
  assert.equal(Number.isInteger(f.state.stages[0].message.mid), false);
  assert.equal('send' in f.state.stages[0].message, false);
  assert.deepEqual(f.state.updates.map(({ update }) => update._), ['updateMessageID', 'updateNewMessage']);
  assert.equal(f.root.count('message_sent'), 0);
  assert.equal((await f.adapter.dispatch(prepared, () => true)).status, 'notSubmitted');
  assert.equal(f.state.sends.length, 1);
});

test('normal updates and ordinary group IDs use the same exact finalizer', async () => {
  const f = telegramFixture(); f.state.mode = 'updates';
  const prepared = await f.adapter.prepare(f.request({ targetId: 'tg:-202' }));
  const result = await f.finish(f.adapter.dispatch(prepared, () => true));
  assert.equal(result.receipt, 'tg:-202:700');
  assert.equal(f.state.sends[0].params.peer._, 'inputPeerChannel');
  assert.equal(f.state.sends[0].params.peer.channel_id, 202);
  assert.ok(f.state.stages[0].message.mid > 0x100000000);
  assert.equal(f.state.mirrors.get(`-202_history:${0x100000000 + 700}`).id, 700);
  assert.equal(f.state.updates[0].update._, 'updates');
});

test('history_append, local pending and unrelated same-text receipts cannot confirm', async () => {
  const f = telegramFixture(); f.state.mode = 'never';
  const prepared = await f.adapter.prepare(f.request());
  let done = false;
  const promise = f.adapter.dispatch(prepared, () => true).then((value) => { done = true; return value; });
  await f.until(() => f.state.sends.length === 1);
  const pending = f.state.stages[0].message;
  assert.equal(done, false);
  f.emitFinal({ ...pending, id: 101.001, mid: 101.001, random_id: '7654321' });
  await f.advance(); assert.equal(done, false);
  f.emitFinal(pending);
  assert.equal((await f.finish(promise)).status, 'confirmed');
  assert.equal(f.state.sends.length, 1);
});

test('receipt requires exact peer, temp identity, integer final ID and authoritative mirror', async () => {
  const f = telegramFixture(); f.state.mode = 'never';
  const prepared = await f.adapter.prepare(f.request());
  let done = false;
  const promise = f.adapter.dispatch(prepared, () => true).then((value) => { done = true; return value; });
  await f.until(() => f.state.sends.length === 1);
  const pending = f.state.stages[0].message;
  for (const overrides of [{ peerId: 102 }, { text: 'Different' }, { id: 2.0001 },
    { pFlags: { out: false } }, { media: { _: 'messageMediaPhoto' } }, { reply_to: {} }]) {
    f.emitFinal(pending, overrides); await f.advance(); assert.equal(done, false);
  }
  const final = { _: 'message', peerId: 101, id: 700, mid: 700, message: 'Hello', pFlags: { out: true } };
  f.state.mirrors.clear();
  f.root.emit('message_sent', { storageKey: '101_history', tempId: pending.mid, tempMessage: pending, mid: 700, message: final });
  await f.advance(); assert.equal(done, false);
  f.emitFinal(pending);
  assert.equal((await f.finish(promise)).status, 'confirmed');
});

test('fulfilled void, rejection and synchronous throw are uncertain after one invocation', async () => {
  for (const mode of ['void', 'error', 'throw']) {
    const f = telegramFixture(); f.state.mode = mode; f.state.apiThrow = mode === 'throw';
    const prepared = await f.adapter.prepare(f.request());
    const result = await f.finish(f.adapter.dispatch(prepared, () => true));
    assert.equal(result.status, 'uncertain', mode);
    assert.equal(f.state.sends.length, 1); assert.equal(f.state.cancelled.length, 0);
    assert.equal(JSON.stringify(result).includes('untrusted'), false);
  }
});

test('ACK timeout remains uncertain after a late receipt and releases its listeners', async () => {
  const f = telegramFixture(); f.state.mode = 'never';
  const prepared = await f.adapter.prepare(f.request());
  const promise = f.adapter.dispatch(prepared, () => true);
  await f.until(() => f.state.sends.length === 1);
  await f.advance(30000);
  const result = await promise;
  assert.equal(result.status, 'uncertain'); assert.equal(result.code, 'TIMED_OUT');
  f.emitFinal(f.state.stages[0].message); await f.advance();
  assert.equal(result.status, 'uncertain'); assert.equal(f.root.count('message_sent'), 0);
  assert.equal(f.state.sends.length, 1);
});

test('cancel during identity generation invokes nothing even when the read completes late', async () => {
  const f = telegramFixture(); const gate = deferred();
  const prepared = await f.adapter.prepare(f.request());
  f.state.generateGate = gate; let valid = true;
  const promise = f.adapter.dispatch(prepared, () => valid);
  await flush(); valid = false; await f.advance(50);
  const result = await f.finish(promise);
  assert.equal(result.status, 'notSubmitted');
  gate.resolve(); await flush();
  assert.equal(f.state.stages.length, 0); assert.equal(f.state.sends.length, 0);
});

test('hung read-only RPC expires without leaving a send or a local pending', async () => {
  const f = telegramFixture(); f.state.configGate = deferred();
  const promise = f.adapter.prepare(f.request());
  const rejected = assert.rejects(promise, (error) => error.code === 'TIMED_OUT');
  await flush(); await f.advance(12000); await rejected;
  f.state.configGate.resolve(); await flush();
  assert.equal(f.state.stages.length, 0); assert.equal(f.state.sends.length, 0);
});

test('cancel after local pending removes only its frozen account pending before network send', async () => {
  const f = telegramFixture();
  const prepared = await f.adapter.prepare(f.request());
  f.state.stageHook = () => f.switchAccount();
  const result = await f.finish(f.adapter.dispatch(prepared, () => true));
  assert.equal(result.status, 'notSubmitted'); assert.equal(f.state.sends.length, 0);
  assert.deepEqual(f.state.cancelled, [{ account: 1, randomId: f.state.stages[0].message.random_id }]);
});

test('switch after submission cannot deliver a late ACK or retarget its updates', async () => {
  const f = telegramFixture(); f.state.apiGate = deferred();
  const prepared = await f.adapter.prepare(f.request());
  const promise = f.adapter.dispatch(prepared, () => true);
  await f.until(() => f.state.sends.length === 1);
  f.switchAccount(); await f.advance();
  assert.equal((await promise).status, 'uncertain');
  f.state.apiGate.resolve({ _: 'updateShortSentMessage', id: 800, date: 5, pFlags: { out: true }, pts: 1, pts_count: 1 });
  await flush();
  assert.equal(f.state.sends.length, 1);
  assert.deepEqual(f.state.updates.map((value) => value.account), [1, 1]);
  assert.equal(f.root.count('message_sent'), 0);
});

test('catalog exposes namespaced real users and ordinary groups with finite media capabilities', async () => {
  const f = telegramFixture();
  for (const [id, peer] of [[90, { _: 'user', id: 90, pFlags: { self: true } }],
    [-303, { _: 'channel', id: 303, pFlags: { broadcast: true }, title: 'Channel' }],
    [-404, { _: 'channel', id: 404, pFlags: { megagroup: true, forum: true }, title: 'Forum' }]]) {
    f.state.peers.set(id, peer); f.state.dialogs[0].push({ _: 'dialog', peerId: id });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(await f.adapter.listChats())), [
    { id: 'tg:101', name: 'Alice', realName: 'Alice', kind: 'contact' },
    { id: 'tg:-202', name: 'Team', realName: 'Team', kind: 'group' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(f.adapter.capabilities())),
    { text: true, scheduled: true, attachments: true, tagAll: false, groupMembers: true, vcards: false });
  assert.equal(await f.adapter.audienceOptions(), null);
});

test('paid, restricted, migrated, special peers and unsupported payloads fail before pending', async () => {
  const scenarios = [
    (f) => { f.state.requirement = { _: 'requirementToContactPaidMessages', stars_amount: '1' }; },
    (f) => { f.state.requirement = undefined; }, (f) => { f.state.allowed = false; },
    (f) => { f.state.migrated = 102; }, (f) => { f.state.botforum = true; },
    (f) => { f.state.peers.get(101).pFlags.deleted = true; },
    (f) => { f.location.href = 'https://web.telegram.org/a/#101'; },
  ];
  for (const scenario of scenarios) {
    const f = telegramFixture(); scenario(f);
    await assert.rejects(f.adapter.prepare(f.request()));
    assert.equal(f.state.stages.length, 0); assert.equal(f.state.sends.length, 0);
  }
  for (const overrides of [{ message: 'a'.repeat(4097) }, { tagAll: true }, { vcards: [{ id: 'tg:101' }] },
    { attachments: [{}] }, { targetId: '101' }]) {
    const f = telegramFixture(); await assert.rejects(f.adapter.prepare(f.request(overrides)));
    assert.equal(f.state.sends.length, 0);
  }
  const f = telegramFixture(); f.state.peers.get(-202).pFlags.slowmode_enabled = true;
  await assert.rejects(f.adapter.prepare(f.request({ targetId: 'tg:-202' })));
});
