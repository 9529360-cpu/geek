'use strict';
const assert = require('node:assert/strict');
const capability = require('../ui/whatsapp-send-intent-capability.js');

function makeWebview({ advance = true } = {}) {
  const calls = [];
  let poll = 0;
  return {
    calls,
    getWebContentsId() { return 17; },
    async executeJavaScript(script) {
      calls.push(script);
      if (script.includes("return editor?.innerText")) return 'hello';
      if (script.includes("document.execCommand('selectAll'")) return true;
      if (script.includes("return {status:'READY'")) return { status: 'READY', count: 4 };
      if (script.includes('const expectedChat=')) {
        poll += 1;
        if (advance && poll >= 2) return { status: 'OK', count: 5, empty: true };
        return { status: 'OK', count: 4, empty: advance };
      }
      return true;
    },
  };
}

(async () => {
  const oldWindow = global.window;
  let insertCalls = 0;
  let commitCalls = 0;
  global.window = { api: { webviewInput: {
    async insertText(accountId, guestId, text, token, conversationId) {
      insertCalls += 1;
      assert.deepEqual([accountId, guestId, text, token, conversationId], ['a1', 17, 'hello', 'tok', 'chat-1']);
      return true;
    },
    async commitSubmit(accountId, guestId, chatId, text, token) {
      commitCalls += 1;
      assert.deepEqual([accountId, guestId, chatId, text, token], ['a1', 17, 'chat-1', 'hello', 'tok']);
      return 'SUBMITTED';
    },
  } } };
  try {
    const sent = makeWebview({ advance: true });
    assert.equal(await capability.setComposerText({ account:{id:'a1'}, wv:sent, text:'hello', mutation:{expectedConversationId:'chat-1'}, bridgeToken:'tok', sleep:async()=>{} }), 'OK');
    assert.equal(await capability.sendText({ account:{id:'a1'}, wv:sent, commit:{expectedConversationId:'chat-1',expectedComposerText:'hello'}, bridgeToken:'tok', sleep:async()=>{} }), 'SENT');
    assert.equal(insertCalls, 1);
    assert.equal(commitCalls, 1, 'successful SendIntent must dispatch exactly one native commit');

    commitCalls = 0;
    const uncertain = makeWebview({ advance: false });
    assert.equal(await capability.sendText({ account:{id:'a1'}, wv:uncertain, commit:{expectedConversationId:'chat-1',expectedComposerText:'hello'}, bridgeToken:'tok', sleep:async()=>{} }), 'MAYBE');
    assert.equal(commitCalls, 1, 'uncertain native commit must never be retried');
  } finally {
    global.window = oldWindow;
  }
  console.log('WHATSAPP_SEND_INTENT_CAPABILITY_CONTRACT_OK');
})().catch(error => { console.error(error?.stack || error); process.exit(1); });
