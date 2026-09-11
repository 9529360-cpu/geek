'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');
const mainEntrySource = fs.readFileSync(path.join(root, 'src/main-entry.cjs'), 'utf8');
const appTypesPattern = /const APP_TYPES = \{([\s\S]*?)\r?\n\};\r?\n\r?\nfunction appTypeConfig/;
const appTypesMatch = mainSource.match(appTypesPattern);
assert.ok(appTypesMatch, 'main.cjs APP_TYPES must remain the formal platform authority');
const formalTypes = [...appTypesMatch[1].matchAll(/^\s{2}(?:'([^']+)'|([a-z][a-z0-9-]*)):\s*\{/gm)].map(match => match[1] || match[2]);
assert.deepEqual(formalTypes.sort(), ['line','line-business','telegram-k','telegram-z','website','whatsapp','whatsapp-pure'].sort());

const addAccount = mainSource.match(/async function addAccount\(_event, payload = \{\}\) \{[\s\S]*?\n\}/)?.[0] || '';
assert.match(addAccount, /typeof payload === 'string' \? \{ name: payload \} : payload \|\| \{\}/, 'historical string payload remains supported');
assert.match(addAccount, /raw\.type === undefined \? 'whatsapp' : raw\.type/, 'omitted type keeps the historical WhatsApp default');
assert.match(addAccount, /const config = appTypeConfig\(type\)/, 'accounts:add validates against APP_TYPES');
assert.match(addAccount, /ACCOUNT_TYPE_UNSUPPORTED/, 'unsupported account types fail closed in the real owner');
assert.match(addAccount, /type === 'website' \? normalizeWebsiteUrl\(raw\.customUrl\) : ''/, 'Website URLs remain normalized before account creation');
assert.doesNotMatch(mainEntrySource, /account-type-boundary|installAccountTypeBoundary/, 'startup no longer intercepts accounts:add registration');
assert.equal(fs.existsSync(path.join(root, 'src/account-type-boundary.cjs')), false, 'duplicate account type authority is retired');

console.log('ACCOUNT_TYPE_BOUNDARY_CONTRACT_OK');