'use strict';

const assert = require('node:assert/strict');

const STEP_TIMEOUT = 3000;
const LOCK_PASSWORD = 'geek-e2e-lock';
const WEBDRIVER_KEY = Object.freeze({
  NULL: '\uE000',
  TAB: '\uE004',
  SHIFT: '\uE008',
  ESCAPE: '\uE00C',
});

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

async function waitFocused(id, timeout = STEP_TIMEOUT) {
  await browser.waitUntil(async () => browser.execute(
    expectedId => document.activeElement?.id === expectedId,
    id,
  ), {
    timeout,
    timeoutMsg: `focus did not settle on #${id}`,
  });
}

async function keyOnFocused(key, extra = {}) {
  if (key === 'Tab') {
    if (extra.shiftKey === true) {
      await browser.keys([WEBDRIVER_KEY.SHIFT, WEBDRIVER_KEY.TAB, WEBDRIVER_KEY.NULL]);
    } else {
      await browser.keys(WEBDRIVER_KEY.TAB);
    }
    return;
  }
  if (key === 'Escape') {
    await browser.keys(WEBDRIVER_KEY.ESCAPE);
    return;
  }
  throw new Error(`unsupported lock-screen test key: ${key}`);
}

async function setLockPassword(value) {
  const result = await browser.executeAsync((password, done) => {
    window.api.config.set({ lockPassword: password })
      .then(() => done({ ok: true }))
      .catch(error => done({ ok: false, error: String(error?.message || error || 'config-set-failed') }));
  }, value);
  assert.equal(result?.ok, true, result?.error || 'failed to seed lock password');
}

describe('lock screen accessibility', () => {
  afterEach(async () => {
    await browser.execute(() => {
      if (window.__geekE2EOriginalLockAlert) window.alert = window.__geekE2EOriginalLockAlert;
      delete window.__geekE2EOriginalLockAlert;
      delete window.__geekE2ELockAlertCount;
      const settings = document.getElementById('settings-overlay');
      if (settings && !settings.classList.contains('hidden')) document.getElementById('settings-cancel')?.click();
    });
    await browser.executeAsync((done) => {
      window.api.config.set({ lockPassword: '' }).then(() => done(true)).catch(() => done(false));
    });
  });

  it('routes a missing lock password into Security settings without a native alert', async () => {
    await setLockPassword('');
    await browser.execute(() => {
      window.__geekE2EOriginalLockAlert = window.alert;
      window.__geekE2ELockAlertCount = 0;
      window.alert = () => { window.__geekE2ELockAlertCount += 1; };
    });

    const lockButton = await waitVisible('#btn-lock');
    await lockButton.click();
    await waitVisible('#settings-overlay:not(.hidden)');
    await browser.waitUntil(async () => browser.execute(() => document.activeElement?.id === 'cfg-lockPassword'), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'missing-password route did not focus the lock password setting',
    });

    const routed = await browser.execute(() => ({
      alertCount: window.__geekE2ELockAlertCount,
      lockVisible: document.getElementById('lock-overlay')?.classList.contains('hidden') === false,
      status: document.getElementById('settings-status')?.textContent || '',
      statusRole: document.getElementById('settings-status')?.getAttribute('role') || '',
      statusLive: document.getElementById('settings-status')?.getAttribute('aria-live') || '',
      describedBy: document.getElementById('cfg-lockPassword')?.getAttribute('aria-describedby') || '',
      focusedId: document.activeElement?.id || '',
    }));
    assert.equal(routed.alertCount, 0);
    assert.equal(routed.lockVisible, false);
    assert.match(routed.status, /请先设置锁屏密码/);
    assert.equal(routed.statusRole, 'status');
    assert.equal(routed.statusLive, 'polite');
    assert.equal(routed.describedBy, 'settings-status');
    assert.equal(routed.focusedId, 'cfg-lockPassword');

    await (await waitVisible('#cfg-lockPassword')).setValue('draft-password');
    await browser.waitUntil(async () => browser.execute(() =>
      !document.getElementById('settings-status')?.textContent
      && !document.getElementById('cfg-lockPassword')?.hasAttribute('aria-describedby')), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'lock password setup guidance did not clear after user input',
    });

    await keyOnFocused('Escape');
    await waitHidden('#settings-overlay');
    await browser.waitUntil(async () => browser.execute(() => document.activeElement?.id === 'btn-lock'), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'closing Security settings did not restore focus to the lock entry',
    });
    assert.equal(await browser.execute(() => window.__geekE2ELockAlertCount), 0);
  });

  it('makes background inert, contains focus, announces errors, and restores focus after unlock', async () => {
    await setLockPassword(LOCK_PASSWORD);
    const lockButton = await waitVisible('#btn-lock');
    await lockButton.click();
    await waitVisible('#lock-overlay:not(.hidden)');

    await browser.waitUntil(async () => browser.execute(() => document.activeElement?.id === 'lock-password'), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'lock password did not receive initial focus',
    });

    const opened = await browser.execute(() => {
      const overlay = document.getElementById('lock-overlay');
      return {
        role: overlay?.getAttribute('role') || '',
        modal: overlay?.getAttribute('aria-modal') || '',
        labelledBy: overlay?.getAttribute('aria-labelledby') || '',
        describedBy: overlay?.getAttribute('aria-describedby') || '',
        appInert: document.querySelector('main.app')?.inert === true,
        contextMenuInert: document.getElementById('ctx-menu')?.inert === true,
        activeId: document.activeElement?.id || '',
        errorRole: document.getElementById('lock-error')?.getAttribute('role') || '',
        errorLive: document.getElementById('lock-error')?.getAttribute('aria-live') || '',
      };
    });
    assert.equal(opened.role, 'dialog');
    assert.equal(opened.modal, 'true');
    assert.match(opened.labelledBy, /lock-screen-title/);
    assert.match(opened.describedBy, /lock-screen-description/);
    assert.match(opened.describedBy, /lock-error/);
    assert.equal(opened.appInert, true);
    assert.equal(opened.contextMenuInert, true);
    assert.equal(opened.activeId, 'lock-password');
    assert.equal(opened.errorRole, 'alert');
    assert.equal(opened.errorLive, 'assertive');

    await browser.execute(() => document.getElementById('btn-settings')?.focus());
    await browser.waitUntil(async () => browser.execute(() => document.activeElement?.id === 'lock-password'), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'background focus escaped the lock screen',
    });

    await keyOnFocused('Tab');
    await waitFocused('lock-unlock');
    await keyOnFocused('Tab');
    await waitFocused('lock-password');
    await keyOnFocused('Tab', { shiftKey: true });
    await waitFocused('lock-unlock');

    await keyOnFocused('Escape');
    assert.equal(await browser.execute(() => document.getElementById('lock-overlay')?.classList.contains('hidden') === false), true, 'Escape must not bypass the lock');
    await waitFocused('lock-password');

    const password = await waitVisible('#lock-password');
    await password.setValue('wrong-password');
    await (await waitVisible('#lock-unlock')).click();
    await waitVisible('#lock-error:not(.hidden)');
    assert.match(await (await waitVisible('#lock-error')).getText(), /密码错误/);
    assert.equal(await password.getValue(), '');
    assert.equal(await browser.execute(() => document.activeElement?.id || ''), 'lock-password');

    await password.setValue(LOCK_PASSWORD);
    await (await waitVisible('#lock-unlock')).click();
    await waitHidden('#lock-overlay');
    await browser.waitUntil(async () => browser.execute(() => document.activeElement?.id === 'btn-lock'), {
      timeout: STEP_TIMEOUT,
      timeoutMsg: 'unlock did not restore focus to the lock invoker',
    });

    const restored = await browser.execute(() => ({
      appInert: document.querySelector('main.app')?.inert === true,
      contextMenuInert: document.getElementById('ctx-menu')?.inert === true,
      activeId: document.activeElement?.id || '',
    }));
    assert.equal(restored.appInert, false);
    assert.equal(restored.contextMenuInert, false);
    assert.equal(restored.activeId, 'btn-lock');
  });
});
