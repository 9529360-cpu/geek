'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerPath = path.join(__dirname, '../ui/broadcast-job-controller.js');
const source = fs.readFileSync(controllerPath, 'utf8');

// Product polish must preserve the already-refined formal editor rather than replace it.
assert.doesNotMatch(source, /#broadcast-overlay\s*\{/, 'job controller must not replace the formal compact broadcast editor');
assert.doesNotMatch(source, /aria-modal.*false|workspace side sheet|编辑群发 · 聊天页面保持可见/, 'controller must not turn the formal editor into a side sheet');
assert.doesNotMatch(source, /applyCopyAndSemantics|refreshSummary|selectedCount\(/, 'controller must not own formal editor copy or footer summaries');

// Sending feedback should stay compact and get the editor out of the way after job creation.
assert.match(source, /width:min\(350px,calc\(100vw - 36px\)\)/, 'task feedback must remain a compact upper-right surface');
assert.match(source, /if \(jobId && jobId !== runtime\.lastJobId\)[\s\S]*overlay\.classList\.add\('hidden'\)/, 'newly created jobs must close the editor and return the chat workspace');
assert.match(source, /正在群发 \$\{current\} \/ \$\{total\}/, 'task bar must retain concise progress text');
assert.match(source, /成功 \$\{ok\} · 失败 \$\{fail\}/, 'task bar must retain concise success/failure counts');
assert.match(source, /下一条 \$\{nextSeconds\} 秒后/, 'task bar must retain useful interval feedback without recipient-detail clutter');

// Terminal UX must have an explicit Close action while keeping failure detail available.
assert.match(source, /createButton\('dismiss', '关闭', 'hidden'\)/, 'terminal task must expose an explicit close button');
assert.match(source, /dismiss\.classList\.toggle\('hidden', !terminal\)/, 'explicit close must appear only after the job ends');
assert.match(source, /createButton\('failures', '查看失败', 'hidden'\)/, 'failed recipients must remain inspectable');

// Heavy redesign elements rejected in real-client testing must not return.
assert.doesNotMatch(source, /bc-job-stats|createStat\(|bc-job-activity|targetContext\(|job\.targets/, 'task bar must not grow back into a stats/recipient dashboard');
assert.doesNotMatch(source, /observe\(document\.body/, 'controller must not observe the full document body');
assert.doesNotMatch(source, /getElementById\('bc-preview-name'\)|getElementById\('bc-countdown'\)|getElementById\('bc-sent-count'\)|broadcast-progress-text/, 'task bar must not scrape legacy sending-page state');

console.log('BROADCAST_PRODUCT_POLISH_CONTRACT_OK');
