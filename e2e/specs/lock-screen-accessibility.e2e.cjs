'use strict';

const assert = require('node:assert/strict');

const STEP_TIMEOUT = 3000;
const E2E_LOCK_PASSWORD = 'geek-e2e-lock-screen';

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

describe('lock screen modal accessibility', () => {
  it('makes the background inert, traps focus, announces errors, and restores focus after unlock', async () => {
    await browser.waitUntil(async () => browser.execute(() =>
      !!document.querySelector('script[data-geek-lock-screen-accessibility]')), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'lock screen accessibility owner was not bootstrapped',
    });

    const originalPassword = await browser.execute(async password => {
      const before = await window.api.config.get();
      await window.api.config.set({ lockPassword: password });
      return String(before?.lockPassword || '');
    }, E2E_LOCK_PASSWORD);

    const lockButton = await waitVisible('#btn-lock');
    await lockButton.click();
    await waitVisible('#lock-overlay:not(.hidden)');
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelector('#lock-overlay .lock-box')?.getAttribute('role') === 'dialog'), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'lock screen dialog semantics were not installed',
    });

    const opened = await browser.execute(() => ({
      role: document.querySelector('#lock-overlay .lock-box')?.getAttribute('role') || '',
      modal: document.querySelector('#lock-overlay .lock-box')?.getAttribute('aria-modal') || '',
      inert: document.querySelector('.app')?.inert === true,
      focusedId: document.activeElement?.id || '',
    }));
    assert.equal(opened.role, 'dialog');
    assert.equal(opened.modal, 'true');
    assert.equal(opened.inert, true);
    assert.equal(opened.focusedId, 'lock-password');

    await keyOnFocused('Tab');
    assert.equal(await browser.execute(() => document.activeElement?.id || ''), 'lock-unlock');
    await keyOnFocused('Tab');
    assert.equal(await browser.execute(() => document.activeElement?.id || ''), 'lock-password');
    await keyOnFocused('Tab', { shiftKey: true });
    assert.equal(await browser.execute(() => document.activeElement?.id || ''), 'lock-unlock');
    await keyOnFocused('Escape');
    const escaped = await browser.execute(() => ({
      visible: !document.getElementById('lock-overlay')?.classList.contains('hidden'),
      focusedId: document.activeElement?.id || '',
    }));
    assert.equal(escaped.visible, true, 'Escape must not dismiss the lock screen');
    assert.equal(escaped.focusedId, 'lock-password');

    const password = await waitVisible('#lock-password');
    await password.setValue(E2E_LOCK_PASSWORD + '__wrong__');
    await (await waitVisible('#lock-unlock')).click();
    await waitVisible('#lock-error:not(.hidden)');

    const errorState = await browser.execute(() => ({
      role: document.getElementById('lock-error')?.getAttribute('role') || '',
      live: document.getElementById('lock-error')?.getAttribute('aria-live') || '',
      invalid: document.getElementById('lock-password')?.getAttribute('aria-invalid') || '',
      errorMessage: document.getElementById('lock-password')?.getAttribute('aria-errormessage') || '',
      inert: document.querySelector('.app')?.inert === true,
      focusedId: document.activeElement?.id || '',
    }));
    assert.equal(errorState.role, 'status');
    assert.equal(errorState.live, 'polite');
    assert.equal(errorState.invalid, 'true');
    assert.equal(errorState.errorMessage, 'lock-error');
    assert.equal(errorState.inert, true);
    assert.equal(errorState.focusedId, 'lock-password');

    await password.setValue(E2E_LOCK_PASSWORD);
    await (await waitVisible('#lock-unlock')).click();
    await waitHidden('#lock-overlay');
    await browser.waitUntil(async () => browser.execute(() =>
      document.querySelector('.app')?.inert === false && document.activeElement?.id === 'btn-lock'), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'unlock did not restore app interactivity and focus',
    });

    await browser.execute(async value => {
      await window.api.config.set({ lockPassword: value });
    }, originalPassword);
  });
});