'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'ui', 'style.css'), 'utf8');

assert.match(app, /function beginTranslationSendFeedback\(\)/);
assert.match(app, /function endTranslationSendFeedback\(\)/);
assert.match(app, /正在翻译并发送…/);
assert.match(app, /translationFeedbackActive = translate \? beginTranslationSendFeedback\(\) : false/, 'identity sends must not flash translation progress');
assert.match(app, /finally \{[\s\S]*if \(translationFeedbackActive\) endTranslationSendFeedback\(\)/, 'success, failure and cancellation must close feedback');
assert.match(app, /setAttribute\('role', 'status'\)/);
assert.match(app, /setAttribute\('aria-live', 'polite'\)/);
assert.match(css, /\.translation-send-progress \{/);
assert.match(css, /pointer-events: none/);
assert.match(css, /prefers-reduced-motion: reduce/);

console.log('TRANSLATION_SEND_FEEDBACK_CONTRACT_OK');
