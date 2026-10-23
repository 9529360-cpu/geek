import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyDraft, normalizeCatalog, matchingChats, draftPayload, submissionFor, previewMessage,
  currentJob, jobSummary, resultRows, jobLabel } from '../frontend/models/broadcast.mjs';
import { errorMessage } from '../frontend/models/broadcast-status.mjs';
import { catalog, job } from './helpers/broadcast.mjs';

test('catalog rejects a different owner and malformed or duplicate recipients', () => {
  assert.throws(() => normalizeCatalog(catalog('b'), 'a'), (error) => error === 'BROADCAST_CATALOG_INVALID');
  const source = catalog();
  source.chats.push(source.chats[0]);
  assert.throws(() => normalizeCatalog(source, 'a'), (error) => error === 'BROADCAST_CATALOG_INVALID');
  assert.throws(() => normalizeCatalog(catalog('a', { catalogId: '' }), 'a'));
  assert.deepEqual(matchingChats(catalog().chats, 'AnN', 'contact').map((chat) => chat.id), ['a-ann']);
  assert.deepEqual(matchingChats(catalog().chats, '', 'group').map((chat) => chat.id), ['a-team']);
});

test('draft resolves only chosen account recipients and never substitutes IDs for names', () => {
  const draft = { ...emptyDraft('a'), recipientIds: ['a-ann', 'a-ann'], message: 'Hi %nc\n%nr' };
  const payload = draftPayload(draft, catalog());
  assert.deepEqual(payload.recipientIds, ['a-ann']);
  assert.equal(payload.message, 'Hi %nc\n%nr');
  assert.equal(payload.scheduledAt, null);
  assert.throws(() => draftPayload({ ...draft, recipientIds: ['b-ann'] }, catalog()), (error) => error === 'BROADCAST_CATALOG_STALE');
  const missing = catalog(); missing.chats[0].name = ''; missing.chats[0].realName = '';
  assert.throws(() => draftPayload(draft, missing), (error) => error === 'BROADCAST_NAME_MISSING');
  assert.throws(() => draftPayload({ ...draft, recipientIds: [] }, catalog()), (error) => error === 'BROADCAST_AUDIENCE_EMPTY');
});

test('capabilities gate vCards and mentions; mentions require text even with a vCard', () => {
  const draft = { ...emptyDraft('a'), recipientIds: ['a-team'], vcardIds: ['a-ann'], message: '' };
  assert.deepEqual(draftPayload(draft, catalog()).vcardIds, ['a-ann']);
  assert.throws(() => draftPayload({ ...draft, tagAll: true }, catalog()), (error) => error === 'BROADCAST_TAG_ALL_REQUIRES_TEXT');
  const unavailable = catalog(); unavailable.capabilities.vcards = false;
  assert.throws(() => draftPayload(draft, unavailable), (error) => error === 'BROADCAST_VCARDS_UNAVAILABLE');
  assert.throws(() => draftPayload({ ...draft, vcardIds: ['a-team'] }, catalog()), (error) => error === 'BROADCAST_CATALOG_STALE');
});

test('invalid intervals and schedules cannot fall back to immediate sending', () => {
  const draft = { ...emptyDraft('a'), recipientIds: ['a-ann'], message: 'hello' };
  for (const [intervalMin, intervalMax] of [[4, 10], [5.5, 10], [20, 10], [5, 61], [NaN, 10]]) {
    assert.throws(() => draftPayload({ ...draft, intervalMin, intervalMax }, catalog()), (error) => error === 'BROADCAST_INTERVAL_INVALID');
  }
  for (const scheduleTime of ['', 'bad', '2000-01-01T00:00']) {
    assert.throws(() => draftPayload({ ...draft, scheduleEnabled: true, scheduleTime }, catalog()),
      (error) => error === 'BROADCAST_SCHEDULE_INVALID');
  }
});

test('retry identity survives catalog refresh but changes when the user edits the intent', () => {
  const payload = draftPayload({ ...emptyDraft('a'), recipientIds: ['a-ann'], message: 'one' }, catalog());
  let calls = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++calls).padStart(12, '0')}`;
  const first = submissionFor(payload, null, uuid);
  assert.equal(submissionFor({ ...payload, catalogId: 'new-context' }, first, uuid), first);
  assert.equal(calls, 1);
  const second = submissionFor({ ...payload, message: 'two' }, first, uuid);
  assert.notEqual(first.id, second.id);
  assert.throws(() => submissionFor(payload, null, () => 'invalid'), (error) => error === 'BROADCAST_ID_UNAVAILABLE');
});

test('preview preserves newlines and previews the first variant without claiming a random send result', () => {
  const text = '%sa %nc\n{Hello|Hi}, %nr';
  assert.equal(previewMessage(text, { name: 'Ann', realName: 'Annie' }, new Date(2026, 0, 1, 9).getTime()), '早上好 Ann\nHello, Annie');
  assert.match(previewMessage('%NC', { id: 'private-chat-id' }), /未提供姓名/);
  assert.equal(errorMessage('private native path /home/example'), errorMessage('BROADCAST_UNKNOWN'));
});

test('job summaries and result evidence remain account scoped and do not label uncertainty as success', () => {
  const a = job(); const b = job('job-b', 'b', { state: 'paused', uncertain: 1, reviewRequired: true });
  const failed = job('failed', 'a', { state: 'failed', createdAt: 2000, lastIssue: 'BROADCAST_INTERRUPTED', fail: 0 });
  assert.equal(currentJob([a, b, failed], 'a').id, 'job-a');
  assert.equal(currentJob([a, b, failed], 'b').id, 'job-b');
  assert.deepEqual(jobSummary([a, b, failed]), { active: 2, running: 1, pending: 0, issues: 2 });
  assert.deepEqual(jobSummary([{ ...a, storageBlocked: true }]), { active: 1, running: 0, pending: 0, issues: 1 });
  assert.equal(resultRows(failed).length, 1);
  assert.equal(jobLabel({ ...a, storageBlocked: true }), '存储故障待处理');
});
