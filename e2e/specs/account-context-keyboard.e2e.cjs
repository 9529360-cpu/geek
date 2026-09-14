'use strict';

const assert = require('node:assert/strict');

const ACCOUNT_A = 'e2e-account-a';
const ACCOUNT_B = 'e2e-account-b';
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

async function focusAccount(accountId) {
  await waitVisible(`.nav-account[data-id="${accountId}"] .nav-account-main`);
  await browser.execute((id) => {
    document.querySelector(`.nav-account[data-id="${id}"] .nav-account-main`)?.focus();
  }, accountId);
}

describe('account context keyboard accessibility', () => {
  it('opens account actions from Shift+F10 and makes account settings a contained modal', async () => {
    await focusAccount(ACCOUNT_A);
    await keyOnFocused('F10', { shiftKey: true });
    await waitVisible('#ctx-menu:not(.hidden)');

    const opened = await browser.execute(() => {
      const menu = document.getElementById('ctx-menu');
      return {
        role: menu?.getAttribute('role'),
        accountId: menu?.dataset.accountId,
        itemRoles: [...(menu?.querySelectorAll('.ctx-item') || [])].map(item => item.getAttribute('role')),
        focusedAction: document.activeElement?.dataset?.act || '',
      };
    });
    assert.equal(opened.role, 'menu');
    assert.equal(opened.accountId, ACCOUNT_A);
    assert.deepEqual(opened.itemRoles, ['menuitem', 'menuitem', 'menuitem', 'menuitem']);
    assert.equal(opened.focusedAction, 'refresh');

    await keyOnFocused('ArrowDown');
    assert.equal(await browser.execute(() => document.activeElement?.dataset?.act || ''), 'edit');
    await keyOnFocused('Enter');
    await waitHidden('#ctx-menu');
    await waitVisible('#account-settings-overlay:not(.hidden)');

    const dialog = await browser.execute(() => {
      const overlay = document.getElementById('account-settings-overlay');
      const surface = overlay?.querySelector('[role="dialog"]');
      return {
        target: document.getElementById('account-settings-target')?.textContent || '',
        focusedId: document.activeElement?.id || '',
        modal: surface?.getAttribute('aria-modal') || '',
        labelledBy: surface?.getAttribute('aria-labelledby') || '',
        describedBy: surface?.getAttribute('aria-describedby') || '',
        title: document.getElementById(surface?.getAttribute('aria-labelledby') || '')?.textContent || '',
        appInert: document.querySelector('.app')?.inert === true,
        lockInert: document.getElementById('lock-overlay')?.inert === true,
        statusRole: document.getElementById('account-settings-status')?.getAttribute('role') || '',
        statusLive: document.getElementById('account-settings-status')?.getAttribute('aria-live') || '',
        names: ['account-settings-name', 'account-settings-fontSize', 'account-settings-fontColor']
          .map(id => document.getElementById(id)?.getAttribute('aria-label') || ''),
      };
    });
    assert.match(dialog.target, /E2E Alpha/);
    assert.equal(dialog.focusedId, 'account-settings-name');
    assert.equal(dialog.modal, 'true');
    assert.match(dialog.labelledBy, /account-settings-dialog-title/);
    assert.equal(dialog.describedBy, 'account-settings-target');
    assert.equal(dialog.title, '账号设置');
    assert.equal(dialog.appInert, true, 'background shell must be inert while instance settings are visible');
    assert.equal(dialog.lockInert, false, 'security lock overlay must remain able to supersede instance settings');
    assert.equal(dialog.statusRole, 'status');
    assert.equal(dialog.statusLive, 'polite');
    assert.deepEqual(dialog.names, ['显示名', '字体大小', '字体颜色']);

    const dynamicInert = await browser.executeAsync((done) => {
      const node = document.createElement('button');
      node.id = 'e2e-account-settings-background-probe';
      node.textContent = 'background probe';
      document.body.appendChild(node);
      queueMicrotask(() => done(node.inert === true));
    });
    assert.equal(dynamicInert, true, 'body surfaces mounted while the dialog is open must inherit inertness');

    await browser.execute(() => document.getElementById('account-settings-save')?.focus());
    await keyOnFocused('Tab');
    assert.equal(await browser.execute(() => document.activeElement?.id || ''), 'account-settings-close', 'Tab from the final control must wrap to the dialog start');
    await keyOnFocused('Tab', { shiftKey: true });
    assert.equal(await browser.execute(() => document.activeElement?.id || ''), 'account-settings-save', 'Shift+Tab from the dialog start must wrap to the final control');

    await browser.execute((id) => {
      document.querySelector(`.nav-account[data-id="${id}"] .nav-account-main`)?.focus();
    }, ACCOUNT_B);
    const contained = await browser.execute(() => {
      const dialogSurface = document.querySelector('#account-settings-overlay [role="dialog"]');
      return dialogSurface?.contains(document.activeElement) === true;
    });
    assert.equal(contained, true, 'programmatic focus attempts must not escape the visible account settings dialog');

    await keyOnFocused('Escape');
    await waitHidden('#account-settings-overlay');

    const restored = await browser.execute((id) => {
      const active = document.activeElement;
      const dynamic = document.getElementById('e2e-account-settings-background-probe');
      const result = {
        accountFocus: active?.classList?.contains('nav-account-main') === true
          && active.closest('.nav-account')?.dataset.id === id,
        appInert: document.querySelector('.app')?.inert === true,
        dynamicInert: dynamic?.inert === true,
      };
      dynamic?.remove();
      return result;
    }, ACCOUNT_A);
    assert.equal(restored.accountFocus, true, 'Escape must close through the existing dialog owner and restore the invoking account focus');
    assert.equal(restored.appInert, false, 'closing account settings must restore background interactivity');
    assert.equal(restored.dynamicInert, false, 'dynamically mounted background surfaces must have their prior inert state restored');
  });

  it('supports the ContextMenu key, End, and Escape', async () => {
    await focusAccount(ACCOUNT_B);
    await keyOnFocused('ContextMenu');
    await waitVisible('#ctx-menu:not(.hidden)');
    await keyOnFocused('End');
    assert.equal(await browser.execute(() => document.activeElement?.dataset?.act || ''), 'delete');
    await keyOnFocused('Escape');
    await waitHidden('#ctx-menu');

    const restored = await browser.execute((id) => {
      const active = document.activeElement;
      return active?.classList?.contains('nav-account-main') === true
        && active.closest('.nav-account')?.dataset.id === id;
    }, ACCOUNT_B);
    assert.equal(restored, true);
  });

  it('uses an in-app destructive confirmation and cancels without native prompts', async () => {
    await browser.waitUntil(async () => browser.execute(() =>
      typeof window.GeekBroadcastAccountRemoval?.openDialog === 'function'), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'account removal owner did not become ready',
    });
    await browser.execute(() => {
      window.__geekE2EOriginalConfirm = window.confirm;
      window.__geekE2EConfirmCount = 0;
      window.confirm = () => { window.__geekE2EConfirmCount += 1; return false; };
    });

    await focusAccount(ACCOUNT_B);
    await keyOnFocused('ContextMenu');
    await waitVisible('#ctx-menu:not(.hidden)');
    await keyOnFocused('End');
    assert.equal(await browser.execute(() => document.activeElement?.dataset?.act || ''), 'delete');
    await keyOnFocused('Enter');
    await waitVisible('#account-remove-confirm-overlay:not(.hidden)');

    const dialog = await browser.execute((id) => {
      const overlay = document.getElementById('account-remove-confirm-overlay');
      const alertDialog = overlay?.querySelector('[role="alertdialog"]');
      return {
        role: alertDialog?.getAttribute('role') || '',
        modal: alertDialog?.getAttribute('aria-modal') || '',
        description: document.getElementById('account-remove-confirm-description')?.textContent || '',
        focusedId: document.activeElement?.id || '',
        confirmCalls: window.__geekE2EConfirmCount,
        accountExists: !!document.querySelector(`.nav-account[data-id="${id}"]`),
      };
    }, ACCOUNT_B);
    assert.equal(dialog.role, 'alertdialog');
    assert.equal(dialog.modal, 'true');
    assert.match(dialog.description, /E2E Beta/);
    assert.equal(dialog.focusedId, 'account-remove-cancel');
    assert.equal(dialog.confirmCalls, 0, 'destructive confirmation must not call native window.confirm');
    assert.equal(dialog.accountExists, true);

    await keyOnFocused('Tab', { shiftKey: true });
    assert.equal(await browser.execute(() => document.activeElement?.id || ''), 'account-remove-confirm');
    await keyOnFocused('Tab');
    assert.equal(await browser.execute(() => document.activeElement?.id || ''), 'account-remove-cancel');
    await keyOnFocused('Escape');
    await waitHidden('#account-remove-confirm-overlay');

    const cancelled = await browser.execute((id) => {
      const active = document.activeElement;
      const sameAccount = active?.closest?.('.nav-account')?.dataset.id === id;
      if (window.__geekE2EOriginalConfirm) window.confirm = window.__geekE2EOriginalConfirm;
      delete window.__geekE2EOriginalConfirm;
      const calls = window.__geekE2EConfirmCount;
      delete window.__geekE2EConfirmCount;
      return {
        sameAccount,
        moreButton: active?.classList?.contains('shell-account-menu-button') === true,
        accountExists: !!document.querySelector(`.nav-account[data-id="${id}"]`),
        confirmCalls: calls,
      };
    }, ACCOUNT_B);
    assert.equal(cancelled.sameAccount, true);
    assert.equal(cancelled.moreButton, true);
    assert.equal(cancelled.accountExists, true, 'Escape cancellation must not delete the account');
    assert.equal(cancelled.confirmCalls, 0);
  });

  it('uses the visible more-actions button and restores focus around proxy settings', async () => {
    const button = await waitVisible(`.nav-account[data-id="${ACCOUNT_A}"] .shell-account-menu-button`);
    assert.equal(await button.getAttribute('aria-haspopup'), 'menu');

    await browser.execute((id) => {
      const target = document.querySelector(`.nav-account[data-id="${id}"] .shell-account-menu-button`);
      target?.focus();
      target?.click();
    }, ACCOUNT_A);
    await waitVisible('#ctx-menu:not(.hidden)');
    assert.equal(await button.getAttribute('aria-expanded'), 'true');

    await keyOnFocused('ArrowDown');
    await keyOnFocused('ArrowDown');
    assert.equal(await browser.execute(() => document.activeElement?.dataset?.act || ''), 'proxy');
    await keyOnFocused('Enter');
    await waitVisible('#proxy-overlay:not(.hidden)');
    assert.equal(await browser.execute(() => document.activeElement?.id || ''), 'proxy-openProxy');

    await (await waitVisible('#proxy-close')).click();
    await waitHidden('#proxy-overlay');
    const restored = await browser.execute((id) => {
      const active = document.activeElement;
      return active?.classList?.contains('shell-account-menu-button') === true
        && active.closest('.nav-account')?.dataset.id === id;
    }, ACCOUNT_A);
    assert.equal(restored, true);
  });
});
