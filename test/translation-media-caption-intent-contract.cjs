'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ui/app.js'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'src/translation-runtime.cjs'), 'utf8');

// The WhatsApp media-caption path wraps WAWebMediaPrep.sendMediaMsgToChat and
// awaits a caption translation BEFORE the media send runs. That translation is
// user-initiated outgoing work (#520 req 2): it must carry explicit
// outgoing-send intent so the host scheduler admits it against the reserved
// interactive capacity. Without the tag, the host default (message-display)
// schedules it as droppable background work, and a background burst can make
// the user's media send fail with '配文翻译失败' for a scheduling reason.
assert.match(
  app,
  /sendMediaMsgToChat = async function[\s\S]*?__geekTranslationRequest\(\{text:options\.caption[\s\S]*?intent: 'outgoing-send'/,
  'media caption translation on the outgoing send path must carry explicit outgoing-send intent',
);

// The page-side bridge wrapper defaults untagged requests to message-display,
// and the host runtime normalizes the same way (see below). That is exactly
// why the call-site tag above is load-bearing and must not be dropped in a
// refactor: without it, this outgoing translation falls back to background.
assert.match(
  app,
  /const intent = body\.intent === 'outgoing-send' \? 'outgoing-send' : 'message-display'/,
  'page bridge must keep defaulting untagged requests to message-display',
);

// The runtime must keep normalizing the carried intent instead of inferring it
// from language, DOM shape, focus, or missing fields (#520 req 5).
assert.match(
  runtime,
  /normalizeTranslationIntent\(body\.intent\)/,
  'runtime must normalize the carried intent',
);

console.log('TRANSLATION_MEDIA_CAPTION_INTENT_CONTRACT_OK');
