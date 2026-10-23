import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fixture, ids, uuid, wid, chat, receipt, deferred } = require('./platform-bridge-fixture.cjs');

async function result(f, call) {
  assert.equal(call.accepted, true);
  await f.flush();
  const entry = f.read(call.id);
  assert.ok(entry, 'request must still belong to the live mailbox');
  assert.equal(entry.pending, false, 'stubbed operation must have settled');
  return entry;
}

async function prepare(f, request) {
  const entry = await result(f, f.start('prepare', request));
  assert.equal(entry.error, undefined);
  assert.deepEqual(entry.value, { prepared: true });
}

async function dispatch(f, request, options) {
  return (await result(f, f.start('dispatch', { attemptId: request.attemptId }, options))).value;
}

test('the composed bridge binds one top-frame generation and rejects unrelated requests', async () => {
  assert.equal(fixture({ iframe: true }).bridge, undefined);
  const f = fixture();
  assert.equal(f.bridge.matches(f.generation), true);
  assert.equal(f.bridge.bind(uuid(2)), false);
  assert.equal(f.start('catalog', {}, { generation: uuid(2) }).accepted, false);
  assert.equal(f.start('catalog', {}, { id: 'not-a-request-token' }).accepted, false);
  assert.equal(f.read(uuid(30), uuid(2)), null);
  for (const platformId of ['telegram-z', 'line', 'website']) {
    const entry = await result(f, f.start('catalog', {}, { platformId }));
    assert.ok(entry.error);
  }
  assert.deepEqual(f.sends, []);
});

test('catalog uses canonical chats, excludes unsupported Wids and discovers capabilities after readiness', async () => {
  const f = fixture();
  const unsupported = [
    chat('400@newsletter', { isNewsletter: true }),
    chat('status@broadcast', { isBroadcast: true }),
    chat('500@broadcast', { isBroadcast: true }),
    chat('600@g.us', { isParentGroup: true }),
    chat('700@g.us', { groupMetadata: { isParentGroup: true } }),
    chat('800@g.us', { isGroup: false }),
    chat('900@c.us', { isGroup: true }),
    chat('1000@c.us', { isNewsletter: true }),
    chat('1100@c.us', { isBroadcast: true }),
    chat('letters@c.us'),
  ];
  for (const model of unsupported) f.models.set(String(model.id), model);
  const text = f.WPP.chat.sendTextMessage;
  delete f.WPP.chat.sendTextMessage;
  f.behavior.list = () => {
    f.WPP.chat.sendTextMessage = text;
    return [...f.models.values()];
  };
  const entry = await result(f, f.start('catalog'));
  assert.equal(entry.error, undefined);
  assert.deepEqual(entry.value.chats.map(({ id }) => id), Object.values(ids));
  assert.deepEqual(entry.value.chats.map(({ kind }) => kind), ['contact', 'contact', 'group']);
  assert.deepEqual(entry.value.capabilities, { text: true, scheduled: true, attachments: false, tagAll: true,
    vcards: true, groupMembers: false });
  assert.equal(entry.value.labels, null);
  assert.deepEqual(f.sends, []);
});

test('catalog readiness waits are bounded and use no real sleeps', async () => {
  const f = fixture();
  f.state.ready = false;
  const pending = f.start('catalog');
  await f.advance(500);
  assert.equal(f.read(pending.id).pending, true);
  f.state.ready = true;
  await f.advance(500);
  assert.equal(f.read(pending.id).value.chats.length, 3);
  const unavailable = fixture();
  unavailable.WPP.isReady = false;
  const failed = unavailable.start('catalog');
  await unavailable.advance(12000);
  assert.equal(unavailable.read(failed.id).error, 'ACCOUNT_UNAVAILABLE');
  assert.deepEqual(unavailable.sends, []);
});

test('text sends use the frozen target and require an acknowledged receipt', async () => {
  const f = fixture();
  const request = f.draft();
  await prepare(f, request);
  const outcome = await dispatch(f, request);
  assert.equal(outcome.status, 'confirmed');
  assert.equal(outcome.receipt, `true_${ids.contact}_TEST1`);
  assert.deepEqual(f.sends, [{ kind: 'text', target: ids.contact, value: request.message, options: { waitForAck: true } }]);
  assert.notEqual(String(f.WPP.chat.getActiveChat().id), request.targetId);
});

test('the canonical send guard rejects a changed chat both before and after preparation', async () => {
  for (const changeAfterPrepare of [false, true]) {
    const f = fixture();
    const request = f.draft();
    if (changeAfterPrepare) await prepare(f, request);
    f.models.get(ids.contact).id = wid(ids.lid);
    if (changeAfterPrepare) {
      assert.deepEqual(await dispatch(f, request), { status: 'notSubmitted', code: 'TARGET_CHANGED' });
    } else {
      assert.equal((await result(f, f.start('prepare', request))).error, 'TARGET_CHANGED');
    }
    assert.deepEqual(f.sends, []);
  }
});

test('unsupported targets cannot exploit WA-JS newsletter pseudo acknowledgements', async () => {
  for (const model of [chat('400@newsletter', { isNewsletter: true }), chat('status@broadcast'),
    chat('600@g.us', { groupMetadata: { isParentGroup: true } }), chat('800@g.us', { isGroup: false })]) {
    const f = fixture();
    f.models.set(String(model.id), model);
    f.behavior.text = () => receipt('newsletter-pseudo-success', 1);
    const request = f.draft({ targetId: String(model.id) });
    assert.equal((await result(f, f.start('prepare', request))).error, 'CAPABILITY_UNAVAILABLE');
    assert.deepEqual(await dispatch(f, request), { status: 'notSubmitted', code: 'NOT_SUBMITTED' });
    assert.deepEqual(f.sends, []);
  }
  const f = fixture();
  const request = f.draft();
  await prepare(f, request);
  f.models.get(ids.contact).isNewsletter = true;
  assert.deepEqual(await dispatch(f, request), { status: 'notSubmitted', code: 'CAPABILITY_UNAVAILABLE' });
  assert.deepEqual(f.sends, []);
});

test('empty, synthetic, malformed and unacknowledged returns remain uncertain without retry', async () => {
  const invalid = [null, {}, receipt('submitted'), receipt(''), receipt('x'.repeat(501)), receipt('invalid\nid'),
    receipt('id', 0), receipt('id', -1), receipt('id', '1'), receipt('id', NaN), receipt('id', Infinity), { id: 'id' }];
  for (const value of invalid) {
    const f = fixture();
    f.behavior.text = () => value;
    const request = f.draft();
    await prepare(f, request);
    assert.deepEqual(await dispatch(f, request), { status: 'uncertain', code: 'RECEIPT_MISSING' });
    assert.deepEqual(await dispatch(f, request), { status: 'notSubmitted', code: 'NOT_SUBMITTED' });
    assert.equal(f.sends.length, 1);
  }
});

test('text plus cards requires both receipts and preserves a partial failure as uncertain', async () => {
  const f = fixture();
  const request = f.draft({ vcards: [{ id: ids.lid, name: 'Synthetic contact' }] });
  await prepare(f, request);
  const outcome = await dispatch(f, request);
  assert.deepEqual(outcome, { status: 'confirmed', receipt: `true_${ids.contact}_TEST1|true_${ids.contact}_TEST2` });
  assert.deepEqual(f.sends.map(({ kind }) => kind), ['text', 'cards']);
  assert.deepEqual(f.sends[1].value, [{ id: ids.contact, name: 'Synthetic contact' }]);
  assert.deepEqual(f.sends[1].options, { waitForAck: true });
  const partial = fixture();
  partial.behavior.cards = () => { throw Object.assign(new Error('synthetic failure'), { code: 'RUNTIME_FAILED' }); };
  const failed = partial.draft({ vcards: [{ id: ids.contact, name: 'Synthetic contact' }] });
  await prepare(partial, failed);
  assert.deepEqual(await dispatch(partial, failed), { status: 'uncertain', code: 'RUNTIME_FAILED' });
  assert.deepEqual(partial.sends.map(({ kind }) => kind), ['text', 'cards']);
  assert.deepEqual(await dispatch(partial, failed), { status: 'notSubmitted', code: 'NOT_SUBMITTED' });
});

test('card preflight resolves Lids before any text mutation and never drops unresolved cards', async () => {
  const f = fixture();
  f.behavior.lookup = () => ({ phoneNumber: wid(ids.lid) });
  const request = f.draft({ vcards: [{ id: ids.lid, name: 'Synthetic contact' }] });
  assert.equal((await result(f, f.start('prepare', request))).error, 'CAPABILITY_UNAVAILABLE');
  assert.deepEqual(f.sends, []);
  const cards = fixture();
  const cardOnly = cards.draft({ message: '', vcards: [{ id: ids.contact, name: 'Synthetic contact' }] });
  await prepare(cards, cardOnly);
  assert.equal((await dispatch(cards, cardOnly)).status, 'confirmed');
  assert.deepEqual(cards.sends.map(({ kind }) => kind), ['cards']);
});

test('@all preserves every valid member and rejects incomplete member sets before sending', async () => {
  const f = fixture();
  const request = f.draft({ targetId: ids.group, tagAll: true });
  await prepare(f, request);
  assert.equal((await dispatch(f, request)).status, 'confirmed');
  assert.deepEqual(f.sends[0].options, { waitForAck: true, mentionedList: [ids.contact, ids.lid] });
  for (const members of [[], null, [{ id: wid(ids.contact) }, {}], [{ id: wid(ids.group) }], [{ id: wid('status@broadcast') }]]) {
    const invalid = fixture();
    invalid.behavior.participants = () => members;
    const target = invalid.draft({ targetId: ids.group, tagAll: true });
    assert.equal((await result(invalid, invalid.start('prepare', target))).error, 'CAPABILITY_UNAVAILABLE');
    assert.deepEqual(invalid.sends, []);
  }
  const missing = fixture();
  delete missing.WPP.group.getParticipants;
  assert.equal((await result(missing, missing.start('prepare', missing.draft({ targetId: ids.group, tagAll: true })))).error,
    'CAPABILITY_UNAVAILABLE');
});

test('@all with cards alone fails explicitly instead of silently sending an unmentioned card', async () => {
  const f = fixture();
  const request = f.draft({ targetId: ids.group, message: ' \n ', tagAll: true,
    vcards: [{ id: ids.contact, name: 'Synthetic contact' }] });
  assert.equal((await result(f, f.start('prepare', request))).error, 'CAPABILITY_UNAVAILABLE');
  assert.deepEqual(f.sends, []);
});

test('duplicate mailbox submissions and consumed attempts cannot replay an outbound mutation', async () => {
  const f = fixture();
  const delayed = deferred();
  f.behavior.text = () => delayed.promise;
  const request = f.draft();
  await prepare(f, request);
  const first = f.start('dispatch', { attemptId: request.attemptId });
  assert.equal(f.bridge.begin(first.request), true);
  await f.flush();
  assert.equal(f.sends.length, 1);
  assert.equal(f.read(first.id).pending, true);
  assert.deepEqual(await dispatch(f, request), { status: 'notSubmitted', code: 'NOT_SUBMITTED' });
  delayed.resolve(receipt());
  assert.equal((await result(f, first)).value.status, 'confirmed');
  f.bridge.forget(f.generation, first.id);
  await f.advance(30001);
  assert.equal((await result(f, f.start('prepare', request))).error, 'NOT_SUBMITTED');
  assert.equal(f.sends.length, 1);
});

test('concurrent preparations reserve an attempt before asynchronous preflight can complete', async () => {
  const f = fixture();
  const delayed = deferred();
  f.behavior.participants = () => delayed.promise;
  const request = f.draft({ targetId: ids.group, tagAll: true });
  const first = f.start('prepare', request);
  await f.flush();
  assert.equal(f.read(first.id).pending, true);
  assert.equal((await result(f, f.start('prepare', request))).error, 'NOT_SUBMITTED');
  delayed.resolve([{ id: wid(ids.contact) }]);
  assert.deepEqual((await result(f, first)).value, { prepared: true });
  assert.equal((await dispatch(f, request)).status, 'confirmed');
  assert.deepEqual(await dispatch(f, request), { status: 'notSubmitted', code: 'NOT_SUBMITTED' });
  assert.equal(f.sends.length, 1);
});

test('expired preparations and failed preflights remain non-replayable for this document', async () => {
  const f = fixture();
  const request = f.draft();
  await prepare(f, request);
  await f.advance(30000);
  assert.deepEqual(await dispatch(f, request), { status: 'notSubmitted', code: 'NOT_SUBMITTED' });
  assert.equal((await result(f, f.start('prepare', request))).error, 'NOT_SUBMITTED');
  const failed = f.draft({ targetId: ids.group, tagAll: true });
  f.behavior.participants = () => [];
  assert.equal((await result(f, f.start('prepare', failed))).error, 'CAPABILITY_UNAVAILABLE');
  f.behavior.participants = () => [{ id: wid(ids.contact) }];
  assert.equal((await result(f, f.start('prepare', failed))).error, 'NOT_SUBMITTED');
  assert.deepEqual(f.sends, []);
});

test('cancel and forget invalidate pending work, suppress a later card and discard late results', async () => {
  for (const method of ['cancel', 'forget']) {
    const f = fixture();
    const delayed = deferred();
    f.behavior.text = () => delayed.promise;
    const request = f.draft({ vcards: [{ id: ids.contact, name: 'Synthetic contact' }] });
    await prepare(f, request);
    const sending = f.start('dispatch', { attemptId: request.attemptId });
    await f.flush();
    assert.equal(f.sends.length, 1);
    f.bridge[method](f.generation, sending.id);
    assert.equal(f.read(sending.id), null);
    delayed.resolve(receipt());
    await f.flush();
    assert.equal(f.read(sending.id), null);
    assert.deepEqual(f.sends.map(({ kind }) => kind), ['text']);
    assert.equal((await result(f, f.start('prepare', request))).error, 'NOT_SUBMITTED');
  }
});

test('expired mailbox requests cannot continue a multi-part send or publish late success', async () => {
  const f = fixture();
  const delayed = deferred();
  f.behavior.text = () => delayed.promise;
  const request = f.draft({ vcards: [{ id: ids.contact, name: 'Synthetic contact' }] });
  await prepare(f, request);
  const sending = f.start('dispatch', { attemptId: request.attemptId }, { timeoutMs: 1000 });
  await f.flush();
  f.clock.wall -= 86400000;
  await f.advance(1000);
  assert.equal(f.read(sending.id), null);
  delayed.resolve(receipt());
  await f.flush();
  assert.equal(f.read(sending.id), null);
  assert.deepEqual(f.sends.map(({ kind }) => kind), ['text']);
});

test('wall-clock changes do not expire requests and cancellation is generation scoped', async () => {
  const f = fixture();
  const delayed = deferred();
  f.behavior.text = () => delayed.promise;
  const request = f.draft();
  await prepare(f, request);
  const sending = f.start('dispatch', { attemptId: request.attemptId }, { timeoutMs: 1000 });
  await f.flush();
  f.clock.wall += 86400000;
  f.bridge.cancel(uuid(2), sending.id);
  assert.equal(f.read(sending.id).pending, true);
  delayed.resolve(receipt());
  assert.equal((await result(f, sending)).value.status, 'confirmed');
});

test('cancellation before asynchronous entry prevents mutation and canceled preparations cannot return late', async () => {
  const f = fixture();
  const request = f.draft();
  await prepare(f, request);
  const sending = f.start('dispatch', { attemptId: request.attemptId });
  f.bridge.cancel(f.generation, sending.id);
  await f.flush();
  assert.equal(f.read(sending.id), null);
  assert.deepEqual(f.sends, []);
  const delayed = deferred();
  f.behavior.participants = () => delayed.promise;
  const preparing = f.draft({ targetId: ids.group, tagAll: true });
  const pending = f.start('prepare', preparing);
  await f.flush();
  f.bridge.cancel(f.generation, pending.id);
  delayed.resolve([{ id: wid(ids.contact) }]);
  await f.flush();
  assert.equal(f.read(pending.id), null);
  assert.deepEqual(await dispatch(f, preparing), { status: 'notSubmitted', code: 'NOT_SUBMITTED' });
  assert.equal((await result(f, f.start('prepare', preparing))).error, 'NOT_SUBMITTED');
  assert.deepEqual(f.sends, []);
});

test('mailbox capacity is bounded and a discarded slot can serve a new request', async () => {
  const f = fixture();
  const delayed = deferred();
  f.behavior.list = () => delayed.promise;
  const pending = Array.from({ length: 32 }, () => f.start('catalog'));
  assert.ok(pending.every(({ accepted }) => accepted));
  assert.equal(f.start('catalog').accepted, false);
  f.bridge.cancel(f.generation, pending[0].id);
  const replacement = f.start('catalog');
  assert.equal(replacement.accepted, true);
  delayed.resolve([...f.models.values()]);
  await f.flush();
  assert.equal(f.read(pending[0].id), null);
  assert.equal(f.read(replacement.id).value.chats.length, 3);
  assert.deepEqual(f.sends, []);
});

test('document revocation stops later sub-operations and cannot be undone by rebinding', async () => {
  const f = fixture();
  const delayed = deferred();
  f.behavior.text = () => delayed.promise;
  const request = f.draft({ vcards: [{ id: ids.contact, name: 'Synthetic contact' }] });
  await prepare(f, request);
  const sending = f.start('dispatch', { attemptId: request.attemptId });
  await f.flush();
  assert.equal(f.sends.length, 1);
  f.bridge.revoke(f.generation);
  assert.equal(f.bridge.matches(f.generation), false);
  assert.equal(f.bridge.bind(f.generation), false);
  assert.equal(f.bridge.bind(uuid(2)), false);
  assert.equal(f.read(sending.id), null);
  assert.equal(f.start('catalog').accepted, false);
  delayed.resolve(receipt());
  await f.flush();
  assert.equal(f.read(sending.id), null);
  assert.deepEqual(f.sends.map(({ kind }) => kind), ['text']);
});

test('a queued revoke for an old document cannot revoke a newly bound generation', async () => {
  const f = fixture({ generation: uuid(2) });
  const request = f.draft();
  await prepare(f, request);
  f.bridge.revoke(uuid(1));
  assert.equal(f.bridge.matches(f.generation), true);
  assert.equal((await dispatch(f, request)).status, 'confirmed');
  assert.equal(f.sends.length, 1);
});
