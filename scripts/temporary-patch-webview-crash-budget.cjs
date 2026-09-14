'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const appPath = 'ui/app.js';
const expectedBlob = String(process.env.EXPECTED_APP_BLOB || '').trim();
const app = fs.readFileSync(appPath, 'utf8');

function gitBlobSha(text) {
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.from(`blob ${body.length}\0`, 'utf8');
  return crypto.createHash('sha1').update(header).update(body).digest('hex');
}

if (!expectedBlob) throw new Error('EXPECTED_APP_BLOB is required');
const actualBlob = gitBlobSha(app);
if (actualBlob !== expectedBlob) {
  throw new Error(`ui/app.js blob drifted: expected ${expectedBlob}, got ${actualBlob}`);
}

const oldLimiter = `  // webview 崩溃自动重载限频（1分钟内最多2次，防崩溃循环）
  const webviewCrashLimiter = (() => {
    const timestamps = [];
    return {
      allow() {
        const t = Date.now();
        while (timestamps.length && timestamps[0] <= t - 60000) timestamps.shift();
        if (timestamps.length >= 2) return false;
        timestamps.push(t);
        return true;
      }
    };
  })();`;

const newLimiter = `  // webview 崩溃自动重载限频（每账号1分钟内最多2次，防一个账号耗尽其他账号预算）
  const webviewCrashLimiter = (() => {
    const timestampsByAccount = new Map();
    return {
      allow(accountId) {
        const key = String(accountId || '');
        if (!key) return false;
        const t = Date.now();
        const timestamps = timestampsByAccount.get(key) || [];
        while (timestamps.length && timestamps[0] <= t - 60000) timestamps.shift();
        if (timestamps.length >= 2) return false;
        timestamps.push(t);
        timestampsByAccount.set(key, timestamps);
        return true;
      }
    };
  })();`;

const oldCall = '      if (webviewCrashLimiter.allow()) {';
const newCall = '      if (webviewCrashLimiter.allow(account.id)) {';

if (app.split(oldLimiter).length - 1 !== 1) throw new Error('WebView crash limiter anchor mismatch');
if (app.split(oldCall).length - 1 !== 1) throw new Error('WebView crash listener call anchor mismatch');
if (app.includes('timestampsByAccount') || app.includes(newCall)) throw new Error('WebView crash budget patch already applied');

const next = app.replace(oldLimiter, newLimiter).replace(oldCall, newCall);
fs.writeFileSync(appPath, next, 'utf8');
