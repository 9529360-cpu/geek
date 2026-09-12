'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'src/main.cjs'), 'utf8');
const ownerSource = fs.readFileSync(path.join(root, 'src/account-state.cjs'), 'utf8');
const mainEntrySource = fs.readFileSync(path.join(root, 'src/main-entry.cjs'), 'utf8');
const { PLATFORM_CATALOG } = require('../src/platform-catalog.cjs');
assert.deepEqual(Object.keys(PLATFORM_CATALOG).sort(), ['line','line-business','telegram-k','telegram-z','website','whatsapp','whatsapp-pure'].sort());
assert.match(mainSource, /resolveTypeConfig:\s*platformConfig/, 'Account State owner must consume the platform catalog authority');
assert.doesNotMatch(mainSource, /const APP_TYPES\s*=/, 'main must not duplicate platform metadata');
assert.match(ownerSource, /const type = raw\.type === undefined \? 'whatsapp' : raw\.type/, 'omitted type keeps the historical WhatsApp default');
assert.match(ownerSource, /const config = resolveTypeConfig\(type\)/, 'Account State owner validates against injected APP_TYPES authority');
assert.match(ownerSource, /ACCOUNT_TYPE_UNSUPPORTED/, 'unsupported account types fail closed in the state owner');
assert.match(ownerSource, /type === 'website' \? normalizeWebsiteUrl\(raw\.customUrl\) : ''/, 'Website URL authority remains injected instead of duplicated');
assert.doesNotMatch(mainEntrySource, /account-type-boundary|installAccountTypeBoundary/, 'startup no longer intercepts accounts:add registration');
assert.equal(fs.existsSync(path.join(root, 'src/account-type-boundary.cjs')), false, 'duplicate account type authority is retired');

console.log('ACCOUNT_TYPE_BOUNDARY_CONTRACT_OK');