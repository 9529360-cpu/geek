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

describe('first-run onboarding', () => {
  afterEach(async () => {
    await browser.execute(() => {
      if (window.__geekE2EOriginalOnboardingAlert) window.alert = window.__geekE2EOriginalOnboardingAlert;
      delete window.__geekE2EOriginalOnboardingAlert;
      delete window.__geekE2EOnboardingAlertCount;
      const overlay = document.getElementById('add-overlay');
      if (overlay && !overlay.classList.contains('hidden')) document.getElementById('add-cancel')?.click();
      const empty = document.getElementById('empty-state');
      if (empty) {
        empty.style.display = 'none';
        empty.style.zIndex = '';
      }
    });
  });

  it('turns the empty state into a direct keyboard-safe account setup path', async () => {
    const beforeCount = await browser.executeAsync((done) => {
      window.api.accounts.list().then(result => done((result?.accounts || result || []).length)).catch(() => done(-1));
    });
    assert.ok(beforeCount >= 0);

    await browser.execute(() => {
      window.__geekE2EOriginalOnboardingAlert = window.alert;
      window.__geekE2EOnboardingAlertCount = 0;
      window.alert = () => { window.__geekE2EOnboardingAlertCount += 1; };
      const empty = document.getElementById('empty-state');
      empty.style.display = 'flex';
      empty.style.zIndex = '180';
    });

    const action = await waitVisible('#empty-add-account');
    const emptyState = await browser.execute(() => ({
      ready: document.getElementById('empty-state')?.dataset.onboardingReady || '',
      role: document.getElementById('empty-state')?.getAttribute('role') || '',
      labelledBy: document.getElementById('empty-state')?.getAttribute('aria-labelledby') || '',
      title: document.getElementById('empty-onboarding-title')?.textContent || '',
      copy: document.getElementById('empty-onboarding-copy')?.textContent || '',
      actionText: document.getElementById('empty-add-account')?.textContent || '',
    }));
    assert.equal(emptyState.ready, 'true');
    assert.equal(emptyState.role, 'region');
    assert.equal(emptyState.labelledBy, 'empty-onboarding-title');
    assert.match(emptyState.title, /添加第一个账号/);
    assert.match(emptyState.copy, /同一个工作台/);
    assert.equal(emptyState.actionText, '添加账号');

    await browser.execute(() => document.getElementById('empty-add-account')?.focus());
    await action.click();
    await waitVisible('#add-overlay:not(.hidden)');
    await browser.waitUntil(async () => browser.execute(() => document.activeElement?.classList?.contains('add-platform-card') === true), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'add-account dialog did not start on a platform choice',
    });

    const dialog = await browser.execute(() => {
      const overlay = document.getElementById('add-overlay');
      const cards = [...document.querySelectorAll('#add-platforms .add-platform-card')];
      return {
        role: overlay?.querySelector('.add-dialog')?.getAttribute('role') || '',
        titleRef: overlay?.querySelector('.add-dialog')?.getAttribute('aria-labelledby') || '',
        groupRole: document.getElementById('add-platforms')?.getAttribute('role') || '',
        groupLabel: document.getElementById('add-platforms')?.getAttribute('aria-label') || '',
        cardRoles: cards.map(card => card.getAttribute('role')),
        checked: cards.map(card => card.getAttribute('aria-checked')),
        tabbable: cards.filter(card => card.getAttribute('tabindex') === '0').length,
        statusRole: document.getElementById('add-status')?.getAttribute('role') || '',
      };
    });
    assert.equal(dialog.role, 'dialog');
    assert.equal(dialog.titleRef, 'add-account-dialog-title');
    assert.equal(dialog.groupRole, 'radiogroup');
    assert.equal(dialog.groupLabel, '选择账号平台');
    assert.ok(dialog.cardRoles.length >= 2);
    assert.ok(dialog.cardRoles.every(role => role === 'radio'));
    assert.ok(dialog.checked.every(value => value === 'false'));
    assert.equal(dialog.tabbable, 1);
    assert.equal(dialog.statusRole, 'status');

    await (await waitVisible('#add-confirm')).click();
    const invalid = await browser.execute(() => ({
      alertCount: window.__geekE2EOnboardingAlertCount,
      status: document.getElementById('add-status')?.textContent || '',
      focusedRadio: document.activeElement?.getAttribute('role') || '',
      selected: document.querySelectorAll('#add-platforms .add-platform-card.selected').length,
    }));
    assert.equal(invalid.alertCount, 0);
    assert.match(invalid.status, /请选择一个平台继续/);
    assert.equal(invalid.focusedRadio, 'radio');
    assert.equal(invalid.selected, 0);

    await keyOnFocused(' ');
    await browser.waitUntil(async () => browser.execute(() =>
      document.activeElement?.classList?.contains('selected') === true
      && document.activeElement?.getAttribute('aria-checked') === 'true'
      && !document.getElementById('add-status')?.textContent), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'keyboard platform activation did not reuse the existing selection owner',
    });
    const firstType = await browser.execute(() => document.activeElement?.dataset?.type || '');
    assert.ok(firstType);

    await keyOnFocused('ArrowRight');
    const moved = await browser.execute(() => ({
      type: document.activeElement?.dataset?.type || '',
      role: document.activeElement?.getAttribute('role') || '',
      checked: document.activeElement?.getAttribute('aria-checked') || '',
      selectedCount: document.querySelectorAll('#add-platforms .add-platform-card.selected').length,
      tabbableCount: document.querySelectorAll('#add-platforms .add-platform-card[tabindex="0"]').length,
    }));
    assert.notEqual(moved.type, firstType);
    assert.equal(moved.role, 'radio');
    assert.equal(moved.checked, 'true');
    assert.equal(moved.selectedCount, 1);
    assert.equal(moved.tabbableCount, 1);

    await browser.execute(() => document.getElementById('add-confirm')?.focus());
    await keyOnFocused('Tab');
    assert.equal(await browser.execute(() => document.activeElement?.id || ''), 'add-close');
    await keyOnFocused('Tab', { shiftKey: true });
    assert.equal(await browser.execute(() => document.activeElement?.id || ''), 'add-confirm');

    await keyOnFocused('Escape');
    await waitHidden('#add-overlay');
    await browser.waitUntil(async () => browser.execute(() => document.activeElement?.id === 'empty-add-account'), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'cancelling onboarding did not restore focus to the empty-state CTA',
    });
    assert.equal(await browser.execute(() => window.__geekE2EOnboardingAlertCount), 0);

    const afterCount = await browser.executeAsync((done) => {
      window.api.accounts.list().then(result => done((result?.accounts || result || []).length)).catch(() => done(-1));
    });
    assert.equal(afterCount, beforeCount, 'validation-only onboarding flow must not create an account');
  });
});
