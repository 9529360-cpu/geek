'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runtimePath = path.join(__dirname, '../ui/broadcast-runtime.js');
const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '../ui/app.js'), 'utf8');
const runtime = require(runtimePath);

assert.deepEqual(runtime.selectedChatIds({ __geekBroadcastSelection: { ids: () => ['a', 'b', 'a', ''] } }), ['a', 'b']);
assert.throws(() => runtime.selectedChatIds({}), /选择状态尚未就绪/, 'missing selection state must fail closed');
assert.match(runtimeSource, /mode === 'all'\) targets = chats\.slice\(\)/, 'all mode must resolve from the full chat snapshot');
assert.match(runtimeSource, /mode === 'all-contacts'\) targets = chats\.filter/, 'all contacts must not depend on rendered selection chips');
assert.match(runtimeSource, /const unique = new Map\(\)/, 'resolved recipients must be deduplicated before creating a job');
assert.match(runtimeSource, /sendDirectFiles[\s\S]*job\.vcards\.length/, 'attachments and vCards must coexist in the same direct-send job');
assert.match(runtimeSource, /if \(files\.length\) break;/, 'direct attachment failures must not restart the entire file batch');
assert.match(runtimeSource, /startsWith\('UNKNOWN:'\)\) break/, 'indeterminate sends must not be retried automatically');
assert.match(runtimeSource, /电子名片群发仅支持 WhatsApp/, 'unsupported vCard delivery must fail before job creation');
assert.match(runtimeSource, /!message\.trim\(\) && !files\.length && !vcards\.length/, 'a vCard-only WhatsApp job must be allowed');
assert.match(runtimeSource, /号码与 CSV 群发仅支持 WhatsApp/, 'raw number modes must not create invalid Telegram or LINE targets');
assert.match(appSource, /if \(!bcAddVcard\.checked\)[\s\S]*__vcardContacts = \[\]/, 'turning vCard delivery off must clear the pending vCards');
assert.match(appSource, /runtimeFiles\.length > 0[\s\S]*__vcardContacts/, 'readiness summary must include runtime attachments and vCard-only jobs');
assert.doesNotMatch(appSource, /id: 'submitted'/, 'a WhatsApp timeout must never be reported as a confirmed send');
assert.match(appSource, /telegram: `\(\(\) => String\(location\.hash \|\| ''\) \|\| null\)\(\)`/, 'Telegram chat verification must retain its p query parameter');

(async () => {
  const calls = [];
  const attempts = new Map();
  const files = [{ name: 'a.png', filePath: 'a' }, { name: 'b.png', filePath: 'b' }];
  const result = await runtime.sendDirectFiles(async payload => {
    calls.push(payload.filePath);
    const count = (attempts.get(payload.filePath) || 0) + 1;
    attempts.set(payload.filePath, count);
    return payload.filePath === 'b' && count === 1 ? 'ERR:TEMP' : 'SENT';
  }, { partition: 'p' }, { id: 'chat' }, files, 'caption');
  assert.equal(result, 'SENT');
  assert.deepEqual(calls, ['a', 'b', 'b'], 'retry must resend only failed files, never successful attachments');
  console.log('BROADCAST_FUNCTIONAL_COMPLETION_CONTRACT_OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
