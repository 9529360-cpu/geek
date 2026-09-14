'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'proxy-dialog-accessibility.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'ui', 'proxy-dialog-accessibility.css'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'ui', 'version-label.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');

assert.match(app, /document\.getElementById\('proxy-save'\)\.onclick=async\(\)=>/, 'app.js must remain the proxy save owner');
assert.match(app, /window\.api\.accounts\.update\(proxyAccountId/, 'proxy persistence must remain in app.js');
assert.match(app, /if\(enabled&&\(!host\|\|!\/\^\\d\+\$\/\.test\(port\)/, 'legacy validation must remain as compatibility fallback');

assert.match(bootstrap, /proxy-dialog-accessibility\.css/, 'shell bootstrap must load proxy validation styles');
assert.match(bootstrap, /proxy-dialog-accessibility\.js/, 'shell bootstrap must load proxy dialog accessibility owner');
assert.match(source, /setAttribute\('role', 'dialog'\)/, 'proxy surface must expose dialog semantics');
assert.match(source, /setAttribute\('aria-modal', 'true'\)/, 'proxy surface must announce modal semantics');
assert.match(source, /setAttribute\('role', 'status'\)/, 'validation feedback must be exposed as status');
assert.match(source, /setAttribute\('aria-live', 'polite'\)/, 'validation feedback must be announced without stealing focus');
assert.match(source, /setAttribute\('aria-invalid'/, 'invalid fields must expose aria-invalid');
assert.match(source, /setAttribute\('aria-errormessage', STATUS_ID\)/, 'invalid fields must be associated with visible error text');
assert.match(source, /validationAttempted = true/, 'fields must not be marked invalid before a submit attempt');
assert.match(source, /focusInvalid/, 'failed submission must focus the first actionable invalid field');
assert.match(source, /event\.stopImmediatePropagation\(\)/, 'invalid submission must stop the legacy alerting save handler');
assert.match(source, /event\.key === 'Escape'/, 'Escape must reuse the existing cancel control');
assert.match(source, /getElementById\('proxy-cancel'\)\?\.click\(\)/, 'Escape must close through the existing app owner');
assert.match(source, /event\.key !== 'Tab'/, 'proxy dialog must own Tab containment');
assert.match(source, /event\.shiftKey/, 'proxy dialog must support reverse Tab cycling');
assert.doesNotMatch(source, /window\.api|accounts\.update|proxyAccountId/, 'proxy UX owner must not duplicate persistence or account business state');
assert.doesNotMatch(source, /\balert\s*\(|window\.alert/, 'proxy validation owner must never open a system alert');

assert.match(styles, /\[aria-invalid='true'\]/, 'invalid fields need visible styling');
assert.match(styles, /:focus-visible/, 'proxy controls need visible keyboard focus');
assert.match(styles, /prefers-reduced-motion:\s*reduce/, 'proxy dialog polish must respect reduced motion');

console.log('PROXY_DIALOG_ACCESSIBILITY_CONTRACT_OK');
