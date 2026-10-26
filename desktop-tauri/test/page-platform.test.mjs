import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../guest/page-input.js', import.meta.url), 'utf8');

function load(location) {
  const window = { location };
  const context = { window, document: { querySelectorAll: () => [] }, location };
  context.globalThis = context;
  runInNewContext(source, context, { timeout: 1000 });
  return context;
}

test('page conversation ids keep the owned thread shape and drop everything else', () => {
  const page = load({ protocol: 'https:', hostname: 'www.facebook.com', pathname: '/messages/t/thread-1',
    hash: '', search: '', username: '', password: '' });
  assert.equal(page.messengerConversationId('/messages/t/thread-1'), '/messages/t/thread-1');
  assert.equal(page.messengerConversationId('/messages/e2ee/t/abc.DEF_1'), '/messages/e2ee/t/abc.DEF_1');
  assert.equal(page.messengerConversationId('/messages/t/../secret'), '');
  assert.equal(page.messengerConversationId('/messages/t/a/b'), '');
  assert.equal(page.instagramConversationId('/direct/t/thread-1'), '/direct/t/thread-1');
  assert.equal(page.instagramConversationId('/direct/inbox/'), '');
  assert.equal(page.telegramAPeer('#123'), 'tg:123');
  assert.equal(page.telegramAPeer('#-100123'), 'tg:-100123');
  assert.equal(page.telegramAPeer('#username'), '');
  assert.equal(page.telegramAPeer('#0'), '');
  assert.equal(page.pageOwned('messenger'), true);
  assert.equal(page.pageOwned('instagram'), false);
  assert.equal(page.pageOwned('telegram-a'), false);
  const line = load({ protocol: 'chrome-extension:', hostname: 'ophjlpahpchlmihnnnihgmmeilfjmjjc',
    pathname: '/index.html', hash: '#/chats/abcd1234', search: '', username: '', password: '' });
  assert.equal(line.pageOwned('line'), true);
  assert.equal(line.lineToken('abcd1234'), 'ln:abcd1234');
  assert.equal(line.lineToken('bad id'), '');
  assert.equal(line.lineToken('12025550123@c.us'), '');
  assert.equal(line.pageConversationId('line'), 'ln:abcd1234');
  const queried = load({ protocol: 'https:', hostname: 'web.whatsapp.com', pathname: '/', hash: '', search: '',
    username: '', password: '' });
  assert.equal(queried.pageOwned('line'), false);
});
