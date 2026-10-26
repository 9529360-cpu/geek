import assert from 'node:assert/strict';
import test from 'node:test';
import { telegramFixture, deferred, flush } from './helpers/telegram-send.mjs';

const frozen = (composer) => { const value = composer.read(); return { ...value, composerState: value }; };
const event = (target, values = {}) => ({ type: 'keydown', key: 'Enter', target,
  shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, ...values });

test('K composer binds its actual input/model to a namespaced plain context', () => {
  const f = telegramFixture(); const record = frozen(f.composer);
  assert.equal(record.chatId, 'tg:101'); assert.equal(f.composer.currentChat(), 'tg:101');
  assert.equal(record.editor, f.editor); assert.equal(record.chat, f.chat);
  assert.equal(record.composerState.input, f.input);
  assert.equal(record.context.kind, 'plain'); assert.equal(record.quoteNodes.length, 0);
  assert.equal(f.composer.matches(record, f.composer.read()), true);
  f.state.draftOverride = { _: 'draftMessage', date: 1, message: 'Different model', pFlags: {} };
  assert.throws(() => f.composer.read());
  assert.equal(f.state.sends.length, 0);
});

test('translated plain body submits once and only a separate successful CAS clears the original', async () => {
  const f = telegramFixture(); const record = frozen(f.composer);
  const original = f.editor.innerText;
  const result = await f.finish(f.composer.submit(record, 'Invia domani.', () => true));
  assert.equal(result.id, 'tg:101:700'); assert.equal(result.ack, 1);
  assert.equal(f.state.sends[0].params.message, 'Invia domani.');
  assert.equal(f.state.sends[0].params.clear_draft, false);
  assert.equal(f.editor.innerText, original); assert.equal(f.state.clears.length, 0);
  assert.equal(f.composer.clear(record), true);
  assert.equal(f.editor.innerText, '');
  assert.deepEqual(f.state.clears, [{ canSetDraft: false, fireEvent: true }]);
});

test('an input edit while preparation is blocked cancels submission without clearing either draft', async () => {
  const f = telegramFixture(); const record = frozen(f.composer); f.state.configGate = deferred();
  const pending = f.composer.submit(record, 'Invia domani.', () => true);
  const rejected = assert.rejects(pending, (error) => f.composer.notSubmitted(error));
  await flush(); f.editor.innerText = 'New source'; f.mutate(); await f.advance(50); await rejected;
  f.state.configGate.resolve(); await flush();
  assert.equal(f.state.sends.length, 0); assert.equal(f.state.stages.length, 0);
  assert.equal(f.state.clears.length, 0); assert.equal(f.editor.innerText, 'New source');
});

test('ACK after a later edit is uncertain and cannot clear the later input', async () => {
  const f = telegramFixture(); const record = frozen(f.composer); f.state.mode = 'never';
  const pending = f.composer.submit(record, 'Invia domani.', () => true);
  const rejected = assert.rejects(pending, (error) => error.submitted === true && !f.composer.notSubmitted(error));
  await f.until(() => f.state.sends.length === 1);
  f.editor.innerText = 'My next message'; f.mutate();
  f.emitFinal(f.state.stages[0].message); await f.advance(); await rejected;
  assert.equal(f.composer.clear(record), false);
  assert.equal(f.editor.innerText, 'My next message'); assert.equal(f.state.clears.length, 0);
  assert.equal(f.state.sends.length, 1);
});

test('model/input A to B to A never makes an old composer revision current again', () => {
  const f = telegramFixture(); const record = frozen(f.composer);
  f.editor.innerText = 'Changed'; f.mutate();
  f.editor.innerText = record.text; f.mutate();
  assert.equal(f.composer.matches(record, f.composer.read()), false);
  assert.equal(f.composer.clear(record), false);
  const next = frozen(f.composer);
  f.chat.peerId = 102; f.location.hash = '#102'; f.im.emit('peer_changing', f.chat);
  f.chat.peerId = 101; f.location.hash = '#101'; f.im.emit('peer_changing', f.chat);
  assert.equal(f.composer.matches(next, f.composer.read()), false);
});

test('account A to B to A revokes the original model snapshot even for the same peer and text', () => {
  const f = telegramFixture(); const record = frozen(f.composer);
  f.switchAccount(2, 91); f.switchAccount(1, 90);
  assert.equal(f.composer.matches(record, f.composer.read()), false);
  assert.equal(f.composer.clear(record), false);
});

test('a draft mention survives translation and a disabled preview stays off', async () => {
  const f = telegramFixture();
  f.editor.innerText = 'Hello @alice';
  f.state.draftOverride = { _: 'draftMessage', date: 1, message: 'Hello @alice', pFlags: {},
    entities: [{ _: 'messageEntityMention', offset: 6, length: 6 }] };
  const record = frozen(f.composer);
  assert.equal(JSON.stringify(record.mentions), JSON.stringify(['@alice']));
  const result = await f.finish(f.composer.submit(record, 'Ciao @alice', () => true));
  assert.equal(result.id, 'tg:101:700');
  assert.equal(f.state.sends[0].params.no_webpage, false);
  assert.equal(JSON.stringify(f.state.sends[0].params.entities),
    JSON.stringify([{ _: 'messageEntityMention', offset: 5, length: 6 }]));
  f.editor.innerText = 'https://example.test/a';
  f.state.draftOverride = { _: 'draftMessage', date: 1, message: 'https://example.test/a', pFlags: { no_webpage: true } };
  const disabled = frozen(f.composer);
  await f.finish(f.composer.submit(disabled, 'https://example.test/a', () => true));
  assert.equal(f.state.sends[1].params.no_webpage, true);
  assert.equal(JSON.stringify(f.state.sends[1].params.entities), '[]');
});

test('the media popup send keeps the translated caption and confirms an album', async () => {
  const f = telegramFixture();
  const popup = f.document.createElement('div');
  popup.className = 'popup active';
  const editor = f.document.createElement('div');
  editor.innerText = 'See the photos';
  editor.setAttribute('contenteditable', 'true');
  const button = f.document.createElement('button');
  button.className = 'send';
  const first = f.document.createElement('img');
  const second = f.document.createElement('img');
  popup.append(first); popup.append(second); popup.append(editor); popup.append(button);
  f.state.popupNodes = [popup];
  button.click = () => f.root.emit('message_sent', { message: { _: 'message', peerId: 101, id: 700, mid: 700,
    message: editor.innerText, pFlags: { out: true }, grouped_id: 'album-1' } });
  const record = frozen(f.composer);
  assert.equal(record.context.kind, 'popup-caption');
  assert.equal(record.previewCount, 2);
  const result = await f.finish(f.composer.submit(record, 'Guarda le foto', () => true));
  assert.equal(result.id, 'tg:101:700');
  assert.equal(editor.innerText, 'Guarda le foto');
  assert.equal(f.state.sends.length, 0);
});

test('reply, media, mention, formatting, preview, scheduling and changed send-as are unsupported', () => {
  const mutations = [
    (f) => { f.input.replyToMsgId = 12; }, (f) => { f.input.willSendWebPage = {}; },
    (f) => { f.input.forwarding = { 101: [3] }; }, (f) => { f.input.editMsgId = 4; },
    (f) => { f.input.scheduleDate = 50; }, (f) => { f.input.sendAsPeerId = -202; },
    (f) => { f.input.recording = true; }, (f) => { f.input.ephemeralComposer = true; },
    (f) => { f.state.draftOverride = { _: 'draftMessage', message: f.editor.innerText, pFlags: {}, media: {} }; },
    (f) => { f.state.draftOverride = { _: 'draftMessage', message: f.editor.innerText, pFlags: {}, entities: [{ _: 'messageEntityBold' }] }; },
    (f) => { f.state.draftOverride = { _: 'draftMessage', message: f.editor.innerText, pFlags: {}, futureAttachment: {} }; },
    (f) => { f.editor.innerText = '@person Hello'; },
  ];
  for (const mutate of mutations) {
    const f = telegramFixture(); mutate(f);
    assert.throws(() => f.composer.read()); assert.equal(f.state.sends.length, 0);
  }
});

test('Enter respects actual K shortcut settings; send button is the model-owned button', () => {
  const f = telegramFixture();
  assert.equal(f.composer.submission(event(f.editor)).supported, true);
  assert.equal(f.composer.submission(event(f.editor, { shiftKey: true })).matches, false);
  f.state.shortcut = 'ctrlEnter';
  assert.equal(f.composer.submission(event(f.editor)).matches, false);
  assert.equal(f.composer.submission(event(f.editor, { ctrlKey: true })).supported, true);
  assert.equal(f.composer.submission(event(f.editor, { ctrlKey: true, isComposing: true })).matches, false);
  assert.equal(f.composer.submission({ type: 'click', target: f.icon }).supported, true);
  f.input.sendBtnIcon = 'edit';
  assert.equal(f.composer.submission({ type: 'click', target: f.icon }).supported, false);
  assert.equal(f.composer.submission({ type: 'click', target: f.container }).matches, false);
});

test('popup Enter is blocked, active autocomplete selection remains owned by Telegram', () => {
  const f = telegramFixture(); f.state.popup = true;
  assert.equal(f.composer.submission(event(f.editor)).supported, false);
  f.state.popup = false;
  const helper = { hidden: false, container: f.container, detach() {} };
  f.input.autocompleteHelperController = { helpers: new Set([helper]) };
  assert.equal(f.composer.submission(event(f.editor)).matches, false);
  helper.hidden = true;
  assert.equal(f.composer.submission(event(f.editor)).supported, true);
  f.state.shortcut = 'unknown';
  assert.equal(f.composer.submission(event(f.editor)).supported, false);
});

test('touch K uses its real mousedown path and ignores the subsequent pointer click', () => {
  const f = telegramFixture({ touch: true });
  assert.equal(f.composer.submission({ type: 'mousedown', target: f.icon, button: 0 }).supported, true);
  assert.equal(f.composer.submission({ type: 'mousedown', target: f.icon, button: 2 }).supported, false);
  assert.equal(f.composer.submission({ type: 'click', target: f.icon, detail: 1 }).matches, false);
  assert.equal(f.composer.submission({ type: 'click', target: f.icon, detail: 0 }).supported, true);
  const desktop = telegramFixture();
  assert.equal(desktop.composer.submission({ type: 'mousedown', target: desktop.icon, button: 0 }).matches, false);
});

test('disposal and invalid owner guard forbid further submission', async () => {
  const f = telegramFixture(); const record = frozen(f.composer);
  await assert.rejects(f.composer.submit(record, 'Invia domani.', () => false), (error) => f.composer.notSubmitted(error));
  f.composer.dispose();
  await assert.rejects(f.composer.submit(record, 'Invia domani.', () => true), (error) => f.composer.notSubmitted(error));
  assert.equal(f.state.sends.length, 0); assert.equal(f.state.clears.length, 0);
});

test('only this composer proves a preflight failure had zero submissions and can recover', async () => {
  const f = telegramFixture(); const record = frozen(f.composer); f.state.allowed = false;
  let rejected;
  await assert.rejects(f.composer.submit(record, 'Invia domani.', () => true), (error) => {
    rejected = error; return f.composer.notSubmitted(error) && error.code === 'CAPABILITY_UNAVAILABLE';
  });
  assert.equal(f.state.sends.length, 0); assert.equal(f.state.stages.length, 0);
  assert.equal(f.composer.notSubmitted({ code: rejected.code, submitted: false }), false);
  assert.equal(f.composer.notSubmitted(f.runtime.issue('CAPABILITY_UNAVAILABLE')), false);
  assert.equal(telegramFixture().composer.notSubmitted(rejected), false);
  f.state.allowed = true;
  const result = await f.finish(f.composer.submit(record, 'Invia domani.', () => true));
  assert.equal(result.ack, 1); assert.equal(f.state.sends.length, 1);
  assert.equal(f.state.clears.length, 0);
});

test('a post-invocation error cannot become notSubmitted by forging its boolean or code', async () => {
  const f = telegramFixture(); const record = frozen(f.composer); f.state.apiThrow = true;
  let rejected;
  const pending = f.composer.submit(record, 'Invia domani.', () => true);
  const checked = assert.rejects(pending, (error) => { rejected = error; return !f.composer.notSubmitted(error); });
  await f.until(() => f.state.sends.length === 1);
  await checked;
  rejected.submitted = false; rejected.code = 'NOT_SUBMITTED';
  assert.equal(f.composer.notSubmitted(rejected), false);
  assert.equal(f.state.sends.length, 1); assert.equal(f.state.cancelled.length, 0);
  assert.equal(f.state.clears.length, 0);
});
