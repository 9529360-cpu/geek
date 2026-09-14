'use strict';

const assert = require('node:assert/strict');
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

describe('global Settings modal accessibility', () => {
  afterEach(async () => {
    await browser.execute(() => {
      document.getElementById('__geek-settings-dynamic-probe')?.remove();
      const overlay = document.getElementById('settings-overlay');
      if (overlay && !overlay.classList.contains('hidden')) document.getElementById('settings-cancel')?.click();
    });
  });

  it('keeps background interaction and focus outside the Settings dialog', async () => {
    await (await waitVisible('#btn-settings')).click();
    await waitVisible('#settings-overlay:not(.hidden)');
    await browser.waitUntil(async () => browser.execute(() => document.activeElement?.id === 'settings-close'), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'Settings did not focus its close control on open',
    });

    const opened = await browser.execute(() => ({
      role: document.querySelector('#settings-overlay [role="dialog"]')?.getAttribute('role') || '',
      modal: document.querySelector('#settings-overlay [role="dialog"]')?.getAttribute('aria-modal') || '',
      appInert: document.querySelector('.app')?.inert === true,
      accountOverlayInert: document.getElementById('account-settings-overlay')?.inert === true,
      lockInert: document.getElementById('lock-overlay')?.inert === true,
      focusedId: document.activeElement?.id || '',
    }));
    assert.equal(opened.role, 'dialog');
    assert.equal(opened.modal, 'true');
    assert.equal(opened.appInert, true, 'main application shell must be physically inert while Settings is open');
    assert.equal(opened.accountOverlayInert, true, 'other body-level surfaces must be inert while Settings is open');
    assert.equal(opened.lockInert, false, 'security lock overlay must remain available to supersede Settings');
    assert.equal(opened.focusedId, 'settings-close');

    await browser.execute(() => {
      const probe = document.createElement('button');
      probe.id = '__geek-settings-dynamic-probe';
      probe.textContent = 'dynamic background probe';
      document.body.appendChild(probe);
    });
    await browser.waitUntil(async () => browser.execute(() => document.getElementById('__geek-settings-dynamic-probe')?.inert === true), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'dynamic body surface did not inherit Settings inert state',
    });

    await keyOnFocused('Tab', { shiftKey: true });
    assert.equal(await browser.execute(() => document.activeElement?.id || ''), 'settings-save', 'Shift+Tab from first control must wrap to last control');
    await keyOnFocused('Tab');
    assert.equal(await browser.execute(() => document.activeElement?.id || ''), 'settings-close', 'Tab from last control must wrap to first control');

    await browser.execute(() => document.getElementById('btn-app-center')?.focus());
    const contained = await browser.execute(() => document.querySelector('#settings-overlay [role="dialog"]')?.contains(document.activeElement) === true);
    assert.equal(contained, true, 'background focus attempts must not escape the Settings dialog');

    await keyOnFocused('Escape');
    await waitHidden('#settings-overlay');
    await browser.waitUntil(async () => browser.execute(() => document.activeElement?.id === 'btn-settings'), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'Settings did not restore focus to its invoker',
    });

    const closed = await browser.execute(() => ({
      appInert: document.querySelector('.app')?.inert === true,
      accountOverlayInert: document.getElementById('account-settings-overlay')?.inert === true,
      focusedId: document.activeElement?.id || '',
    }));
    assert.equal(closed.appInert, false, 'closing Settings must restore the shell inert state');
    assert.equal(closed.accountOverlayInert, false, 'closing Settings must restore sibling inert state');
    assert.equal(closed.focusedId, 'btn-settings');
  });
});
