'use strict';

const assert = require('node:assert/strict');

const ACCOUNT_A = 'e2e-account-a';
const STEP_TIMEOUT = 3000;

async function waitVisible(selector, timeout = STEP_TIMEOUT) {
  const element = await $(selector);
  await element.waitForDisplayed({ timeout });
  return element;
}

async function waitHidden(selector, timeout = STEP_TIMEOUT) {
  const element = await $(selector);
  await browser.waitUntil(async () => !(await element.isDisplayed()), {
    timeout,
    timeoutMsg: `${selector} remained visible`,
  });
}

async function keyOnFocused(key, extra = {}) {
  await browser.execute((value, options) => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
      key: value,
      bubbles: true,
      cancelable: true,
      ...options,
    }));
  }, key, extra);
}

async function openProxyFromKeyboard() {
  await waitVisible(`.nav-account[data-id="${ACCOUNT_A}"] .nav-account-main`);
  await browser.execute((id) => {
    document.querySelector(`.nav-account[data-id="${id}"] .nav-account-main`)?.focus();
  }, ACCOUNT_A);
  await keyOnFocused('F10', { shiftKey: true });
  await waitVisible('#ctx-menu:not(.hidden)');
  await keyOnFocused('ArrowDown');
  await keyOnFocused('ArrowDown');
  assert.equal(await browser.execute(() => document.activeElement?.dataset?.act || ''), 'proxy');
  await keyOnFocused('Enter');
  await waitVisible('#proxy-overlay:not(.hidden)');
  await browser.waitUntil(async () => browser.execute(() => document.activeElement?.id === 'proxy-openProxy'), {
    timeout: STEP_TIMEOUT,
    timeoutMsg: 'proxy dialog did not receive initial keyboard focus',
  });
}

describe('proxy dialog inline validation', () => {
  afterEach(async () => {
    await browser.execute(() => {
      if (window.__geekE2EOriginalAlert) window.alert = window.__geekE2EOriginalAlert;
      delete window.__geekE2EOriginalAlert;
      delete window.__geekE2EProxyAlertCount;
      const overlay = document.getElementById('proxy-overlay');
      if (overlay && !overlay.classList.contains('hidden')) document.getElementById('proxy-cancel')?.click();
    });
  });

  it('keeps invalid host and port feedback in the dialog without invoking native alert', async () => {
    await openProxyFromKeyboard();

    await browser.execute(() => {
      window.__geekE2EOriginalAlert = window.alert;
      window.__geekE2EProxyAlertCount = 0;
      window.alert = () => { window.__geekE2EProxyAlertCount += 1; };
    });

    const semantics = await browser.execute(() => {
      const dialog = document.querySelector('#proxy-overlay .add-dialog');
      const status = document.getElementById('proxy-status');
      return {
        role: dialog?.getAttribute('role') || '',
        modal: dialog?.getAttribute('aria-modal') || '',
        labelledBy: dialog?.getAttribute('aria-labelledby') || '',
        closeLabel: document.getElementById('proxy-close')?.getAttribute('aria-label') || '',
        statusRole: status?.getAttribute('role') || '',
        statusLive: status?.getAttribute('aria-live') || '',
      };
    });
    assert.equal(semantics.role, 'dialog');
    assert.equal(semantics.modal, 'true');
    assert.match(semantics.labelledBy, /proxy-dialog-title/);
    assert.match(semantics.closeLabel, /关闭/);
    assert.equal(semantics.statusRole, 'status');
    assert.equal(semantics.statusLive, 'polite');

    await browser.execute(() => {
      const enabled = document.getElementById('proxy-openProxy');
      enabled.checked = true;
      enabled.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await (await waitVisible('#proxy-host')).setValue('');
    await (await waitVisible('#proxy-port')).setValue('70000');

    const before = await browser.executeAsync((done) => {
      window.api.accounts.list().then(done).catch(error => done({ error: String(error?.message || error) }));
    });
    await (await waitVisible('#proxy-save')).click();

    const invalid = await browser.execute(() => ({
      alertCount: window.__geekE2EProxyAlertCount,
      status: document.getElementById('proxy-status')?.textContent || '',
      hostInvalid: document.getElementById('proxy-host')?.getAttribute('aria-invalid') || '',
      hostError: document.getElementById('proxy-host')?.getAttribute('aria-errormessage') || '',
      portInvalid: document.getElementById('proxy-port')?.getAttribute('aria-invalid') || '',
      focusedId: document.activeElement?.id || '',
      overlayVisible: document.getElementById('proxy-overlay')?.classList.contains('hidden') === false,
    }));
    assert.equal(invalid.alertCount, 0);
    assert.match(invalid.status, /代理主机/);
    assert.match(invalid.status, /1–65535/);
    assert.equal(invalid.hostInvalid, 'true');
    assert.equal(invalid.hostError, 'proxy-status');
    assert.equal(invalid.portInvalid, 'true');
    assert.equal(invalid.focusedId, 'proxy-host');
    assert.equal(invalid.overlayVisible, true);

    const after = await browser.executeAsync((done) => {
      window.api.accounts.list().then(done).catch(error => done({ error: String(error?.message || error) }));
    });
    const beforeAccount = before.accounts.find(account => account.id === ACCOUNT_A);
    const afterAccount = after.accounts.find(account => account.id === ACCOUNT_A);
    assert.equal(afterAccount?.openProxy, beforeAccount?.openProxy, 'invalid form must not persist proxy enabled state');
    assert.equal(afterAccount?.host || '', beforeAccount?.host || '', 'invalid form must not persist host');
    assert.equal(afterAccount?.port || '', beforeAccount?.port || '', 'invalid form must not persist port');

    await (await waitVisible('#proxy-host')).setValue('127.0.0.1');
    await (await waitVisible('#proxy-port')).setValue('7890');
    await browser.waitUntil(async () => browser.execute(() =>
      document.getElementById('proxy-host')?.getAttribute('aria-invalid') === 'false'
      && document.getElementById('proxy-port')?.getAttribute('aria-invalid') === 'false'
      && !document.getElementById('proxy-status')?.textContent), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'proxy validation did not clear after correcting fields',
    });

    await browser.execute(() => document.getElementById('proxy-save')?.focus());
    await keyOnFocused('Tab');
    assert.equal(await browser.execute(() => document.activeElement?.id || ''), 'proxy-close', 'Tab from the last control must wrap to the first control');
    await keyOnFocused('Tab', { shiftKey: true });
    assert.equal(await browser.execute(() => document.activeElement?.id || ''), 'proxy-save', 'Shift+Tab from the first control must wrap to the last control');

    await keyOnFocused('Escape');
    await waitHidden('#proxy-overlay');
    const restored = await browser.execute((id) => {
      const active = document.activeElement;
      return active?.classList?.contains('nav-account-main') === true
        && active.closest('.nav-account')?.dataset.id === id;
    }, ACCOUNT_A);
    assert.equal(restored, true, 'Escape must close through the existing proxy owner and restore the invoking account focus');
    assert.equal(await browser.execute(() => window.__geekE2EProxyAlertCount), 0);
  });
});
