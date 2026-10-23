import assert from 'node:assert/strict';
import test from 'node:test';
import { guest, generation, tick, deferred } from './helpers/send-guest.mjs';
import { mentionsFixture, mentionId, lidId, marker } from './helpers/whatsapp-mentions.mjs';

const copy = (value) => JSON.parse(JSON.stringify(value));
const start = (ui) => { ui.enter(); const request = ui.poll().request; assert.ok(request); return request; };
const fixture = async (options) => { const value = mentionsFixture(options); await tick(); return value; };
const failure = { status: 'notSubmitted', code: 'NETWORK_UNAVAILABLE', retryable: true };
const output = (request) => `Tradotto: ${request.text}`;

test('actual composed send preserves PN/LID entities, UTF16 offsets, duplicate names and repeated contacts', async () => {
  const parts = ['  😀 Hello ', { id: mentionId, name: 'Alice' }, ' and ', { id: lidId, name: 'Alice' },
    ', again ', { id: mentionId, name: 'Alice' }, '.  '];
  const f = await fixture({ parts }); const { ui } = f; const request = start(ui);
  const expected = '😀 Hello @15550001111 and @987650001111, again @15550001111.';
  assert.equal(request.text, expected);
  assert.deepEqual(request.context, { kind: 'mentions', mentions: [
    { id: mentionId, offset: expected.indexOf('@155'), length: 12 },
    { id: lidId, offset: expected.indexOf('@987'), length: 13 },
    { id: mentionId, offset: expected.lastIndexOf('@155'), length: 12 },
  ] });
  assert.equal(JSON.stringify(request).includes('Alice'), false);
  assert.equal(JSON.stringify(request).includes('\\u200b'), false);
  assert.deepEqual(ui.prepare(request, output(request)), { ok: true });
  const flight = ui.commit(request); assert.equal(flight.accepted, true); await tick();
  assert.deepEqual(copy(ui.state.sent), [[request.chatId, output(request), {
    waitForAck: true, detectMentioned: false, linkPreview: false, mentionedList: [mentionId, lidId],
  }]]);
  const outcome = ui.read(request, flight.permit).value;
  assert.deepEqual(outcome, { status: 'confirmed', receipt: 'receipt-1', draftCleared: false });
  assert.equal(f.chat.getComposeContents().text, f.ui.state.text);
  assert.equal(ui.state.cleared.length, 0); assert.ok(f.elements.every((node) => node.isConnected));
  ui.deliver(request, { ...outcome, retryable: false }); ui.enter(); ui.click();
  assert.equal(ui.poll().request, null); assert.equal(ui.state.sent.length, 1);
});

test('identity exclusion needs no subscription and sends the same canonical entities without transformation', async () => {
  const f = await fixture({ parts: ['你好 ', { id: mentionId, name: 'Alice' }], policy: { includeZh: false }, session: null });
  const request = start(f.ui);
  assert.equal(request.text, '你好 @15550001111');
  assert.deepEqual(f.ui.prepare(request, request.text, false, null), { ok: true });
  const flight = f.ui.commit(request); await tick();
  assert.equal(f.ui.read(request, flight.permit).value.status, 'confirmed');
  assert.equal(f.ui.state.sent[0][1], request.text);
  assert.deepEqual(copy(f.ui.state.sent[0][2].mentionedList), [mentionId]);
});

test('Lexical paragraph, placeholder and line-break projection matches the persisted draft exactly', async () => {
  const f = await fixture({ parts: ['First ', { id: mentionId, name: 'Alice' }] });
  const empty = f.ui.document.createElement('p'); empty.append(f.ui.document.createElement('br'));
  const second = f.ui.document.createElement('p'); second.append('Second', f.ui.document.createElement('br'), 'line.');
  f.ui.editor.append(empty, second);
  f.chat.draftMessage = { text: `First ${marker(mentionId)}\n\nSecond\nline.`, timestamp: 1 };
  await tick();
  const request = start(f.ui);
  assert.equal(request.text, 'First @15550001111\n\nSecond\nline.');
  assert.deepEqual(request.context.mentions, [{ id: mentionId, offset: 6, length: 12 }]);
  assert.deepEqual(f.ui.prepare(request, output(request)), { ok: true });
  const flight = f.ui.commit(request); await tick();
  assert.equal(f.ui.read(request, flight.permit).value.status, 'confirmed');
  assert.equal(f.ui.state.cleared.length, 0);
});

test('ordinary text remains ordinary; an unrendered parsable UID never becomes a plain-text send', async () => {
  const f = await fixture(); f.setParts(['No mentions here.']); await tick();
  assert.equal(f.read(), null); assert.deepEqual(start(f.ui).context, { kind: 'plain' });
  const missing = await fixture(); missing.elements[0].remove(); await tick(); missing.ui.enter();
  assert.equal(missing.ui.poll().request, null); assert.equal(missing.ui.state.sent.length, 0);
  const ordinary = guest(); const request = start(ordinary);
  assert.deepEqual(request.context, { kind: 'plain' });
});

test('loaded real contact/member/self evidence is mandatory and failure leaves the draft intact', async () => {
  const cases = [
    ['not a group', (f) => { f.chat.isGroup = false; }],
    ['community', (f) => { f.metadata.isParentGroup = true; }],
    ['not sendable', (f) => { f.chat.canSend = false; }],
    ['missing metadata class', (f) => { delete f.W.whatsapp.GroupMetadataModel; }],
    ['fake metadata', (f) => { f.chat.groupMetadata = { ...f.metadata }; }],
    ['metadata for other group', (f) => { f.metadata.id = new f.W.whatsapp.Wid('120363002@g.us'); }],
    ['unloaded contact', (f) => f.contacts.remove(mentionId)],
    ['unloaded member', (f) => f.participants.remove(mentionId)],
    ['fake contact', (f) => { f.contacts.models.set(mentionId, { ...f.contacts.get(mentionId) }); }],
    ['fake member', (f) => { f.participants.models.set(mentionId, { ...f.participants.get(mentionId) }); }],
    ['contact id mismatch', (f) => { f.contacts.get(mentionId).id = new f.W.whatsapp.Wid('123@c.us'); }],
    ['member id mismatch', (f) => { f.participants.get(mentionId).id = new f.W.whatsapp.Wid('123@c.us'); }],
    ['missing self namespace', (f) => { f.self.pn = null; }],
    ['mentioning self', (f) => { f.self.pn = new f.W.whatsapp.Wid(mentionId); }],
    ['unknown display name', (f) => { f.elements[0].textContent = '@Different person'; }],
    ['raw UID mismatch', (f) => { f.chat.draftMessage = { text: f.ui.state.text.replace(mentionId, lidId), timestamp: 1 }; }],
    ['raw whitespace mismatch', (f) => { f.chat.draftMessage = { text: `${f.ui.state.text} `, timestamp: 1 }; }],
    ['unknown raw context', (f) => { f.chat.draftMessage = { ...f.chat.draftMessage, editMessage: true }; }],
    ['fake Wid', (f) => { f.contacts.get(mentionId).id = { _serialized: mentionId }; }],
  ];
  for (const [label, mutate] of cases) {
    const f = await fixture(); mutate(f); await tick(); const raw = f.chat.getComposeContents().text;
    f.ui.enter(); assert.equal(f.ui.poll().request, null, label);
    assert.equal(f.ui.state.sent.length, 0, label); assert.equal(f.ui.state.cleared.length, 0, label);
    assert.equal(f.chat.getComposeContents().text, raw, label);
  }
});

test('unknown rich nodes, hidden or malformed markers, mixed quote/attachment and namespace ambiguities are rejected', async () => {
  const cases = [
    ['unknown entity attribute', (f) => f.elements[0].setAttribute('data-unknown', 'value')],
    ['wrong lexical marker', (f) => f.elements[0].setAttribute('data-lexical-text', 'false')],
    ['wrong template', (f) => f.elements[0].setAttribute('data-app-text-template', mentionId)],
    ['hidden entity', (f) => { f.elements[0].hidden = true; }],
    ['formatted entity', (f) => f.elements[0].setAttribute('style', 'font-weight: bold')],
    ['link sibling', (f) => f.ui.editor.append(f.ui.document.createElement('a'))],
    ['image sibling', (f) => f.ui.editor.append(f.ui.document.createElement('img'))],
    ['hidden child under paragraph placeholder', (f) => {
      const paragraph = f.ui.document.createElement('p'), line = f.ui.document.createElement('br');
      line.append(f.ui.document.createElement('img')); paragraph.append(line); f.ui.editor.append(paragraph);
      f.chat.draftMessage = { text: `${f.chat.draftMessage.text}\n`, timestamp: 1 };
    }],
    ['nested entity', (f) => { const span = f.ui.document.createElement('span'); span.textContent = 'Alice'; f.elements[0].append(span); }],
    ['unknown ancestor', (f) => {
      const span = f.ui.document.createElement('span'); span.setAttribute('data-unknown', 'x');
      f.ui.editor.append(span); span.append(f.elements[0]);
    }],
    ['attachment', (f) => { f.chat.attachMediaContents = [{}]; }],
    ['reply', (f) => f.ui.reply()],
    ['extra bare mention', (f) => f.setParts(['@all ', { id: mentionId, name: 'Alice' }])],
    ['bot entity', (f) => f.setParts([{ id: '123@bot', name: 'Bot' }])],
    ['group entity', (f) => f.setParts([{ id: '123@g.us', name: 'A group' }])],
    ['leading zero UID', (f) => f.setParts([{ id: '0123@c.us', name: 'Alice' }])],
    ['ambiguous canonical user', (f) => f.setParts([{ id: '123@c.us', name: 'Alice' }, ' ', { id: '123@lid', name: 'Bob' }])],
  ];
  for (const [label, mutate] of cases) {
    const f = await fixture(); mutate(f); await tick(); f.ui.enter();
    assert.equal(f.ui.poll().request, null, label); assert.equal(f.ui.state.sent.length, 0, label);
    assert.equal(f.ui.state.cleared.length, 0, label);
  }
});

test('proof changes and A-to-B-to-A events fence an attempt but an explicit retry retains its logical paid identity', async () => {
  const changes = [
    ['template', (f) => { const node = f.elements[0]; node.setAttribute('data-app-text-template', marker(lidId));
      node.setAttribute('data-app-text-template', marker(mentionId)); }],
    ['text', (f) => { const node = f.elements[0].childNodes[0]; node.textContent = '@Temporary'; node.textContent = '@Alice'; }],
    ['draft', (f) => { const old = f.chat.draftMessage; f.chat.draftMessage = { text: 'temporary', timestamp: 1 }; f.chat.draftMessage = old; }],
    ['member', (f) => { const old = f.participants.remove(mentionId); f.participants.add(old); }],
    ['contact', (f) => { const contact = f.contacts.get(mentionId); contact.name = 'Temporary'; contact.name = 'Alice'; }],
    ['metadata', (f) => { const old = f.chat.groupMetadata; f.chat.groupMetadata = null; f.chat.groupMetadata = old; }],
    ['session', (f) => { f.ui.state.handlers.get('conn.logout')?.(); }],
  ];
  for (const [label, change] of changes) {
    const f = await fixture(); const first = start(f.ui); f.ui.prepare(first, output(first)); change(f); await tick();
    assert.equal(f.ui.commit(first).accepted, false, label); assert.equal(f.ui.prepare(first, output(first)).ok, false, label);
    assert.equal(f.ui.poll().request, null, label); assert.equal(f.ui.state.sent.length, 0, label);
    const retry = start(f.ui); assert.equal(retry.id, first.id, label); assert.equal(retry.attempt, 2, label);
    assert.ok(retry.composerRevision > first.composerRevision, label);
    assert.deepEqual(f.ui.prepare(retry, output(retry)), { ok: true }, label);
    f.ui.api.revoke(generation);
    assert.equal(f.contacts.get(mentionId).handlers.get('change:name')?.size, 0, label);
    assert.equal(f.participants.handlers.get('remove')?.size, 0, label);
  }
});

test('final synchronous CAS rejects replaced DOM/model or a changed context before any observer turn', async () => {
  const mutations = [
    (f) => {
      const next = f.ui.document.createElement('span');
      for (const attr of f.elements[0].attributes) next.setAttribute(attr.name, attr.value);
      next.textContent = f.elements[0].textContent; f.elements[0].replaceWith(next);
    },
    (f) => f.contacts.models.set(mentionId, new f.W.whatsapp.ContactModel('Alice', new f.W.whatsapp.Wid(mentionId))),
    (f) => f.participants.models.set(mentionId, new f.W.whatsapp.ParticipantModel(new f.W.whatsapp.Wid(mentionId))),
    (f) => { f.self.pn = new f.W.whatsapp.Wid('12220009999@c.us'); },
    (f) => f.elements[0].setAttribute('data-unknown', 'new rich context'),
  ];
  for (const mutate of mutations) {
    const f = await fixture(); const request = start(f.ui); f.ui.prepare(request, output(request)); mutate(f);
    assert.equal(f.ui.commit(request).accepted, false); assert.equal(f.ui.state.sent.length, 0);
  }
});

test('wire context is detached and exact; retries do not change IDs while appearance changes preserve semantics', async () => {
  const f = await fixture(); const first = start(f.ui);
  const exposed = f.ui.api.poll(generation).request; exposed.context.mentions[0].id = lidId;
  exposed.context.mentions.push({ id: lidId, offset: 0, length: 1 });
  assert.deepEqual(f.ui.poll().request, first);
  for (const context of [
    { kind: 'plain' }, { ...first.context, extra: true },
    { kind: 'mentions', mentions: [{ ...first.context.mentions[0], offset: 0 }] },
    { kind: 'mentions', mentions: [{ ...first.context.mentions[0], extra: true }] },
  ]) assert.equal(f.ui.prepare(first, output(first), true, f.ui.configuration.sessionGeneration, context).ok, false);
  f.ui.deliver(first, failure); f.ui.configuration.settings.revision += 1;
  f.ui.configuration.settings.global.fontSize += 1; f.ui.configure();
  const retry = start(f.ui); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
  assert.deepEqual(f.ui.prepare(retry, output(retry)), { ok: true });
});

test('missing ACK, transport rejection and timeout remain uncertain and cannot send the same draft again', async () => {
  for (const outcome of ['no receipt', 'no ack', 'reject', 'timeout']) {
    const f = await fixture(); const pending = deferred(); f.ui.state.transport = () => pending.promise;
    const request = start(f.ui); f.ui.prepare(request, output(request)); const flight = f.ui.commit(request);
    if (outcome === 'reject') pending.reject(new Error('synthetic transport failure'));
    else if (outcome === 'no receipt') pending.resolve({ ack: 1 });
    else if (outcome === 'no ack') pending.resolve({ id: 'local', ack: 0 });
    else { f.ui.state.now = 50001; f.ui.poll(); pending.resolve({ id: 'late', ack: 1 }); }
    await tick(); const result = f.ui.read(request, flight.permit).value;
    assert.equal(result.status, 'uncertain', outcome); assert.equal(f.ui.state.cleared.length, 0, outcome);
    f.ui.deliver(request, { ...result, retryable: false }); f.ui.enter(); f.ui.click();
    assert.equal(f.ui.poll().request, null, outcome); assert.equal(f.ui.state.sent.length, 1, outcome);
  }
});

test('late ACK retains new entities and entity-only changes cannot unlock the already sent canonical text', async () => {
  const f = await fixture(); const pending = deferred(); f.ui.state.transport = () => pending.promise;
  const request = start(f.ui); f.ui.prepare(request, output(request)); const flight = f.ui.commit(request);
  f.contacts.get(mentionId).name = 'Alicia'; f.contacts.get(mentionId).displayName = 'Alicia';
  f.elements[0].textContent = '@Alicia'; await tick();
  pending.resolve({ id: 'ack', ack: 1 }); await tick();
  const result = f.ui.read(request, flight.permit).value;
  assert.equal(result.status, 'confirmed'); assert.equal(result.draftCleared, false);
  assert.equal(f.elements[0].textContent, '@Alicia'); assert.equal(f.ui.state.cleared.length, 0);
  f.ui.deliver(request, { ...result, retryable: false }); f.ui.enter();
  assert.equal(f.ui.poll().request, null); assert.equal(f.ui.state.sent.length, 1);
  f.setParts(['A deliberately new message ', { id: mentionId, name: 'Alicia' }], { trusted: true }); await tick();
  assert.notEqual(start(f.ui).id, request.id);
});

test('32 bounded entities are accepted; excess entities, oversized source and unknown proof cannot allocate a send', async () => {
  const parts = Array.from({ length: 32 }, (_, index) => [{ id: `${1000 + index}@c.us`, name: `Name${index}` }, ' ']).flat();
  const f = await fixture({ parts }); assert.equal(start(f.ui).context.mentions.length, 32);
  for (const rejected of [[...parts, { id: '2000@c.us', name: 'Extra' }], ['x'.repeat(10000), { id: mentionId, name: 'Alice' }],
    ['😀'.repeat(8000), { id: mentionId, name: 'Alice' }]]) {
    const bad = await fixture({ parts: rejected }); bad.ui.enter(); assert.equal(bad.ui.poll().request, null);
  }
  const proof = f.read().proof;
  assert.equal(f.adapter.allowsNode(proof, f.elements[0]), true);
  assert.equal(f.adapter.allowsNode(proof, f.ui.editor), false);
  assert.equal(f.adapter.allowsNode({ ...proof }, f.elements[0]), false);
  assert.throws(() => f.adapter.submitOptions({ ...proof }), /SEND_INTENT_UNSUPPORTED/);
});
