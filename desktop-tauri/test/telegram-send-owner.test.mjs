import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { telegramOwnerFixture, generation } from './helpers/telegram-send-owner.mjs';
import { deferred, flush } from './helpers/telegram-send.mjs';

const start = (f, gesture = 'enter') => {
  assert.equal(f[gesture]().defaultPrevented, true);
  const request = f.poll().request;
  assert.ok(request); return request;
};
const prepare = (f, request) => assert.deepEqual(f.prepare(request), { ok: true });

test('actual composed K owner admits only trusted matching gestures and a plain namespaced request', () => {
  const f = telegramOwnerFixture();
  assert.equal(f.enter({ isTrusted: false }).defaultPrevented, false); assert.equal(f.poll().request, null);
  assert.equal(f.enter({ shiftKey: true }).defaultPrevented, false); assert.equal(f.poll().request, null);
  const request = start(f, 'click');
  assert.equal(request.chatId, 'tg:101'); assert.deepEqual(request.context, { kind: 'plain' });
  assert.equal(request.text, 'Please send tomorrow.'); assert.equal(request.attempt, 1);
  assert.equal(f.state.sends.length, 0); assert.equal(f.state.clears.length, 0);
  assert.equal(f.feedback(), '正在翻译…');
});

test('composed touch K intercepts primary mousedown and does not admit its later pointer click twice', async () => {
  const f = telegramOwnerFixture({ touch: true });
  assert.equal(f.mousedown({ button: 2 }).defaultPrevented, true); assert.equal(f.poll().request, null);
  assert.equal(f.mousedown().defaultPrevented, true);
  const request = f.poll().request; assert.ok(request);
  assert.equal(f.click().defaultPrevented, false); assert.deepEqual(f.poll().request, request);
  prepare(f, request); const result = await f.settle(request, f.commit(request));
  assert.equal(result.status, 'confirmed'); assert.equal(f.state.sends.length, 1);
});

test('actual composeSend commits once, keeps the heartbeat until settlement and clears only after exact ACK', async () => {
  const f = telegramOwnerFixture(); f.state.mode = 'never';
  const request = start(f); prepare(f, request); const flight = f.commit(request);
  assert.equal(flight.accepted, true);
  assert.equal(f.commit(request, flight.permit).accepted, false);
  assert.equal(f.commit(request).accepted, false);
  await f.until(() => f.state.sends.length === 1);
  assert.equal(f.state.sends[0].params.message, 'Invia domani.');
  assert.equal(f.editor.innerText, request.text); assert.equal(f.state.clears.length, 0);
  assert.equal(f.read(request, flight.permit).pending, true);
  assert.equal(f.read(request, flight.permit).precommit, undefined);
  assert.deepEqual(f.poll().request, request);
  f.emitFinal(f.state.stages[0].message);
  const result = await f.settle(request, flight);
  assert.deepEqual(result, { status: 'confirmed', receipt: 'tg:101:700', draftCleared: true });
  assert.equal(f.read(request, flight.permit).precommit, undefined);
  assert.equal(f.editor.innerText, ''); assert.equal(f.state.clears.length, 1);
  assert.deepEqual(f.poll().request, request);
  assert.equal(f.deliver(request, { ...result, retryable: false }), true);
  assert.equal(f.poll().request, null); assert.equal(f.feedback(), '已发送');
  await f.input(request.text);
  assert.notEqual(start(f).id, request.id);
  assert.equal(f.state.sends.length, 1);
});

test('trusted zero-submit preflight failure retains the paid-facing UUID and frozen output across a human retry', async () => {
  const f = telegramOwnerFixture(); const first = start(f); prepare(f, first); f.state.allowed = false;
  const flight = f.commit(first); const failed = await f.settle(first, flight);
  assert.deepEqual(failed, { status: 'notSubmitted', code: 'SEND_INTENT_UNSUPPORTED' });
  assert.deepEqual(f.read(first, flight.permit).precommit, { kind: 'telegramK', generation,
    id: first.id, attempt: first.attempt, permit: flight.permit });
  assert.equal(f.read(first, randomUUID()).precommit, undefined);
  assert.equal(f.api.read(randomUUID(), first.id, first.attempt, flight.permit).precommit, undefined);
  assert.equal(f.state.sends.length, 0); assert.equal(f.state.stages.length, 0);
  assert.deepEqual(f.poll().request, first); // Native still owns settlement.
  f.enter(); assert.deepEqual(f.poll().request, first);
  assert.equal(f.deliver(first, { ...failed, retryable: true }), true);
  const retry = start(f, 'click');
  assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2); assert.equal(retry.text, first.text);
  assert.equal(f.commit(first).accepted, false);
  f.state.allowed = true;
  // Native supplies its already-paid output to the same UUID; this guest test
  // proves the stable handoff, not an alternative JS billing/cache owner.
  prepare(f, retry);
  const success = await f.settle(retry, f.commit(retry));
  assert.equal(success.status, 'confirmed'); assert.equal(f.state.sends.length, 1);
  assert.equal(f.state.sends[0].params.message, 'Invia domani.');
});

test('unknown post-invocation failures stay uncertain and no later gesture or notSubmitted delivery unlocks them', async () => {
  for (const mode of ['throw', 'void', 'error']) {
    const f = telegramOwnerFixture(); f.state.apiThrow = mode === 'throw'; f.state.mode = mode;
    const request = start(f); prepare(f, request); const flight = f.commit(request);
    const result = await f.settle(request, flight);
    assert.equal(result.status, 'uncertain', mode);
    assert.equal(f.read(request, flight.permit).precommit, undefined);
    assert.equal(f.state.sends.length, 1); assert.equal(f.editor.innerText, request.text);
    f.deliver(request, { status: 'notSubmitted', code: 'NETWORK_UNAVAILABLE', retryable: true });
    f.enter(); f.click(); assert.equal(f.poll().request, null);
    assert.equal(f.state.sends.length, 1); assert.equal(f.state.clears.length, 0);
    assert.match(f.feedback(), /不会自动重发/);
  }
});

test('a proven zero-submit result can settle after an appearance revision without blocking the next attempt', async () => {
  const f = telegramOwnerFixture(); const first = start(f); prepare(f, first); f.state.allowed = false;
  const failed = await f.settle(first, f.commit(first));
  assert.equal(failed.status, 'notSubmitted'); assert.equal(f.state.sends.length, 0);
  f.configuration.settings.revision += 1; f.configuration.settings.global.fontSize += 1; f.configure();
  assert.deepEqual(f.poll().request, first);
  assert.equal(f.deliver(first, { ...failed, retryable: true }), true);
  assert.equal(f.poll().request, null);
  const retry = start(f); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
  assert.equal(retry.policyRevision, 2); f.state.allowed = true; prepare(f, retry);
  assert.equal((await f.settle(retry, f.commit(retry))).status, 'confirmed');
  assert.equal(f.state.sends.length, 1);
});

test('input edits before commit and account A to B to A cancel the old composed ticket without submission', async () => {
  for (const mutate of [
    async (f) => { await f.input('Changed source'); },
    async (f) => { f.switchAccount(2, 91); f.switchAccount(1, 90); await flush(); },
  ]) {
    const f = telegramOwnerFixture(); const request = start(f); prepare(f, request);
    await mutate(f);
    assert.equal(f.commit(request).accepted, false); assert.equal(f.poll().request, null);
    assert.equal(f.state.sends.length, 0); assert.equal(f.state.clears.length, 0);
  }
});

test('changed draft or hidden guest during an in-flight K API call cannot clear or reopen a late result', async () => {
  for (const mutate of [
    async (f) => { await f.input('My next draft'); },
    async (f) => { f.api.deactivate(generation); },
    async (f) => { f.switchAccount(); },
  ]) {
    const f = telegramOwnerFixture(); f.state.apiGate = deferred();
    const request = start(f); prepare(f, request); const flight = f.commit(request);
    await f.until(() => f.state.sends.length === 1);
    await mutate(f); await f.advance(50);
    const outcome = await f.settle(request, flight);
    assert.equal(outcome.status, 'uncertain'); const draft = f.editor.innerText;
    f.state.apiGate.resolve({ _: 'updateShortSentMessage', id: 900, date: 5, pFlags: { out: true }, pts: 1, pts_count: 1 });
    await f.advance();
    assert.equal(f.read(request, flight.permit).value.status, 'uncertain');
    assert.equal(f.editor.innerText, draft); assert.equal(f.state.clears.length, 0);
    assert.equal(f.state.sends.length, 1);
    assert.ok(f.state.updates.every((value) => value.account === 1));
  }
});

test('identity exclusion uses the same composed owner without requiring translated text or a subscription generation', async () => {
  const f = telegramOwnerFixture({ policy: { includeZh: false }, text: '你好，请明天发送。', session: null });
  const request = start(f); assert.equal(f.feedback(), '正在发送…');
  assert.deepEqual(f.prepare(request, request.text, false), { ok: true });
  const result = await f.settle(request, f.commit(request));
  assert.equal(result.status, 'confirmed'); assert.equal(f.state.sends[0].params.message, request.text);
});

test('actual compose bridge exposes K text catalog and consumes exactly one prepared attempt', async () => {
  const f = telegramOwnerFixture();
  const catalog = await f.settleBridge(f.startBridge('catalog'));
  assert.deepEqual(catalog.value.chats.map(({ id }) => id), ['tg:101', 'tg:-202']);
  assert.equal(catalog.value.capabilities.text, true); assert.equal(catalog.value.capabilities.attachments, true);
  assert.equal(catalog.value.labels, null);
  const draft = f.broadcastDraft({ targetId: 'tg:-202' });
  assert.deepEqual((await f.settleBridge(f.startBridge('prepare', draft))).value, { prepared: true });
  const call = f.startBridge('dispatch', { attemptId: draft.attemptId });
  assert.equal(f.bridge.begin(call.request), true); // Same mailbox request is idempotent.
  assert.deepEqual((await f.settleBridge(call)).value, { status: 'confirmed', receipt: 'tg:-202:700' });
  const replay = await f.settleBridge(f.startBridge('dispatch', { attemptId: draft.attemptId }));
  assert.equal(replay.value.status, 'notSubmitted');
  assert.equal((await f.settleBridge(f.startBridge('prepare', draft))).error, 'NOT_SUBMITTED');
  assert.equal(f.state.sends.length, 1); assert.equal(f.editor.innerText, 'Please send tomorrow.');
  assert.equal(f.state.clears.length, 0);
});

test('K catalog cannot be rebound to another Telegram account before its first prepare', async () => {
  const f = telegramOwnerFixture();
  await f.settleBridge(f.startBridge('catalog'));
  f.switchAccount(2, 91);
  const result = await f.settleBridge(f.startBridge('prepare', f.broadcastDraft()));
  assert.equal(result.error, 'ACCOUNT_UNAVAILABLE');
  assert.equal(f.state.sends.length, 0); assert.equal(f.state.stages.length, 0);
  f.switchAccount(1, 90);
  assert.equal((await f.settleBridge(f.startBridge('catalog'))).error, 'ACCOUNT_UNAVAILABLE');
});

test('a ready bridge binds identity before catalog and account A to B to A never revives it', async () => {
  const f = telegramOwnerFixture();
  assert.equal((await f.settleBridge(f.startBridge('ready'))).value, true);
  f.switchAccount(2, 91);
  assert.equal((await f.settleBridge(f.startBridge('catalog'))).error, 'ACCOUNT_UNAVAILABLE');
  f.switchAccount(1, 90);
  assert.equal((await f.settleBridge(f.startBridge('ready'))).error, 'ACCOUNT_UNAVAILABLE');
  assert.equal((await f.settleBridge(f.startBridge('prepare', f.broadcastDraft()))).error, 'ACCOUNT_UNAVAILABLE');
  assert.equal(f.state.sends.length, 0);
});

test('cancelled bridge preparation cannot insert a late ticket or reuse the reserved attempt', async () => {
  const f = telegramOwnerFixture(); f.state.configGate = deferred();
  const draft = f.broadcastDraft(); const call = f.startBridge('prepare', draft);
  await flush(); f.bridge.cancel(generation, call.id);
  f.state.configGate.resolve(); await f.advance();
  assert.equal(f.bridgeResult(call), null);
  assert.equal((await f.settleBridge(f.startBridge('dispatch', { attemptId: draft.attemptId }))).value.status, 'notSubmitted');
  assert.equal((await f.settleBridge(f.startBridge('prepare', draft))).error, 'NOT_SUBMITTED');
  assert.equal(f.state.sends.length, 0);
});

test('bridge post-submission cancellation drops the mailbox and cannot issue a fresh API or replay a late ACK', async () => {
  const f = telegramOwnerFixture(); f.state.mode = 'never'; const draft = f.broadcastDraft();
  await f.settleBridge(f.startBridge('prepare', draft));
  const call = f.startBridge('dispatch', { attemptId: draft.attemptId });
  await f.until(() => f.state.sends.length === 1);
  f.bridge.cancel(generation, call.id); await f.advance();
  f.emitFinal(f.state.stages[0].message); await f.advance();
  assert.equal(f.bridgeResult(call), null);
  assert.equal((await f.settleBridge(f.startBridge('dispatch', { attemptId: draft.attemptId }))).value.status, 'notSubmitted');
  assert.equal(f.state.sends.length, 1); assert.equal(f.root.count('message_sent'), 0);
});

test('bridge unknown invocation errors report uncertain while unbound or foreign generation calls are rejected', async () => {
  const f = telegramOwnerFixture(); f.state.apiThrow = true;
  assert.equal(f.startBridge('catalog', {}, { generation: randomUUID() }).accepted, false);
  const draft = f.broadcastDraft(); await f.settleBridge(f.startBridge('prepare', draft));
  const result = await f.settleBridge(f.startBridge('dispatch', { attemptId: draft.attemptId }));
  assert.equal(result.value.status, 'uncertain'); assert.equal(f.state.sends.length, 1);
});

test('bridge dispatch never trusts a foreign error claiming submitted false', async () => {
  const f = telegramOwnerFixture(); const draft = f.broadcastDraft();
  await f.settleBridge(f.startBridge('prepare', draft));
  f.proxy.getPeer = () => { throw Object.assign(new Error('Synthetic provider error'), { submitted: false, code: 'NOT_SUBMITTED' }); };
  const result = await f.settleBridge(f.startBridge('dispatch', { attemptId: draft.attemptId }));
  assert.equal(result.value.status, 'uncertain'); assert.equal(f.state.sends.length, 0);
  assert.equal((await f.settleBridge(f.startBridge('dispatch', { attemptId: draft.attemptId }))).value.status, 'notSubmitted');
});
