import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaReply, Media, Preview, previewUrl } from './helpers/whatsapp-reply.mjs';

const rejected = (fixture) => assert.throws(fixture.read, { code: 'SEND_INTENT_UNSUPPORTED' });

test('captioned image/video evidence uses only a real loaded model and its exact visible opaque thumbnail', () => {
  for (const type of ['image', 'video']) {
    const fixture = mediaReply({ type, byKey: true });
    const { ui, model, image, adapter } = fixture;
    const value = fixture.read();
    assert.equal(value.quoteBody, model.caption);
    assert.notEqual(value.quoteBody, model.body);
    assert.strictEqual(value.quoteMedia.model, model);
    assert.strictEqual(value.quoteMedia.media, model.mediaData);
    assert.strictEqual(value.quoteMedia.preview, model.mediaData.preview);
    assert.strictEqual(value.quoteMedia.image, image);
    assert.equal(value.quoteMedia.messageId, model.id.toString());
    assert.equal(adapter.allowsImage(image, value.quoteMedia), true);
    assert.equal(adapter.matches(value, fixture.read()), true);
    assert.equal(Object.isFrozen(value.quoteMedia), true);
    assert.equal(Object.isFrozen(value.quoteMedia.values), true);
    assert.equal(ui.state.sent.length, 0); assert.equal(ui.state.cleared.length, 0);
  }
});

test('unproven model, preview, type, view-once and out-of-chat cases cannot become a media reply', () => {
  const cases = [
    (f) => { f.model.type = 'audio'; },
    (f) => { f.model.type = 'document'; },
    (f) => { f.model.isMedia = false; },
    (f) => { f.model.isViewOnce = true; },
    (f) => { f.model.mediaData.isViewOnce = true; },
    (f) => { f.model.replyable = false; },
    (f) => { f.model.isStatusV3 = true; },
    (f) => { f.model.id = f.ui.window.WPP.whatsapp.MsgKey.fromString('false_200@c.us_OTHER'); },
    (f) => { f.model.mediaData = { preview: new Preview(), isViewOnce: false }; },
    (f) => { f.model.mediaData.preview = { released: false, url: () => previewUrl, size: () => 1024, type: () => 'image/jpeg' }; },
    (f) => { f.model.mediaData.preview.released = true; },
    (f) => { f.model.mediaData.mimetype = 'video/mp4'; },
    (f) => { f.model.mimetype = 'image/jpeg\n'; f.model.mediaData.mimetype = f.model.mimetype; },
    (f) => { f.model.filehash = { mutable: true }; },
    (f) => { f.model.filehash = 'h'.repeat(129); f.model.mediaData.filehash = f.model.filehash; },
    (f) => { f.model.mediaData.filehash = 'another-file'; },
    (f) => { f.model.mediaData.type = 'video'; },
    (f) => { f.model.mediaData.preview.url = () => { throw new Error('private runtime failure'); }; },
  ];
  for (const mutate of cases) {
    const fixture = mediaReply(); mutate(fixture); rejected(fixture);
    assert.equal(fixture.ui.state.sent.length, 0); assert.equal(fixture.ui.state.cleared.length, 0);
  }
  const fake = mediaReply();
  assert.throws(() => fake.adapter.read(fake.value(), { ...fake.model }), { code: 'SEND_INTENT_UNSUPPORTED' });
});

test('thumbnail size is bounded and only the same WhatsApp blob is accepted without loading remote URLs or bytes', () => {
  const exact = mediaReply(); exact.model.mediaData.preview.previewSize = 512 * 1024;
  assert.equal(exact.read().quoteMedia.size, 512 * 1024);
  for (const size of [0, -1, 1.5, 512 * 1024 + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const fixture = mediaReply(); fixture.model.mediaData.preview.previewSize = size; rejected(fixture);
  }
  for (const url of ['https://web.whatsapp.com/thumb.jpg', 'blob:https://other.example/00000000-0000-4000-8000-000000000031',
    'data:image/jpeg;base64,YQ==', `${previewUrl}#other`, `${previewUrl}?other`, 'blob:null/opaque']) {
    const fixture = mediaReply(); fixture.model.mediaData.preview.previewUrl = url; fixture.image.setAttribute('src', url); rejected(fixture);
  }
  const svg = mediaReply(); svg.model.mediaData.preview.previewType = 'image/svg+xml'; rejected(svg);
});

test('caption evidence rejects missing, oversized and control text while preserving normal multiline Unicode', () => {
  for (const caption of ['', '   ', undefined, null, 'a'.repeat(10001), 'caption\u0000rest']) {
    const fixture = mediaReply(); fixture.model.caption = caption; rejected(fixture);
  }
  const multiline = mediaReply({ caption: '  商品\r\nblue\titem  ' });
  assert.equal(multiline.read().quoteBody, '商品\nblue\titem');
  const exact = mediaReply({ caption: 'a'.repeat(10000) }); assert.equal(exact.read().quoteBody.length, 10000);
});

test('unrelated, duplicate, interactive or altered image nodes cannot borrow the loaded quote authority', () => {
  const cases = [
    (f) => f.image.setAttribute('src', previewUrl.replace('0031', '0032')),
    (f) => { f.image.currentSrc = previewUrl.replace('0031', '0032'); },
    (f) => { f.image.hidden = true; },
    (f) => f.image.remove(),
    (f) => { const duplicate = f.ui.document.createElement('img'); duplicate.setAttribute('src', previewUrl); f.reply.banner.append(duplicate); },
    (f) => { const link = f.ui.document.createElement('a'); f.reply.banner.append(link); link.append(f.image); },
    (f) => f.image.setAttribute('onclick', 'unexpectedAction()'),
    (f) => f.image.setAttribute('srcset', `${previewUrl} 2x`),
    (f) => f.image.setAttribute('role', 'button'),
    (f) => f.image.setAttribute('alt', 'A different caption'),
    (f) => f.ui.editor.append(f.image),
  ];
  for (const mutate of cases) { const fixture = mediaReply(); mutate(fixture); rejected(fixture); }
});

test('fresh reads detect changed caption, media and DOM identities even before observer delivery', () => {
  for (const mutate of [
    (f) => { f.model.caption = 'Changed caption'; },
    (f) => { f.model.filehash = 'changed-media'; f.model.mediaData.filehash = 'changed-media'; },
    (f) => { f.model.mediaData.preview = new Preview(); },
    (f) => { const image = f.ui.document.createElement('img'); image.setAttribute('src', previewUrl); f.image.replaceWith(image); },
  ]) {
    const fixture = mediaReply(); const before = fixture.read(); mutate(fixture);
    const after = fixture.read(); assert.equal(fixture.adapter.matches(before, after), false);
  }
  const fixture = mediaReply(); const before = fixture.read();
  fixture.image.setAttribute('src', previewUrl.replace('0031', '0032'));
  assert.equal(fixture.adapter.allowsImage(fixture.image, before.quoteMedia), false);
  assert.equal(fixture.adapter.matches({ quoteMedia: null }, before), false);
});

test('media observations catch A-to-B-to-A before polling, rebind nested model changes and fully dispose', () => {
  const fixture = mediaReply(); const { model, adapter } = fixture;
  let changes = 0;
  const dispose = adapter.watch(model, () => { changes += 1; });
  const before = fixture.read();
  const caption = model.caption; model.caption = 'Temporary'; model.caption = caption;
  assert.equal(changes, 2); assert.equal(adapter.matches(before, fixture.read()), true);
  const original = model.mediaData;
  const replacement = new Media();
  model.mediaData = replacement;
  const atReplace = changes;
  replacement.preview = new Preview(); assert.equal(changes, atReplace + 1);
  original.preview = new Preview(); assert.equal(changes, atReplace + 1);
  model.mediaData = original;
  const afterReturn = changes;
  original.filehash = 'other'; original.filehash = 'synthetic-known-media-hash';
  assert.equal(changes, afterReturn + 2);
  dispose(); dispose();
  const end = changes; model.caption = 'After dispose'; original.preview = new Preview(); replacement.preview = new Preview();
  assert.equal(changes, end);
  for (const target of [model, original, replacement]) {
    for (const callbacks of target.handlers.values()) assert.equal(callbacks.size, 0);
  }
});
