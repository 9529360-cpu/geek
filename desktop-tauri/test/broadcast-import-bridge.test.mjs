import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { fixture, wid, chat, deferred } = require('./platform-bridge-fixture.cjs');

const phone = '60123456789', pn = `${phone}@c.us`, lid = '123456789@lid';
function setup() {
  const f = fixture();
  const queries = [], finds = [];
  f.WPP.contact.queryExists = async (id) => {
    queries.push(id);
    return { wid: wid(pn), lid: wid(lid), name: 'Untrusted lookup name' };
  };
  f.WPP.chat.find = async (id) => {
    finds.push(id);
    const model = chat(id, { name: '真实联系人', contact: { pushname: '实际昵称' } });
    f.models.set(id, model);
    return model;
  };
  return { ...f, queries, finds };
}
async function resolve(f, candidates = [phone]) {
  const call = f.start('resolveContacts', { candidates });
  assert.equal(call.accepted, true);
  await f.flush();
  return f.read(call.id);
}

test('directory-external numbers become a loaded canonical chat without sending or switching chats', async () => {
  const f = setup();
  assert.equal(f.models.has(lid), false);
  const active = String(f.WPP.chat.getActiveChat().id);
  const result = await resolve(f);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.value, [{ candidate: phone, chat: {
    id: lid, kind: 'contact', name: '真实联系人', realName: '实际昵称',
  } }]);
  assert.deepEqual(f.queries, [pn]);
  assert.deepEqual(f.finds, [lid]);
  assert.equal(String(f.WPP.chat.getActiveChat().id), active);
  const call = f.start('prepare', f.draft({ targetId: lid }));
  await f.flush();
  assert.deepEqual(f.read(call.id).value, { prepared: true });
  assert.deepEqual(f.sends, []);
});

test('phone and explicit LID resolve to the same canonical target for native deduplication', async () => {
  const f = setup();
  const result = await resolve(f, [phone, lid]);
  assert.deepEqual(result.value.map((row) => row.chat.id), [lid, lid]);
  assert.deepEqual(result.value.map((row) => row.candidate), [phone, lid]);
  assert.deepEqual(f.sends, []);
});

test('null, unrelated query identities and unsupported models remain unverified', async () => {
  for (const found of [null, { wid: wid('other@c.us') }, { wid: wid('999999@c.us') }]) {
    const f = setup();
    f.WPP.contact.queryExists = () => found;
    assert.deepEqual((await resolve(f)).value, [{ candidate: phone, chat: null }]);
    assert.deepEqual(f.finds, []);
  }
  for (const fields of [{ isGroup: true }, { isNewsletter: true }, { isBroadcast: true }, { isParentGroup: true }]) {
    const f = setup();
    f.WPP.chat.find = (id) => { const model = chat(id, fields); f.models.set(id, model); return model; };
    assert.equal((await resolve(f)).value[0].chat, null);
    assert.deepEqual(f.sends, []);
  }
});

test('a different loaded model requires an independently matching PN/LID pair', async () => {
  const f = setup();
  f.WPP.contact.queryExists = () => ({ wid: wid(lid) });
  f.WPP.chat.find = () => { const model = chat(pn); f.models.set(pn, model); return model; };
  f.WPP.contact.getPnLidEntry = () => ({ phoneNumber: wid(pn), lid: wid(lid) });
  assert.equal((await resolve(f, [lid])).value[0].chat.id, pn);
  f.WPP.contact.getPnLidEntry = () => ({ phoneNumber: wid(pn), lid: wid('8888@lid') });
  assert.equal((await resolve(f, [lid])).value[0].chat, null);
  f.WPP.contact.getPnLidEntry = () => ({ phoneNumber: wid(pn) });
  assert.equal((await resolve(f, [lid])).value[0].chat, null);
});

test('names come only from the loaded model and never fall back to numbers or query fields', async () => {
  const f = setup();
  f.WPP.chat.find = (id) => {
    const model = chat(id, { name: id, formattedTitle: '+60 123456789', contact: {} });
    f.models.set(id, model); return model;
  };
  assert.deepEqual((await resolve(f)).value[0].chat,
    { id: lid, kind: 'contact', name: '', realName: '' });
});

test('cancelled or revoked requests never find a chat or continue to the next candidate', async () => {
  for (const cancel of [(f, call) => f.bridge.cancel(f.generation, call.id),
    (f) => f.bridge.revoke(f.generation)]) {
    const f = setup(), pending = deferred();
    f.WPP.contact.queryExists = (id) => { f.queries.push(id); return pending.promise; };
    const call = f.start('resolveContacts', { candidates: [phone, '60123456780'] });
    await f.flush();
    cancel(f, call);
    pending.resolve({ wid: wid(pn), lid: wid(lid) });
    await f.flush();
    assert.deepEqual(f.queries, [pn]);
    assert.deepEqual(f.finds, []);
    assert.deepEqual(f.sends, []);
    assert.equal(f.read(call.id), null);
  }
});

test('timed out lookup is bounded and its late reply cannot start another lookup', async () => {
  const f = setup(), pending = deferred();
  f.WPP.contact.queryExists = (id) => { f.queries.push(id); return pending.promise; };
  const call = f.start('resolveContacts', { candidates: [phone, '60123456780'] });
  await f.advance(5001);
  assert.equal(f.read(call.id).error, 'TIMED_OUT');
  pending.resolve({ wid: wid(pn), lid: wid(lid) });
  await f.flush();
  assert.deepEqual(f.queries, [pn]);
  assert.deepEqual(f.finds, []);
  assert.deepEqual(f.sends, []);
});

test('batch bounds and explicit candidate formats are checked before any lookup', async () => {
  for (const candidates of [[], [phone, phone], [phone, lid, pn], ['123@g.us'],
    ['number:60123456789'], ['+60 123456789'], ['12345'], [null]]) {
    const f = setup();
    assert.equal((await resolve(f, candidates)).error, 'CAPABILITY_UNAVAILABLE');
    assert.deepEqual(f.queries, []);
    assert.deepEqual(f.finds, []);
  }
});
