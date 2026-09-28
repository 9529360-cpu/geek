'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installPageController } = require('../ui/whatsapp-direct-composer-controller.js');

function fixture(activeId='123@g.us', resultFactory=payload=>({text:'translated:'+payload.text,delivery:{owner:'send-intent',state:'sent'}})) {
  let active=activeId;
  const calls=[];
  const editor={nodeType:1,innerText:'group source',textContent:'group source',isConnected:true,focus(){},closest(){return this;}};
  const document={
    documentElement:{getAttribute(){return '';}},
    addEventListener(){},
    querySelector(){return editor;},
    getElementById(){return null;},
    createElement(){return {style:{},remove(){}};},
    body:{appendChild(){}},
  };
  const page={
    AbortController,document,console:{error(){}},clearInterval(){},setTimeout(){},
    WPP:{chat:{getActiveChat(){return {id:{_serialized:active},isGroup:true};}}},
    async __geekTranslationRequest(payload){calls.push(payload);return resultFactory(payload);},
    __geekRememberOutgoing(){},
  };
  installPageController(page);
  return {page,editor,calls,switchTo(id){active=id;}};
}
function trustedEvent(editor){return{isTrusted:true,target:editor,preventDefault(){},stopImmediatePropagation(){}};}

(async()=>{
  const f=fixture();
  assert.equal(await f.page.__geekWhatsAppDirectComposerController.submitThroughOwner(trustedEvent(f.editor),f.editor),true);
  assert.equal(f.calls.length,1);
  assert.deepEqual(f.calls[0],{text:'group source',chatId:'123@g.us',intent:'outgoing-send'},'group composer must bind the active group identity into SendIntent');

  const g=fixture('456@g.us');
  assert.equal(await g.page.__geekWhatsAppDirectComposerController.submitThroughOwner(trustedEvent(g.editor),g.editor),true);
  assert.equal(g.calls[0].chatId,'456@g.us','each group send must bind the currently active group');

  const failed=fixture('123@g.us',()=>Promise.reject(Object.assign(new Error('no quota'),{code:'QUOTA_EXHAUSTED'})));
  assert.equal(await failed.page.__geekWhatsAppDirectComposerController.submitThroughOwner(trustedEvent(failed.editor),failed.editor),false,'failed group transform must remain fail-closed');

  const root=path.join(__dirname,'..');
  const app=fs.readFileSync(path.join(root,'ui/app.js'),'utf8');
  const controller=fs.readFileSync(path.join(root,'ui/whatsapp-direct-composer-controller.js'),'utf8');
  const capability=fs.readFileSync(path.join(root,'ui/whatsapp-send-intent-capability.js'),'utf8');
  assert.match(app,/resolveTranslationPolicyForAccount\(account, wv, conversationId\)/,'group/private per-chat translation policy must resolve from the exact SendIntent chat identity');
  assert.match(app,/contact\.getPnLidEntry/,'WhatsApp policy resolver must preserve LID-to-PN chat override compatibility');
  assert.match(app,/chatConfigs\[configKey\] \|\| \{\}/,'resolved WhatsApp alias must feed the shared TranslationCore policy normalization');
  assert.match(capability,/webviewInput\.commitSubmit/,'group composer final commit must stay native so quote/mention composer state remains owned by WhatsApp');
  assert.doesNotMatch(controller,/sendTextMessage|sendTextMsgToChat|quotedMsg|mentionedJidList/,'composer owner must not rebuild group-send options or take over broadcast/publication APIs');

  console.log('WHATSAPP_GROUP_TRANSLATION_CONTRACT_OK');
})().catch(error=>{console.error(error?.stack||error);process.exit(1);});
