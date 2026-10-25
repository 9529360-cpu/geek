import test from 'node:test';
import assert from 'node:assert/strict';
import { dom } from './helpers/dom.mjs';
import { createContactNotesController } from '../frontend/controllers/contact-notes.mjs';

function setup({ beforeWrite = async () => {}, contextFor = async () => ({ available: true, chat: { id: 'customer' } }) } = {}) {
  const ui = dom();
  let snapshot = { activeId: 'a', accounts: ['a', 'b'].map(id => ({ id, platformId: 'whatsapp' })),
    platforms: [{ id: 'whatsapp', family: 'whatsapp' }] };
  const records = new Map();
  const writes = [];
  let fail = false;
  const api = {
    translationContext: contextFor,
    contactNotes: async id => records.get(id) || null,
    contactNotesUpdate: async (id, identity, note) => {
      await beforeWrite();
      if (fail) throw 'CONTACT_NOTES_PERSISTENCE';
      writes.push({ id, identity, note }); records.set(id, note);
    },
  };
  let controller;
  controller = createContactNotesController({ document: ui.document, api,
    getShellSnapshot: () => snapshot,
    showPanel: async id => controller.panelChanged(id),
    hidePanel: async () => controller.panelChanged(null) });
  controller.renderShell(snapshot);
  const click = async id => { ui.get(id).fire('click'); await controller.idle(); };
  return { ...ui, records, writes, controller, click,
    fail: value => { fail = value; },
    switch: id => { snapshot = { ...snapshot, activeId: id }; controller.renderShell(snapshot); } };
}

test('original note fields load, save durably per account, reopen and delete', async () => {
  const f = setup();
  await f.click('btn-contact-notes');
  f.get('contact-notes-name').value = 'Alice';
  f.get('contact-notes-text').value = 'First line\nSecond line';
  await f.click('contact-notes-save');
  assert.equal(f.writes[0].id, 'a');
  assert.equal(f.writes[0].note.name, 'Alice');
  assert.equal(f.writes[0].note.notes, 'First line\nSecond line');
  await f.click('contact-notes-close');
  await f.click('btn-contact-notes');
  assert.equal(f.get('contact-notes-name').value, 'Alice');
  f.switch('b'); await f.controller.idle();
  assert.equal(f.get('contact-notes-name').value, '');
  f.switch('a'); await f.controller.idle();
  assert.equal(f.get('contact-notes-name').value, 'Alice');
  await f.click('contact-notes-delete');
  assert.equal(f.get('contact-notes-name').value, '');
  f.controller.dispose();
});

test('a late save cannot repaint another account and duplicate saves are ignored', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = setup({ beforeWrite: () => pending });
  await f.click('btn-contact-notes');
  f.get('contact-notes-name').value = 'Owner A';
  f.get('contact-notes-save').fire('click');
  f.get('contact-notes-save').fire('click');
  f.switch('b');
  await new Promise(resolve => setImmediate(resolve));
  release();
  await f.controller.idle();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].id, 'a');
  assert.equal(f.get('contact-notes-name').value, '');
  f.controller.dispose();
});

test('switching accounts clears private fields before the new chat context resolves', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = setup({ contextFor: id => id === 'b' ? pending
    : Promise.resolve({ available: true, chat: { id: 'customer' } }) });
  await f.click('btn-contact-notes');
  f.get('contact-notes-name').value = 'Private owner A';
  f.get('contact-notes-text').value = 'Private draft';
  f.switch('b');
  const fields = [f.get('contact-notes-name').value, f.get('contact-notes-text').value];
  release({ available: false });
  await f.controller.idle();
  f.controller.dispose();
  assert.deepEqual(fields, ['', '']);
});

test('failed persistence keeps draft and requires another explicit save', async () => {
  const f = setup();
  await f.click('btn-contact-notes');
  f.get('contact-notes-name').value = 'Draft';
  f.fail(true);
  await f.click('contact-notes-save');
  assert.equal(f.get('contact-notes-name').value, 'Draft');
  assert.match(f.get('contact-notes-status').textContent, /保存失败/);
  assert.equal(f.writes.length, 0);
  f.fail(false);
  await f.click('contact-notes-save');
  assert.equal(f.writes.length, 1);
  f.controller.dispose();
});
