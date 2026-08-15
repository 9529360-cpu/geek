const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const extensionRoot = path.resolve(__dirname, '..', 'resources', 'extensions', 'line-3.5.1');
const indexSource = fs.readFileSync(path.join(extensionRoot, 'index.html'), 'utf8');
const mainSource = fs.readFileSync(path.join(extensionRoot, 'static', 'js', 'main.js'), 'utf8');
assert.match(indexSource, /geek-authenticated-event-source\.js/, 'LINE 页面必须加载认证 EventSource');
assert.ok(
  indexSource.indexOf('geek-authenticated-event-source.js') < indexSource.indexOf('/static/js/main.js'),
  '认证 EventSource 必须在 LINE 主脚本前加载'
);
assert.match(mainSource, /window\.g_plugin_hmac = sx/, 'LINE 必须暴露官方 HMAC manager 给认证事件流');
assert.match(mainSource, /new window\.GeekAuthenticatedEventSource/, 'LINE SSE transport 必须使用认证事件流');

const calls = [];
const encoder = new TextEncoder();
const chunks = [
  'event: ping\ndata: {"ok":1}\n\n',
  'id: 7\ndata: hello\n\n'
];
let chunkIndex = 0;

class FakeEvent {
  constructor(type) { this.type = type; }
}
class FakeMessageEvent extends FakeEvent {
  constructor(type, init = {}) { super(type); Object.assign(this, init); }
}

global.Event = FakeEvent;
global.MessageEvent = FakeMessageEvent;
global.window = {
  g_plugin_enc: () => ({ getAccessToken: () => 'token-123' }),
  g_plugin_hmac: () => ({ getHmac: async ({ accessToken, path, body }) => {
    calls.push({ kind: 'hmac', accessToken, path, body });
    return 'hmac-456';
  } }),
  fetch: async (url, options) => {
    calls.push({ kind: 'fetch', url, options });
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => chunkIndex < chunks.length
            ? { done: false, value: encoder.encode(chunks[chunkIndex++]) }
            : { done: true, value: undefined }
        })
      }
    };
  }
};

const AuthenticatedEventSource = require(path.resolve(
  __dirname,
  '..',
  'resources',
  'extensions',
  'line-3.5.1',
  'static',
  'js',
  'geek-authenticated-event-source.js'
));

(async () => {
  const source = new AuthenticatedEventSource(
    'https://line-chrome-gw.line-apps.com/api/operation/receive?localRev=1',
    { withCredentials: true }
  );
  const received = [];
  source.addEventListener('open', () => received.push(['open']));
  source.addEventListener('ping', event => received.push(['ping', event.data]));
  source.addEventListener('message', event => received.push(['message', event.data, event.lastEventId]));

  await source.completed;

  assert.deepEqual(received, [
    ['open'],
    ['ping', '{"ok":1}'],
    ['message', 'hello', '7']
  ]);
  assert.deepEqual(calls[0], {
    kind: 'hmac',
    accessToken: 'token-123',
    path: '/api/operation/receive?localRev=1',
    body: undefined
  });
  assert.equal(calls[1].options.headers['X-Line-Access'], 'token-123');
  assert.equal(calls[1].options.headers['X-Hmac'], 'hmac-456');
  assert.equal(calls[1].options.credentials, 'include');
  assert.equal(source.readyState, AuthenticatedEventSource.CLOSED);
  console.log('LINE_AUTHENTICATED_EVENT_SOURCE_OK');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
