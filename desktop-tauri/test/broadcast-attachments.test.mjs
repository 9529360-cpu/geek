import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, deferred, catalog, attachment } from './helpers/broadcast.mjs';
import { attachmentLimits, normalizeAttachments, emptyDraft, draftPayload, localSchedule } from '../frontend/models/broadcast.mjs';
import { errorMessage } from '../frontend/models/broadcast-status.mjs';

const ready = { a: { capabilities: { ...catalog().capabilities, attachments: true } },
  b: { capabilities: { ...catalog('b').capabilities, attachments: true } } };
const flush = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
const picked = (files, accountId = 'a') => ({ accountId, attachments: files });
const filesOf = (ui) => ui.get('broadcast-files').querySelectorAll('.bf-item');
const pick = (ui) => ui.input('broadcast-add-file', true, 'change');
const remove = (ui, index = 0) => ui.fire(filesOf(ui)[index].querySelector('button'), 'click');
async function review(ui) { for (let index = 0; index < 3; index++) await ui.click('broadcast-workbench-next'); }

test('the original attachment entry lists files and creates one ordered attachment-only job', async (t) => {
  const files = [attachment(1), attachment(2, { name: '合同 & 报价.pdf', mime: 'application/pdf', kind: 'document' })];
  const ui = await fixture({ accountCatalogs: ready, before: (name) => name === 'pick' ? picked(files) : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await pick(ui);
  assert.equal(ui.get('broadcast-add-file').checked, false);
  assert.deepEqual(filesOf(ui).map((node) => node.title), files.map((file) => file.name));
  assert.equal(filesOf(ui)[1].querySelector('button').getAttribute('aria-label'), '移除附件 合同 & 报价.pdf');
  await ui.select('a-ann'); await review(ui);
  assert.match(ui.get('broadcast-review-card').textContent, /2 个附件/);
  assert.match(ui.get('broadcast-review-card').textContent, /无文本，仅发送附件/);
  await ui.click('broadcast-send');
  const request = ui.calls.find(([name]) => name === 'create')[1];
  assert.deepEqual(request.attachmentIds, files.map((file) => file.id));
  assert.equal(request.message, '');
  assert.equal(Object.hasOwn(request, 'attachments'), false);
  assert.equal(Object.hasOwn(request, 'files'), false);
  assert.deepEqual(ui.backend.jobs[0].attachments, files);
  assert.equal(ui.panel, null);
  assert.match(ui.get('broadcast-job-bar').textContent, /2 个附件/);
  await ui.click('broadcast-task-center-button');
  assert.match(ui.get('broadcast-task-center-overlay').textContent, /2 个附件/);
  assert.equal(ui.get('broadcast-task-center-overlay').querySelectorAll('.bf-remove').length, 0);
});

test('removal releases only the bound account reference and failure preserves its chip and draft', async (t) => {
  const files = [attachment(1), attachment(2)];
  const ui = await fixture({ accountCatalogs: ready, before: (name) => name === 'pick' ? picked(files) : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await pick(ui); await ui.input('broadcast-message', 'Caption');
  ui.failures.add('release'); await remove(ui);
  assert.equal(filesOf(ui).length, 2);
  assert.equal(ui.get('broadcast-message').value, 'Caption');
  assert.match(ui.get('broadcast-workbench-status').textContent, /草稿仍保留/);
  ui.failures.delete('release'); await remove(ui);
  assert.deepEqual(ui.calls.filter(([name]) => name === 'release').at(-1)[1], { accountId: 'a', attachmentIds: [files[0].id] });
  assert.deepEqual(filesOf(ui).map((node) => node.title), [files[1].name]);
  await ui.click('broadcast-close'); await ui.open();
  assert.deepEqual(filesOf(ui).map((node) => node.title), [files[1].name]);
  assert.equal(ui.get('broadcast-message').value, 'Caption');
});

test('picker cancellation and native failure keep the existing account draft', async (t) => {
  let attempt = 0;
  const ui = await fixture({ accountCatalogs: ready, before: (name) => {
    if (name !== 'pick') return undefined;
    attempt += 1;
    if (attempt === 1) return picked([attachment()]);
    if (attempt === 2) return null;
    throw 'BROADCAST_ATTACHMENT_UNAVAILABLE';
  } });
  t.after(() => ui.controller.dispose());
  await ui.open(); await ui.input('broadcast-message', 'Unsent'); await pick(ui); await pick(ui); await pick(ui);
  assert.equal(filesOf(ui).length, 1);
  assert.equal(ui.get('broadcast-message').value, 'Unsent');
  assert.equal(ui.calls.some(([name]) => name === 'release'), false);
  assert.match(ui.get('broadcast-workbench-status').textContent, /附件已不可用/);
  assert.equal(ui.get('broadcast-reload-chats').classList.contains('hidden'), true);
});

test('one pending picker allows editing and closing but cannot attach its late result', async (t) => {
  const pending = deferred();
  const ui = await fixture({ accountCatalogs: ready, before: (name) => name === 'pick' ? pending.promise : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open();
  ui.get('broadcast-dropzone').fire('click'); ui.get('broadcast-dropzone').fire('click'); await flush();
  assert.equal(ui.calls.filter(([name]) => name === 'pick').length, 1);
  assert.equal(ui.get('broadcast-send').disabled, true);
  assert.equal(ui.get('broadcast-message').disabled, false);
  assert.equal(ui.get('broadcast-close').disabled, false);
  ui.get('broadcast-message').value = 'Keep this draft'; ui.get('broadcast-message').fire('input');
  ui.get('broadcast-close').fire('click'); await flush();
  assert.equal(ui.panel, null);
  pending.resolve(picked([attachment()])); await ui.controller.idle();
  assert.deepEqual(ui.calls.find(([name]) => name === 'release')[1], { accountId: 'a', attachmentIds: [attachment().id] });
  await ui.open();
  assert.equal(filesOf(ui).length, 0);
  assert.equal(ui.get('broadcast-message').value, 'Keep this draft');
});

test('an A to B to A switch invalidates an in-flight picker even with the same final account', async (t) => {
  const pending = deferred();
  const ui = await fixture({ accountCatalogs: ready, before: (name) => name === 'pick' ? pending.promise : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); ui.get('broadcast-dropzone').fire('click'); await flush();
  ui.switchAccount('b'); ui.switchAccount('a');
  pending.resolve(picked([attachment()])); await ui.controller.idle();
  assert.equal(filesOf(ui).length, 0);
  assert.equal(ui.calls.filter(([name]) => name === 'release').length, 1);
  assert.equal(ui.calls.some(([name]) => name === 'create'), false);
});

test('late picker errors cannot replace another account feedback or attachment draft', async (t) => {
  const pending = deferred();
  let delayed = false;
  const ui = await fixture({ accountCatalogs: ready, before: (name, accountId) => {
    if (name !== 'pick') return undefined;
    return delayed ? pending.promise : picked([attachment(accountId === 'a' ? 1 : 2)], accountId);
  } });
  t.after(() => ui.controller.dispose());
  await ui.open(); await pick(ui); await ui.click('broadcast-close');
  ui.switchAccount('b'); await ui.open(); await pick(ui); await ui.click('broadcast-close');
  ui.switchAccount('a'); await ui.open(); delayed = true;
  ui.get('broadcast-dropzone').fire('click'); await flush();
  ui.get('broadcast-close').fire('click'); await flush(); ui.switchAccount('b');
  ui.get('btn-broadcast').fire('click'); await flush(); ui.get('bc-menu-send').fire('click'); await flush();
  const feedback = ui.get('broadcast-workbench-status').textContent;
  pending.reject('BROADCAST_ATTACHMENT_CHANGED'); await ui.controller.idle();
  assert.equal(ui.get('broadcast-workbench-status').textContent, feedback);
  assert.deepEqual(filesOf(ui).map((node) => node.title), [attachment(2).name]);
  await ui.click('broadcast-close'); ui.switchAccount('a'); await ui.open();
  assert.deepEqual(filesOf(ui).map((node) => node.title), [attachment(1).name]);
});

test('wrong-owner or malformed metadata is not displayed and its newly returned references are released', async (t) => {
  let attempt = 0;
  const ui = await fixture({ accountCatalogs: ready, before: (name) => {
    if (name !== 'pick') return undefined;
    attempt += 1;
    return attempt === 1 ? picked([attachment(1)], 'b') : picked([attachment(2, { kind: 'unknown' })]);
  } });
  t.after(() => ui.controller.dispose());
  await ui.open(); await pick(ui); await pick(ui);
  assert.equal(filesOf(ui).length, 0);
  assert.match(ui.get('broadcast-workbench-status').textContent, /附件信息无法验证/);
  assert.deepEqual(ui.calls.filter(([name]) => name === 'release').map(([, value]) => value), [
    { accountId: 'a', attachmentIds: [attachment(1).id] }, { accountId: 'a', attachmentIds: [attachment(2).id] },
  ]);
});

test('an over-limit selection releases the incoming files and keeps the previous nine', async (t) => {
  let attempt = 0;
  const first = Array.from({ length: 9 }, (_, index) => attachment(index + 1));
  const extra = [attachment(10), attachment(11)];
  const ui = await fixture({ accountCatalogs: ready, before: (name) => name === 'pick' ? picked(++attempt === 1 ? first : extra) : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await pick(ui); await pick(ui);
  assert.deepEqual(filesOf(ui).map((node) => node.title), first.map((file) => file.name));
  assert.match(ui.get('broadcast-workbench-status').textContent, /最多添加 10 个/);
  assert.deepEqual(ui.calls.find(([name]) => name === 'release')[1].attachmentIds, extra.map((file) => file.id));
});

test('@all blocks the picker without changing the selection and attachments disable @all', async (t) => {
  const ui = await fixture({ accountCatalogs: ready, before: (name) => name === 'pick' ? picked([attachment()]) : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await ui.input('broadcast-tagall', true, 'change'); await pick(ui);
  assert.equal(ui.calls.some(([name]) => name === 'pick'), false);
  assert.equal(ui.get('broadcast-tagall').checked, true);
  assert.match(ui.get('broadcast-workbench-status').textContent, /请先关闭@全体/);
  await ui.input('broadcast-tagall', false, 'change'); await pick(ui);
  assert.equal(ui.get('broadcast-tagall').disabled, true);
  await remove(ui);
  assert.equal(ui.get('broadcast-tagall').disabled, false);
});

test('@all enabled while a picker is pending rejects the late attachment without silently changing @all', async (t) => {
  const pending = deferred();
  const ui = await fixture({ accountCatalogs: ready, before: (name) => name === 'pick' ? pending.promise : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); ui.get('broadcast-dropzone').fire('click'); await flush();
  ui.get('broadcast-tagall').checked = true; ui.get('broadcast-tagall').fire('change');
  pending.resolve(picked([attachment()])); await ui.controller.idle();
  assert.equal(filesOf(ui).length, 0);
  assert.equal(ui.get('broadcast-tagall').checked, true);
  assert.equal(ui.calls.filter(([name]) => name === 'release').length, 1);
});

test('create locks attachments, and a failed create keeps the same references and id for an explicit retry', async (t) => {
  const pending = deferred(); let fail = true;
  const files = [attachment()];
  const ui = await fixture({ accountCatalogs: ready, before: (name) => {
    if (name === 'pick') return picked(files);
    return name === 'create' && fail ? pending.promise : undefined;
  } });
  t.after(() => ui.controller.dispose());
  await ui.open(); await pick(ui); await ui.input('broadcast-message', 'Caption'); await ui.select('a-ann'); await review(ui);
  ui.get('broadcast-send').fire('click'); await flush();
  assert.equal(filesOf(ui)[0].querySelector('button').disabled, true);
  assert.equal(ui.get('broadcast-add-file').disabled, true);
  filesOf(ui)[0].querySelector('button').fire('click'); ui.get('broadcast-dropzone').fire('click');
  assert.equal(ui.calls.filter(([name]) => name === 'pick').length, 1);
  assert.equal(ui.calls.some(([name]) => name === 'release'), false);
  pending.reject('BROADCAST_PERSISTENCE'); await ui.controller.idle(); fail = false;
  assert.equal(filesOf(ui).length, 1); assert.equal(ui.get('broadcast-message').value, 'Caption');
  await ui.click('broadcast-send');
  const creates = ui.calls.filter(([name]) => name === 'create').map(([, value]) => value);
  assert.equal(creates.length, 2); assert.equal(creates[0].id, creates[1].id);
  assert.deepEqual(creates[0].attachmentIds, creates[1].attachmentIds);
  assert.deepEqual(ui.backend.jobs[0].attachments, files);
});

test('continuous scheduling transfers attachments to the job and clears only the accepted content', async (t) => {
  const ui = await fixture({ accountCatalogs: ready, before: (name) => name === 'pick' ? picked([attachment()]) : undefined });
  t.after(() => ui.controller.dispose());
  await ui.open(); await pick(ui); await ui.select('a-ann');
  await ui.input('broadcast-schedule-toggle', true, 'change');
  await ui.input('broadcast-schedule-time', localSchedule(Date.now() + 3600_000));
  await ui.click('broadcast-add-schedule');
  assert.equal(ui.panel, 'broadcast-overlay'); assert.equal(filesOf(ui).length, 0);
  assert.equal(ui.get('bc-selected-chips').children.length, 1);
  assert.deepEqual(ui.backend.jobs[0].attachments, [attachment()]);
  assert.match(ui.get('broadcast-schedule-list').textContent, /1 个附件/);
  assert.equal(ui.calls.some(([name]) => name === 'release'), false);
  await ui.click('broadcast-add-schedule');
  assert.equal(ui.calls.filter(([name]) => name === 'create').length, 1);
  assert.match(ui.get('broadcast-workbench-status').textContent, /添加附件/);
});

test('disposing the controller releases unsent drafts and any late picker result once', async () => {
  const pending = deferred(); let attempt = 0;
  const ui = await fixture({ accountCatalogs: ready, before: (name) => name === 'pick' ? ++attempt === 1 ? picked([attachment(1)]) : pending.promise : undefined });
  await ui.open(); await pick(ui); ui.get('broadcast-dropzone').fire('click'); await flush();
  ui.controller.dispose(); ui.controller.dispose();
  pending.resolve(picked([attachment(2)])); await ui.controller.idle();
  assert.deepEqual(ui.calls.filter(([name]) => name === 'release').map(([, value]) => value.attachmentIds), [
    [attachment(1).id], [attachment(2).id],
  ]);
});

test('attachment metadata bounds and capability checks reject invalid content before creation', () => {
  const source = attachment();
  const normalized = normalizeAttachments([source]); source.name = 'changed';
  assert.equal(normalized[0].name, attachment().name);
  for (const files of [[attachment(), attachment()], [attachment(1, { name: '/private/path' })],
    [attachment(1, { size: -1 })], [attachment(1, { mime: 'invalid' })]]) {
    assert.throws(() => normalizeAttachments(files), (error) => error === 'BROADCAST_ATTACHMENT_INVALID');
  }
  assert.throws(() => normalizeAttachments([attachment(1, { size: attachmentLimits.fileBytes + 1 })]),
    (error) => error === 'BROADCAST_FILE_SIZE_LIMIT');
  assert.throws(() => normalizeAttachments([attachment(1, { size: attachmentLimits.fileBytes }),
    attachment(2, { size: attachmentLimits.fileBytes }), attachment(3)]), (error) => error === 'BROADCAST_FILE_TOTAL_LIMIT');
  const draft = { ...emptyDraft('a'), recipientIds: ['a-ann'], attachments: [attachment()] };
  assert.throws(() => draftPayload(draft, catalog()), (error) => error === 'BROADCAST_ATTACHMENTS_UNAVAILABLE');
  assert.throws(() => draftPayload({ ...draft, tagAll: true }, catalog('a', ready.a)),
    (error) => error === 'BROADCAST_ATTACHMENTS_TAG_ALL');
  for (const code of ['BROADCAST_ATTACHMENT_INVALID', 'BROADCAST_ATTACHMENT_LIMIT',
    'BROADCAST_ATTACHMENT_UNAVAILABLE', 'BROADCAST_ATTACHMENT_CHANGED']) assert.match(errorMessage(code), /附件/);
});
