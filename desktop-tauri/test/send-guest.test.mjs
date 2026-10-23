import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { guest, generation, subscription, deferred, tick } from './helpers/send-guest.mjs';

const start = (ui) => { ui.enter(); const request = ui.poll().request; assert.ok(request); return request; };
const networkFailure = { status: 'notSubmitted', code: 'NETWORK_UNAVAILABLE', retryable: true };

test('disabled sending passes through native events and only trusted ordinary submissions create intents', () => {
  const off = guest({ policy: { enabled: false, autoSend: false } });
  assert.equal(off.enter().defaultPrevented, false); assert.equal(off.click().defaultPrevented, false);
  assert.equal(off.poll().request, null); assert.equal(off.state.sent.length, 0);
  const ui = guest();
  for (const values of [{ isTrusted: false }, { shiftKey: true }, { ctrlKey: true }, { altKey: true },
    { metaKey: true }, { isComposing: true }, { key: 'Escape' }]) {
    assert.equal(ui.enter(values).defaultPrevented, false);
    assert.equal(ui.poll().request, null);
  }
  assert.equal(ui.enter({ repeat: true }).defaultPrevented, true); assert.equal(ui.poll().request, null);
  ui.click({ isTrusted: false }); assert.equal(ui.poll().request, null);
  assert.equal(ui.click().defaultPrevented, true); assert.ok(ui.poll().request);
  assert.equal(Object.isFrozen(ui.api), true);
  assert.equal(ui.api.enqueue, undefined); assert.equal(ui.api.retry, undefined);
  assert.equal(guest({ iframe: true }).api, undefined);
});

test('pending repeated Enter/click retains one request and never sends or rewrites the source', () => {
  const ui = guest(); const request = start(ui);
  for (let i = 0; i < 4; i += 1) { ui.enter(); ui.click(); }
  assert.deepEqual(ui.poll().request, request);
  assert.equal(ui.state.sent.length, 0); assert.equal(ui.state.cleared.length, 0);
  assert.equal(ui.editor.innerText, request.text); assert.equal(ui.feedback(), '正在翻译…');
});

test('held Enter is always blocked while pending or uncertain and button padding is owned via its send icon', async () => {
  const ui = guest(); const request = start(ui);
  assert.equal(ui.enter({ repeat: true }).defaultPrevented, true); assert.deepEqual(ui.poll().request, request);
  ui.state.transport = () => ({ id: 'without-ack', ack: 0 }); ui.prepare(request);
  const flight = ui.commit(request); await tick();
  ui.deliver(request, { ...ui.read(request, flight.permit).value, retryable: false });
  assert.equal(ui.enter({ repeat: true }).defaultPrevented, true); assert.equal(ui.poll().request, null);
  assert.equal(ui.state.sent.length, 1);
  const padding = guest(); padding.button.removeAttribute('data-testid');
  assert.equal(padding.click({ target: padding.button }).defaultPrevented, true);
  assert.ok(padding.poll().request); assert.equal(padding.state.sent.length, 0);
  const accessible = guest(); accessible.button.removeAttribute('data-testid'); accessible.icon.remove();
  accessible.button.setAttribute('aria-label', '发送');
  assert.equal(accessible.click({ target: accessible.button }).defaultPrevented, true); assert.ok(accessible.poll().request);
  const outside = guest(); outside.document.body.append(outside.button);
  assert.equal(outside.click().defaultPrevented, true); assert.equal(outside.poll().request, null);
  assert.match(outside.feedback(), /仅支持普通文字/);
});

test('ACK and read preserve the old heartbeat until native delivery even when a new draft is submitted', async () => {
  const ui = guest(); const first = start(ui); ui.prepare(first); const flight = ui.commit(first); await tick();
  const outcome = ui.read(first, flight.permit).value; assert.equal(outcome.status, 'confirmed');
  await ui.input('A new draft before native settlement.'); ui.enter();
  assert.deepEqual(ui.poll().request, first); assert.equal(ui.state.sent.length, 1);
  assert.equal(ui.feedback(), '正在确认上一条消息…');
  ui.deliver(first, { ...outcome, retryable: false });
  const next = start(ui); assert.notEqual(next.id, first.id); assert.equal(next.text, 'A new draft before native settlement.');
});

test('plain text requires both a safe model and matching positive DOM context before any request', async () => {
  const cases = [
    (ui) => { ui.model(ui.state.chatId).composeQuotedMsg = { id: 'reply' }; },
    (ui) => { ui.model(ui.state.chatId).attachMediaContents = [{ type: 'image' }]; },
    (ui) => { delete ui.model(ui.state.chatId).quotedMsgAdminGroupJid; },
    (ui) => { ui.model(ui.state.chatId).getComposeContents = () => ({ text: ui.state.text, edit: true }); },
    (ui) => { ui.model(ui.state.chatId).getComposeContents = () => ({ text: 'different draft' }); },
    (ui) => { ui.model(ui.state.chatId).canSend = false; },
    (ui) => { ui.model(ui.state.chatId).isGroup = true; },
    (ui) => { ui.model(ui.state.chatId).isNewsletter = true; },
    (ui) => { ui.model(ui.state.chatId).groupMetadata = { isParentGroup: true }; },
    (ui) => { const image = ui.document.createElement('img'); ui.editor.append(image); },
    (ui) => { const mention = ui.document.createElement('span'); mention.setAttribute('data-mention-jid', '2@c.us'); ui.editor.append(mention); },
    (ui) => { const banner = ui.document.createElement('div'); banner.textContent = 'Replying to a message'; ui.footer.append(banner); },
    (ui) => { const preview = ui.document.createElement('div'); preview.setAttribute('data-testid', 'link-preview'); ui.footer.append(preview); },
    (ui) => { const unknown = ui.document.createElement('span'); unknown.setAttribute('data-unknown-context', 'true'); ui.editor.append(unknown); },
  ];
  for (const mutate of cases) {
    const ui = guest(); mutate(ui); await tick();
    assert.equal(ui.enter().defaultPrevented, true); assert.equal(ui.poll().request, null);
    assert.equal(ui.state.sent.length, 0); assert.equal(ui.state.cleared.length, 0);
    assert.match(ui.feedback(), /仅支持普通文字/);
  }
  const mentionText = guest({ text: 'Hello @Alice' }); mentionText.enter(); assert.equal(mentionText.poll().request, null);
  const email = guest({ text: 'Contact help@example.com tomorrow.' }); assert.ok(start(email));
});

test('identity exclusion allows null session and sends the original text without translation', async () => {
  const ui = guest({ policy: { includeZh: false }, text: '你好，请发 100 件。', session: null });
  const request = start(ui); assert.equal(ui.feedback(), '正在发送…');
  assert.deepEqual(ui.prepare(request, request.text, false, null), { ok: true });
  const flight = ui.commit(request); await tick();
  assert.equal(ui.state.sent[0][1], request.text);
  assert.equal(ui.read(request, flight.permit).value.status, 'confirmed');
  const paid = guest({ session: null }); const paidRequest = start(paid);
  assert.equal(paid.deliver(paidRequest, { status: 'notSubmitted', code: 'SESSION_REQUIRED', retryable: false }), true);
  assert.match(paid.feedback(), /请先登录/); assert.equal(paid.state.sent.length, 0);
});

test('prepare performs canonical quality validation and commit submits frozen plain text exactly once', async () => {
  const ui = guest(); const request = start(ui);
  assert.deepEqual(ui.prepare(request), { ok: true }); assert.equal(ui.state.sent.length, 0);
  assert.equal(ui.editor.innerText, request.text);
  const flight = ui.commit(request);
  assert.equal(flight.accepted, true); assert.equal(ui.read(request, flight.permit).pending, true);
  assert.deepEqual(ui.poll().request, request);
  assert.equal(ui.api.commit(generation, request.id, request.attempt, flight.permit), false);
  assert.equal(ui.api.commit(generation, request.id, request.attempt, randomUUID()), false);
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.state.sent)), [[request.chatId, 'Invia 100 unità domani.',
    { waitForAck: true, detectMentioned: false, linkPreview: false }]]);
  assert.deepEqual(ui.state.cleared, [['']]); assert.equal(ui.editor.innerText, '');
  const result = ui.read(request, flight.permit).value;
  assert.deepEqual(result, { status: 'confirmed', receipt: 'receipt-1', draftCleared: true });
  assert.deepEqual(ui.poll().request, request);
  ui.deliver(request, { ...result, retryable: false }); assert.equal(ui.feedback(), '已发送');
  assert.equal(ui.poll().request, null);
});

test('numeric changes are rejected without source mutation or silently obtaining a new paid ID', () => {
  const ui = guest(); const request = start(ui);
  assert.deepEqual(ui.prepare(request, 'Invia 200 unità domani.'), { ok: false, code: 'TRANSLATION_OUTPUT_INVALID' });
  assert.equal(ui.commit(request).accepted, false); assert.equal(ui.state.sent.length, 0);
  ui.deliver(request, { status: 'notSubmitted', code: 'TRANSLATION_OUTPUT_INVALID', retryable: false });
  ui.enter(); assert.equal(ui.poll().request, null); assert.equal(ui.editor.innerText, request.text);
  assert.match(ui.feedback(), /修改原文/);
});

test('source is never interpreted as markup and translated markup is only sent as literal text', async () => {
  const ui = guest({ text: 'Please send <b>100</b> units.' }); const request = start(ui);
  assert.deepEqual(ui.prepare(request, 'Invia <b>100</b> unità.'), { ok: true });
  ui.commit(request); await tick();
  assert.equal(ui.state.sent[0][1], 'Invia <b>100</b> unità.');
  assert.equal(ui.document.querySelector('b'), null);
});

test('typing, node replacement and A-to-B-to-A invalidate the old attempt but explicit same-source retry reuses its ID', async () => {
  for (const mutate of [
    async (ui) => { const source = ui.state.text; await ui.input('Changed'); await ui.input(source); },
    async (ui) => { ui.replaceEditor(); await tick(); },
    async (ui) => { ui.switchChat('200@c.us'); ui.switchChat('100@c.us'); await tick(); },
  ]) {
    const ui = guest(); const first = start(ui); await mutate(ui);
    assert.equal(ui.poll().request, null);
    assert.deepEqual(ui.prepare(first), { ok: false, code: 'SEND_INTENT_CHANGED' });
    assert.equal(ui.deliver(first, networkFailure), false);
    const retry = start(ui);
    assert.equal(retry.id, first.id); assert.equal(retry.attempt, first.attempt + 1);
    assert.ok(retry.composerRevision > first.composerRevision);
    assert.equal(ui.commit(first).accepted, false);
    assert.deepEqual(ui.prepare(retry), { ok: true });
  }
});

test('a changed source creates a new intent and a late old response cannot replace it', async () => {
  const ui = guest(); const old = start(ui);
  await ui.input('Please send 100 packages next week.');
  const next = start(ui); assert.notEqual(next.id, old.id);
  assert.deepEqual(ui.prepare(old), { ok: false, code: 'SEND_INTENT_CHANGED' });
  assert.equal(ui.deliver(old, { status: 'notSubmitted', code: 'NETWORK_UNAVAILABLE', retryable: false }), false);
  assert.deepEqual(ui.poll().request, next); assert.equal(ui.editor.innerText, next.text);
});

test('precommit network failure retries the same ID and attempt increases only on a new trusted gesture', () => {
  const ui = guest(); const first = start(ui); ui.deliver(first, networkFailure);
  assert.equal(ui.poll().request, null); assert.match(ui.feedback(), /同一次/);
  ui.enter({ isTrusted: false }); assert.equal(ui.poll().request, null);
  const second = start(ui); assert.equal(second.id, first.id); assert.equal(second.attempt, 2);
  assert.equal(ui.deliver(first, networkFailure), false);
  assert.deepEqual(ui.prepare(first), { ok: false, code: 'SEND_INTENT_CHANGED' });
});

test('appearance-only changes retain logical identity while old revision output is rejected', () => {
  const ui = guest(); const first = start(ui);
  assert.deepEqual(ui.prepare(first), { ok: true });
  ui.configuration.settings.revision += 1;
  ui.configuration.settings.global.fontColor = '#ff0000'; ui.configuration.settings.global.fontSize = 15;
  assert.equal(ui.configure(), true); assert.equal(ui.poll().request, null);
  assert.deepEqual(ui.prepare(first), { ok: false, code: 'SEND_INTENT_CHANGED' });
  assert.equal(ui.deliver(first, networkFailure), false); assert.equal(ui.commit(first).accepted, false);
  const retry = start(ui); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
  assert.equal(retry.policyRevision, 2); assert.deepEqual(ui.prepare(retry), { ok: true });
});

test('unrelated chat settings keep the logical ID; outgoing language or route changes allocate a new ID', () => {
  for (const patch of [{ target: 'fr' }, { route: 'backup' }, { source: 'auto' }]) {
    const ui = guest(); const first = start(ui); ui.deliver(first, networkFailure);
    ui.configuration.settings.revision += 1;
    ui.configuration.settings.chats['200@c.us'] = { ...ui.configuration.settings.global, target: 'de' };
    ui.configure(); const same = start(ui); assert.equal(same.id, first.id);
    ui.deliver(same, networkFailure);
    ui.configuration.settings.revision += 1; Object.assign(ui.configuration.settings.global, patch); ui.configure();
    const changed = start(ui); assert.notEqual(changed.id, first.id);
  }
});

test('a new unsupported context introduced after translation prevents commit', async () => {
  const ui = guest(); const request = start(ui); ui.prepare(request);
  ui.model(ui.state.chatId).composeQuotedMsg = { id: 'reply-now' };
  assert.equal(ui.commit(request).accepted, false); assert.equal(ui.state.sent.length, 0);
  assert.equal(ui.editor.innerText, request.text);
  await tick();
});

test('an edited draft or another chat is never cleared after the frozen target ACK', async () => {
  for (const change of [async (ui) => ui.input('My next message'), async (ui) => { ui.switchChat('200@c.us', 'Second chat draft'); await tick(); }]) {
    const pending = deferred(); const ui = guest(); ui.state.transport = () => pending.promise;
    const request = start(ui); ui.prepare(request); const flight = ui.commit(request);
    await change(ui); const draft = ui.editor.innerText;
    pending.resolve({ id: 'known-ack', ack: 1 }); await tick();
    assert.deepEqual(ui.read(request, flight.permit).value, { status: 'confirmed', receipt: 'known-ack', draftCleared: false });
    assert.equal(ui.state.sent[0][0], '100@c.us'); assert.equal(ui.editor.innerText, draft); assert.equal(ui.state.cleared.length, 0);
  }
});

test('a failed official clear does not change confirmed outcome or permit a residual draft resend', async () => {
  const ui = guest(); ui.state.clear = () => { throw new Error('Synthetic failure'); };
  const request = start(ui); ui.prepare(request); const flight = ui.commit(request); await tick();
  const result = ui.read(request, flight.permit).value;
  assert.equal(result.status, 'confirmed'); assert.equal(result.draftCleared, false);
  ui.deliver(request, { ...result, retryable: false });
  assert.match(ui.feedback(), /已发送；输入框未清空/);
  ui.enter(); ui.click(); assert.equal(ui.poll().request, null); assert.equal(ui.state.sent.length, 1);
  assert.equal(ui.editor.innerText, request.text);
  ui.configuration.settings.revision += 1; ui.configuration.settings.global.enabled = false;
  ui.configuration.settings.global.autoSend = false; ui.configure();
  assert.equal(ui.enter().defaultPrevented, true); assert.equal(ui.state.sent.length, 1);
  await ui.input('A deliberately new draft'); assert.equal(ui.enter().defaultPrevented, false);
});

test('missing ACK, transport throw and rejected response are uncertain and cannot be sent again', async () => {
  for (const transport of [() => undefined, () => ({ id: 'not-acked', ack: 0 }), () => ({ id: 'submitted', ack: 1 }),
    () => { throw new Error('Synthetic throw'); }, () => Promise.reject(new Error('Synthetic reject'))]) {
    const ui = guest(); ui.state.transport = transport;
    const request = start(ui); ui.prepare(request); const flight = ui.commit(request); await tick();
    const outcome = ui.read(request, flight.permit).value; assert.equal(outcome.status, 'uncertain');
    ui.deliver(request, { ...outcome, retryable: false }); assert.match(ui.feedback(), /不会自动重发/);
    ui.enter(); ui.click(); assert.equal(ui.poll().request, null); assert.equal(ui.state.sent.length, 1);
    assert.equal(ui.state.cleared.length, 0); assert.equal(ui.editor.innerText, request.text);
  }
});

test('a late duplicate notSubmitted cannot unlock a consumed commit or permit', async () => {
  const ui = guest(); ui.state.clear = () => false;
  const request = start(ui); ui.prepare(request); const flight = ui.commit(request); await tick();
  ui.deliver(request, networkFailure); ui.enter();
  assert.equal(ui.poll().request, null); assert.equal(ui.state.sent.length, 1);
  assert.equal(ui.api.commit(generation, request.id, request.attempt, flight.permit), false);
});

test('timeouts preserve precommit ID but a submitted timeout remains uncertain after late ACK', async () => {
  const before = guest(); const first = start(before); before.state.now = 50001;
  assert.equal(before.poll().request, null); const retry = start(before);
  assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
  const pending = deferred(); const after = guest(); after.state.transport = () => pending.promise;
  const request = start(after); after.prepare(request); const flight = after.commit(request);
  after.state.now = 50001; assert.equal(after.read(request, flight.permit).value.status, 'uncertain');
  pending.resolve({ id: 'late-ack', ack: 1 }); await tick();
  assert.equal(after.read(request, flight.permit).value.status, 'uncertain');
  assert.equal(after.state.cleared.length, 0);
  after.deliver(request, { status: 'uncertain', code: 'SEND_INTENT_UNCERTAIN', retryable: false });
  after.enter(); assert.equal(after.poll().request, null);
});

test('cancel before submission is explicitly retryable; cancel after submission remains uncertain', async () => {
  const before = guest(); const first = start(before);
  assert.equal(before.api.cancel(generation, first.id, first.attempt), true);
  assert.equal(before.poll().request, null); assert.equal(start(before).id, first.id);
  const pending = deferred(); const after = guest(); after.state.transport = () => pending.promise;
  const request = start(after); after.prepare(request); const flight = after.commit(request);
  after.api.cancel(generation, request.id, request.attempt);
  pending.resolve({ id: 'ack-after-cancel', ack: 1 }); await tick();
  assert.equal(after.read(request, flight.permit).value.status, 'uncertain'); assert.equal(after.state.cleared.length, 0);
});

test('inactive, session-changed or revoked guests cannot prepare or commit prior work', () => {
  for (const mutate of [
    (ui) => { ui.configuration.active = false; ui.configure(); },
    (ui) => { ui.configuration.sessionGeneration = randomUUID(); ui.configure(); },
    (ui) => { ui.api.revoke(generation); },
  ]) {
    const ui = guest(); const request = start(ui); mutate(ui);
    assert.equal(ui.prepare(request, undefined, true, subscription).ok, false);
    assert.equal(ui.commit(request).accepted, false); assert.equal(ui.state.sent.length, 0);
  }
});

test('native deactivate cancels precommit without resurrection and makes already-submitted work uncertain', async () => {
  const ui = guest(); const first = start(ui); ui.prepare(first);
  assert.equal(ui.api.deactivate(randomUUID()), false);
  assert.equal(ui.api.deactivate(generation), true); assert.equal(ui.poll().request, null);
  assert.equal(ui.commit(first).accepted, false);
  assert.equal(ui.configure(), true); assert.equal(ui.poll().request, null);
  assert.equal(ui.commit(first).accepted, false);
  const retry = start(ui); assert.equal(retry.id, first.id); assert.equal(retry.attempt, 2);
  const pending = deferred(); ui.state.transport = () => pending.promise;
  ui.prepare(retry); const flight = ui.commit(retry);
  ui.api.deactivate(generation); assert.equal(ui.poll().request, null);
  pending.resolve({ id: 'ack-after-hide', ack: 1 }); await tick();
  assert.equal(ui.read(retry, flight.permit).value.status, 'uncertain'); assert.equal(ui.state.cleared.length, 0);
  ui.configure(); ui.enter(); assert.equal(ui.poll().request, null); assert.equal(ui.state.sent.length, 1);
});

test('explicitly nonretryable failure stays blocked until the user changes the original text', async () => {
  const ui = guest(); const first = start(ui);
  ui.deliver(first, { status: 'notSubmitted', code: 'TRANSLATION_RESULT_UNAVAILABLE', retryable: false });
  ui.enter(); assert.equal(ui.poll().request, null);
  await ui.input('Please send 100 units next week.'); const next = start(ui); assert.notEqual(next.id, first.id);
});

test('freshly typing identical content after a confirmed message creates a deliberate new intent', async () => {
  const ui = guest(); const first = start(ui); ui.prepare(first); ui.commit(first); await tick();
  ui.deliver(first, { status: 'confirmed', receipt: 'receipt-1', draftCleared: true, retryable: false });
  await ui.input(first.text);
  const next = start(ui); assert.notEqual(next.id, first.id); assert.equal(next.attempt, 1);
});

test('record limits fail closed without evicting replay protection', async () => {
  const ui = guest(); let last;
  for (let index = 0; index < 128; index += 1) {
    await ui.input(`Please send ${index} units.`); last = start(ui); ui.deliver(last, networkFailure);
  }
  await ui.input('Please send a separate message.'); ui.enter();
  assert.equal(ui.poll().request, null); assert.match(ui.feedback(), /记录已满.*重新打开/); assert.equal(ui.state.sent.length, 0);
  assert.equal(ui.configure(), true);
  ui.configuration.generation = randomUUID(); assert.equal(ui.configure(), false);
  assert.equal(ui.api.revoke(generation), true); assert.equal(ui.api.revoke(generation), false);
});

test('admission reserves the maximum output before translation can consume more than the text budget', async () => {
  const ui = guest(); let retained = 0; let admitted = 0;
  for (let index = 0; index < 128; index += 1) {
    const prefix = `${index} `;
    const source = prefix + 'Please send these units tomorrow. '.repeat(300).slice(0, 6999 - prefix.length) + '.';
    const output = prefix + 'Invia queste unità domani. '.repeat(500).slice(0, 9999 - prefix.length) + '.';
    await ui.input(source); ui.enter(); const request = ui.poll().request;
    if (!request) break;
    assert.deepEqual(ui.prepare(request, output), { ok: true });
    ui.api.cancel(generation, request.id, request.attempt);
    retained += (source.length + output.length) * 2; admitted += 1;
  }
  assert.equal(admitted, 61); assert.ok(retained <= 2 * 1024 * 1024);
  assert.match(ui.feedback(), /记录已满.*重新打开/);
  assert.equal(ui.state.sent.length, 0);
});
