import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID, webcrypto } from 'node:crypto';
import { captionBatchFixture, settle } from './helpers/whatsapp-caption.mjs';
import { deferred, generation, tick } from './helpers/send-guest.mjs';

const output = 'Invia 100 unità domani.';
const start = (c) => {
  assert.equal(c.click().defaultPrevented, true);
  const request = c.ui.poll().request; assert.ok(request, c.ui.feedback()); return request;
};
const commit = (c, request) => {
  assert.equal(c.ui.prepare(request, output).ok, true);
  const flight = c.ui.commit(request); assert.equal(flight.accepted, true); return flight;
};
async function finish(c) {
  // Drain the finite 10-file promise chain, including actual Node WebCrypto.
  for (let index = 0; index < 12; index += 1) {
    await settle(); await Promise.all(c.state.digests);
  }
}
async function confirm(c, call, { id, ack = 1, caption = call.options.caption } = {}) {
  const data = await call.prep.waitForPrep();
  const key = new c.W.whatsapp.MsgKey(id || `true_${call.chat.id}_TEST${c.state.calls.indexOf(call) + 1}`);
  call.options.onMsgKeyCreated(key);
  const msg = new c.W.whatsapp.MsgModel(key, '', '');
  Object.assign(msg, { type: data.type, caption, filehash: data.filehash, size: data.size, ack });
  return { messageSendResult: 'OK', msg };
}

test('the real owner sends a frozen ordered image batch and translates only the selected caption', async () => {
  const c = await captionBatchFixture({ types: ['image', 'image', 'image'], selected: 1 });
  const request = start(c); const flight = commit(c, request);
  assert.equal(c.state.calls.length, 1); assert.equal(c.ui.read(request, flight.permit).pending, true);
  await finish(c);
  const messageIds = c.members.map((_member, index) => `true_${request.chatId}_CAPTION${index + 1}`);
  const digest = createHash('sha256').update(JSON.stringify({ attachmentId: request.context.attachmentId,
    chatId: request.chatId, messageIds })).digest('hex');
  assert.deepEqual(c.ui.read(request, flight.permit).value,
    { status: 'confirmed', receipt: `wa-batch:3:${digest}`, draftCleared: false });
  assert.deepEqual(c.state.calls.map((call) => call.options.caption), ['', output, '']);
  c.members.forEach((member, index) => {
    const call = c.state.calls[index];
    assert.strictEqual(call.chat, c.chat); assert.notStrictEqual(call.prep, member.prep);
    assert.notStrictEqual(call.prep.mediaData, member.data); assert.strictEqual(call.prep.mediaData.mediaBlob, member.blob);
    assert.equal(call.prep.mediaData.filehash, member.data.filehash);
    assert.strictEqual(member.media.mediaPrep, member.prep); assert.strictEqual(member.media.file, member.holder);
    assert.equal(member.media.caption, index === 1 ? request.text : '');
  });
  assert.equal(c.drawer.isConnected, true); assert.equal(c.editor.innerText, request.text);
  assert.equal(c.ui.state.cleared.length, 0); assert.equal(c.ui.state.sent.length, 0);
  assert.deepEqual(Object.keys(request.context).sort(), ['attachmentId', 'kind']);
  for (const member of c.members) assert.equal(JSON.stringify(request).includes(member.data.filehash), false);
  c.ui.deliver(request, { ...c.ui.read(request, flight.permit).value, retryable: false });
  c.click(); assert.equal(c.ui.poll().request, null); assert.equal(c.state.calls.length, 3);
});

test('a selected ordinary video may carry the only caption among image attachments', async () => {
  const c = await captionBatchFixture({ types: ['image', 'video', 'image'], selected: 1 });
  const request = start(c); const flight = commit(c, request); await finish(c);
  assert.equal(c.ui.read(request, flight.permit).value.status, 'confirmed');
  assert.deepEqual(c.state.calls.map((call) => call.options.type), ['image', 'video', 'image']);
  assert.deepEqual(c.state.calls.map((call) => call.options.caption), ['', output, '']);
  assert.equal(c.preview.src, c.media.fullPreview);
});

test('no batch success is visible until every real message ACK has been verified', async () => {
  const c = await captionBatchFixture(); const second = deferred(); let last;
  c.state.transport = (call) => {
    if (c.state.calls.length === 1) return confirm(c, call, { ack: 3 });
    last = call; return second.promise;
  };
  const request = start(c); const flight = commit(c, request); await settle();
  assert.equal(c.state.calls.length, 2); assert.deepEqual(c.ui.poll().request, request);
  assert.deepEqual(c.ui.read(request, flight.permit), { pending: true });
  second.resolve(await confirm(c, last, { ack: 1 })); await finish(c);
  assert.match(c.ui.read(request, flight.permit).value.receipt, /^wa-batch:2:[a-f\d]{64}$/);
  assert.equal(c.state.digests.length, 1);
});

test('partial failure, wrong ACK and duplicate IDs stop the remaining files and never replay the batch', async () => {
  for (const failure of ['reject', 'ack', 'duplicate', 'caption']) {
    const c = await captionBatchFixture({ types: ['image', 'image', 'image'] });
    c.state.transport = (call) => {
      const index = c.state.calls.length;
      if (index === 2 && failure === 'reject') return Promise.reject(new Error('Synthetic failure after possible invocation'));
      return confirm(c, call, { ...(failure === 'duplicate' ? { id: 'true_100@c.us_DUPLICATE' } : {}),
        ...(index === 2 && failure === 'ack' ? { ack: 0 } : {}),
        ...(index === 2 && failure === 'caption' ? { caption: 'Unexpected extra caption' } : {}) });
    };
    const request = start(c); const flight = commit(c, request); await finish(c);
    const outcome = c.ui.read(request, flight.permit).value;
    assert.equal(outcome.status, 'uncertain', failure); assert.equal(c.state.calls.length, 2, failure);
    assert.equal(c.state.digests.length, 0, failure);
    c.ui.deliver(request, { ...outcome, retryable: false }); c.click();
    assert.equal(c.ui.poll().request, null, failure); assert.equal(c.state.calls.length, 2, failure);
    assert.equal(c.editor.innerText, request.text); assert.equal(c.collection.length, 3);
  }
});

test('cancellation, a changed draft or the total deadline during the first ACK stops every later file', async () => {
  for (const change of [
    (c, request) => c.ui.api.cancel(generation, request.id, request.attempt),
    (c) => c.ui.api.deactivate(generation),
    (c) => c.input('A different caption.'),
    (c) => { c.members[1].media.caption = 'Unexpected hidden caption'; },
    (c) => { c.ui.state.now = 50000; },
  ]) {
    const c = await captionBatchFixture(); const first = deferred(); let call;
    c.state.transport = (value) => { call = value; return first.promise; };
    const request = start(c); const flight = commit(c, request);
    await change(c, request); first.resolve(await confirm(c, call)); await finish(c);
    assert.equal(c.ui.read(request, flight.permit).value.status, 'uncertain');
    assert.equal(c.state.calls.length, 1); assert.equal(c.state.digests.length, 0);
    assert.equal(c.drawer.isConnected, true); assert.equal(c.ui.state.cleared.length, 0);
  }
});

test('the final digest is fenced by the same deadline and whole-batch identity', async () => {
  for (const change of [
    (c) => { c.ui.state.now = 50000; },
    (c) => { c.members[1].media.quality = 'HD'; c.members[1].media.quality = 'Standard'; },
  ]) {
    const c = await captionBatchFixture(); const gate = deferred(); let digest;
    c.state.digest = (algorithm, bytes) => { digest = webcrypto.subtle.digest(algorithm, bytes); return gate.promise; };
    const request = start(c); const flight = commit(c, request); await settle();
    assert.equal(c.state.calls.length, 2); assert.equal(c.state.digests.length, 1);
    assert.deepEqual(c.ui.read(request, flight.permit), { pending: true });
    change(c); gate.resolve(await digest); await finish(c);
    assert.equal(c.ui.read(request, flight.permit).value.status, 'uncertain'); assert.equal(c.state.calls.length, 2);
  }
});

test('all members are immutable private payloads and a changed later source cannot be submitted', async () => {
  const c = await captionBatchFixture(); c.members[1].data.field('sidecar', new Uint8Array([1, 2, 3]));
  const request = start(c); c.ui.prepare(request, output);
  const original = c.members[0].data.filehash;
  c.state.mutateAfterAwait = () => {
    c.members[0].data.filehash = 'C'.repeat(43) + '=';
    c.members[1].data.sidecar[0] = 99;
  };
  const flight = c.ui.commit(request); await finish(c);
  assert.equal(c.state.calls.length, 1); assert.equal(c.state.calls[0].prep.mediaData.filehash, original);
  assert.strictEqual(c.state.calls[0].prep.mediaData.mediaBlob, c.members[0].blob);
  assert.equal(c.ui.read(request, flight.permit).value.status, 'uncertain');
});

test('unselected model, collection and filmstrip A-to-B-to-A changes invalidate the attempt', async () => {
  const changes = [
    (c) => { c.members[1].media.caption = 'temporary'; c.members[1].media.caption = ''; },
    (c) => { const hash = c.members[1].data.filehash; c.members[1].data.filehash = 'B'.repeat(43) + '='; c.members[1].data.filehash = hash; },
    (c) => { c.ui.document.fire('dragstart', { target: c.tabs[1] });
      [c.collection.models[1], c.collection.models[2]] = [c.collection.models[2], c.collection.models[1]];
      [c.collection.models[1], c.collection.models[2]] = [c.collection.models[2], c.collection.models[1]]; },
    (c) => { c.ui.document.fire('keydown', { key: ' ', target: c.tabs[1] });
      [c.collection.models[1], c.collection.models[2]] = [c.collection.models[2], c.collection.models[1]];
      [c.collection.models[1], c.collection.models[2]] = [c.collection.models[2], c.collection.models[1]]; },
    (c) => { c.tabs[1].setAttribute('aria-posinset', '1'); c.tabs[1].setAttribute('aria-posinset', '2'); },
    (c) => { c.thumbs[1].setAttribute('src', `blob:https://web.whatsapp.com/${randomUUID()}`);
      c.thumbs[1].setAttribute('src', c.members[1].previewUrl); },
  ];
  for (const change of changes) {
    const c = await captionBatchFixture({ types: ['image', 'image', 'image'] });
    const request = start(c); c.ui.prepare(request, output);
    change(c); await tick(); assert.equal(c.ui.commit(request).accepted, false); assert.equal(c.state.calls.length, 0);
    const retry = start(c); assert.equal(retry.id, request.id); assert.equal(retry.attempt, 2);
    assert.deepEqual(retry.context, request.context); assert.ok(retry.composerRevision > request.composerRevision);
  }
});

test('unsupported batch content and ambiguous list-to-preview mappings fail before admission', async () => {
  const cases = [
    ['hidden second caption', (c) => { c.members[1].media.caption = 'Another caption'; }],
    ['whitespace caption', (c) => { c.members[1].media.caption = ' '; }],
    ['model order differs', (c) => c.collection.models.reverse()],
    ['missing tab', (c) => c.tabs[1].remove()],
    ['two selected tabs', (c) => c.tabs[1].setAttribute('aria-selected', 'true')],
    ['wrong position', (c) => c.tabs[1].setAttribute('aria-posinset', '1')],
    ['wrong total', (c) => c.tabs[1].setAttribute('aria-setsize', '3')],
    ['stale thumbnail', (c) => c.thumbs[1].setAttribute('src', c.members[0].previewUrl)],
    ['unloaded thumbnail', (c) => { c.thumbs[1].complete = false; }],
    ['duplicate source', (c) => { c.members[1].media.preview = c.members[0].previewUrl;
      c.members[1].media.fullPreview = c.members[0].previewUrl; c.thumbs[1].src = c.members[0].previewUrl;
      c.thumbs[1].setAttribute('src', c.members[0].previewUrl); }],
    ['changed selection list', (c) => Object.defineProperty(c.collection.selection, 'list', { value: [c.media] })],
    ['unprepared later item', (c) => { c.members[1].media.state = 'processing'; }],
    ['shared metadata', (c) => c.members[1].data.field('sidecar', new Uint8Array(new SharedArrayBuffer(8)))],
    ['oversized metadata', (c) => c.members[1].data.field('preview', 'a'.repeat(524289))],
  ];
  for (const [label, change] of cases) {
    const c = await captionBatchFixture(); change(c); await tick();
    assert.equal(c.click().defaultPrevented, true, label); assert.equal(c.ui.poll().request, null, label);
    assert.equal(c.state.calls.length, 0, label);
  }
  for (const types of [['image', 'video'], ['video', 'video'], ['image', 'document']]) {
    const c = await captionBatchFixture({ types }); c.click();
    assert.equal(c.ui.poll().request, null); assert.equal(c.state.calls.length, 0);
  }
});

test('item-count and aggregate payload limits are checked before a paid intent can start', async () => {
  const accepted = await captionBatchFixture({ types: Array(10).fill('image') });
  const request = start(accepted); const flight = commit(accepted, request); await finish(accepted);
  assert.equal(accepted.state.calls.length, 10); assert.match(accepted.ui.read(request, flight.permit).value.receipt, /^wa-batch:10:/);
  const tooMany = await captionBatchFixture({ types: Array(11).fill('image') }); tooMany.click();
  assert.equal(tooMany.ui.poll().request, null); assert.equal(tooMany.state.calls.length, 0);
  const tooLarge = await captionBatchFixture({ types: ['image', 'image', 'image'] });
  for (const member of tooLarge.members) {
    // The port fixture supplies large-file metadata without allocating 1.5 GiB.
    Object.defineProperty(member.blob, 'size', { value: 512 * 1024 * 1024 }); member.data.size = member.blob.size;
  }
  tooLarge.click(); assert.equal(tooLarge.ui.poll().request, null); assert.equal(tooLarge.state.calls.length, 0);
});

test('a precommit failure reuses the same batch billing identity on an explicit retry', async () => {
  const c = await captionBatchFixture(); const first = start(c); c.ui.prepare(first, output);
  c.ui.deliver(first, { status: 'notSubmitted', code: 'NETWORK_UNAVAILABLE', retryable: true });
  const retry = start(c); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
  assert.deepEqual(retry.context, first.context); assert.equal(c.ui.commit(first).accepted, false);
  const flight = commit(c, retry); await finish(c);
  assert.equal(c.ui.read(retry, flight.permit).value.status, 'confirmed'); assert.equal(c.state.calls.length, 2);
});

test('closing the drawer drops subscriptions to every retained batch model', async () => {
  const c = await captionBatchFixture(); const request = start(c); c.ui.prepare(request, output);
  c.chat.attachMediaContents = null; c.drawer.hidden = true; c.editor.hidden = true;
  assert.equal(c.ui.poll().request, null); assert.equal(c.ui.commit(request).accepted, false);
  for (const member of c.members) {
    assert.equal(member.media.handlers.get('change:caption')?.size, 0);
    assert.equal(member.data.handlers.get('change:filehash')?.size, 0);
  }
  assert.equal(c.collection.selection.handlers.get('all')?.size, 0);
});
