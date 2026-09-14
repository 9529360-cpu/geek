'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'ui', 'first-run-onboarding.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'ui', 'first-run-onboarding.css'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'ui', 'version-label.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ui', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');

assert.match(html, /id="empty-state"/, 'existing empty-state owner must remain in markup');
assert.match(app, /emptyState\.style\.display = 'flex'/, 'app.js must remain the authority for when the empty state is visible');
assert.match(app, /addBtn\.onclick = \(\) => openAddDialog\(\)/, 'App Center must remain the add-dialog business entry owner');
assert.match(app, /card\.onclick = \(\) => \{[\s\S]*addSelectedType = p\.type/, 'app.js must remain the platform-selection business owner');
assert.match(app, /if \(!type\) \{ alert\('请先选择一个平台'\); return; \}/, 'legacy native warning must remain only as compatibility fallback');
assert.match(app, /window\.api\.accounts\.add/, 'account creation must remain in app.js');
assert.match(bootstrap, /first-run-onboarding\.css/, 'shell bootstrap must load first-run onboarding styles');
assert.match(bootstrap, /first-run-onboarding\.js/, 'shell bootstrap must load first-run onboarding behavior');

assert.match(source, /id = 'empty-add-account'|button\.id = 'empty-add-account'/, 'empty state must expose a direct add-account action');
assert.match(source, /button\.addEventListener\('click', \(\) => appCenter\.click\(\)\)/, 'empty CTA must reuse the canonical App Center click owner');
assert.match(source, /empty\.setAttribute\('role', 'region'\)/, 'empty onboarding must expose a named region');
assert.match(source, /empty\.setAttribute\('aria-labelledby'/, 'empty onboarding must use its visible heading as accessible name');
assert.match(source, /dialog\.setAttribute\('role', 'dialog'\)/, 'add-account surface must expose dialog semantics');
assert.match(source, /platforms\.setAttribute\('role', 'radiogroup'\)/, 'platform choices must expose a radiogroup');
assert.match(source, /card\.setAttribute\('role', 'radio'\)/, 'platform cards must expose radio semantics');
assert.match(source, /card\.setAttribute\('aria-checked'/, 'platform selection state must be programmatic');
assert.match(source, /card\.setAttribute\('tabindex'/, 'platform cards must use roving keyboard focus');
assert.match(source, /ArrowRight|ArrowDown/, 'platform chooser must support forward arrow navigation');
assert.match(source, /ArrowLeft|ArrowUp/, 'platform chooser must support reverse arrow navigation');
assert.match(source, /event\.key !== 'Enter' && event\.key !== ' '/, 'platform cards must support Enter and Space activation');
assert.match(source, /cards\[next\]\.click\(\)|card\.click\(\)/, 'keyboard selection must reuse the existing click owner');

assert.match(source, /confirm\.addEventListener\('click',[\s\S]*true\)/, 'missing-platform validation must run before the legacy onclick owner');
assert.match(source, /event\.stopImmediatePropagation\(\)/, 'invalid add submission must not reach the native alert fallback');
assert.match(source, /请选择一个平台继续/, 'missing platform must have actionable inline guidance');
assert.match(source, /setAttribute\('role', 'status'\)/, 'add validation must reuse an accessible status surface');
assert.match(source, /first\?\.focus/, 'invalid submission must focus the first actionable platform');
assert.match(source, /event\.key === 'Escape'/, 'Escape must close through the existing cancel control');
assert.match(source, /getElementById\('add-cancel'\)\?\.click\(\)/, 'Escape must reuse the canonical add-dialog close owner');
assert.match(source, /event\.key !== 'Tab'/, 'add dialog must contain Tab navigation');
assert.match(source, /event\.shiftKey/, 'add dialog must support reverse Tab cycling');
assert.match(source, /restoreInvokerFocus/, 'cancelling onboarding must return focus to the invoking action');
assert.doesNotMatch(source, /window\.api|accounts\.add|addSelectedType|openAddDialog|\balert\s*\(|window\.alert/, 'onboarding UX must not duplicate account creation, selection authority, or native messaging');

assert.match(styles, /\.empty-onboarding-action/, 'empty state must visually expose the primary action');
assert.match(styles, /\[role='radio'\]\[aria-checked='true'\]/, 'selected platform must have a visible state');
assert.match(styles, /:focus-visible/, 'onboarding controls need visible keyboard focus');
assert.match(styles, /prefers-reduced-motion:\s*reduce/, 'onboarding polish must respect reduced motion');

console.log('FIRST_RUN_ONBOARDING_CONTRACT_OK');
