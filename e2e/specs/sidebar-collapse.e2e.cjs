'use strict';

const assert = require('node:assert/strict');

const ACCOUNT_A = 'e2e-account-a';
const ACCOUNT_B = 'e2e-account-b';
const STEP_TIMEOUT = 3000;
const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';
const WEBDRIVER_ENTER = '\uE007';

async function waitVisible(selector, timeout = STEP_TIMEOUT) {
  const element = await $(selector);
  await element.waitForDisplayed({ timeout });
  return element;
}

function webdriverElementId(element) {
  return element?.elementId || element?.[W3C_ELEMENT_KEY] || element?.ELEMENT || '';
}

async function activateWithKeyboard(selector) {
  await waitVisible(selector);
  await browser.waitUntil(async () => browser.execute((targetSelector) => {
    const target = document.querySelector(targetSelector);
    return !!target && (target.matches('button') || target.getAttribute('role') === 'button');
  }, selector), {
    timeout: STEP_TIMEOUT,
    timeoutMsg: `${selector} did not become keyboard-activatable`,
  });
  await browser.execute((targetSelector) => {
    document.querySelector(targetSelector)?.focus({ preventScroll: true });
  }, selector);
  await browser.waitUntil(async () => browser.execute((targetSelector) =>
    document.activeElement === document.querySelector(targetSelector), selector), {
    timeout: STEP_TIMEOUT,
    timeoutMsg: `${selector} did not receive focus`,
  });
  const activeElement = await browser.getActiveElement();
  const elementId = webdriverElementId(activeElement);
  assert.ok(elementId, `active WebDriver element is unavailable for ${selector}`);
  await browser.elementSendKeys(elementId, WEBDRIVER_ENTER);
}

async function setCollapsed(collapsed) {
  const isCollapsed = await browser.execute(() => document.getElementById('side-nav')?.classList.contains('collapsed') === true);
  if (isCollapsed !== collapsed) await activateWithKeyboard('#btn-collapse');
  await browser.waitUntil(async () => browser.execute((expected) => {
    const sideNav = document.getElementById('side-nav');
    const buttonNode = document.getElementById('btn-collapse');
    return sideNav?.classList.contains('collapsed') === expected
      && buttonNode?.getAttribute('aria-expanded') === (expected ? 'false' : 'true');
  }, collapsed), {
    timeout: STEP_TIMEOUT,
    timeoutMsg: `sidebar did not reach collapsed=${collapsed}`,
  });
}

async function activateAccount(accountId) {
  await activateWithKeyboard(`.nav-account[data-id="${accountId}"] .nav-account-main`);
  await browser.waitUntil(async () => browser.execute((id) =>
    document.querySelector('.nav-account.active[data-id]')?.dataset.id === id, accountId), {
    timeout: STEP_TIMEOUT,
    timeoutMsg: `account ${accountId} did not become active`,
  });
}

function shellSnapshot() {
  const sideNav = document.getElementById('side-nav');
  const button = document.getElementById('btn-collapse');
  const rows = [...document.querySelectorAll('.nav-account[data-id]')]
    .filter(row => row.dataset.id === 'e2e-account-a' || row.dataset.id === 'e2e-account-b')
    .map(row => {
      const main = row.querySelector('.nav-account-main');
      const name = row.querySelector('.nav-account-name');
      const badge = row.querySelector('.shell-account-identity');
      const rowRect = row.getBoundingClientRect();
      const badgeRect = badge?.getBoundingClientRect();
      return {
        id: row.dataset.id,
        active: row.classList.contains('active'),
        fullName: String(name?.textContent || '').trim(),
        nameDisplay: name ? getComputedStyle(name).display : '',
        ariaLabel: main?.getAttribute('aria-label') || '',
        ariaCurrent: main?.getAttribute('aria-current') || '',
        title: main?.getAttribute('title') || '',
        badgeText: String(badge?.textContent || '').trim(),
        badgeHidden: badge?.getAttribute('aria-hidden') || '',
        badgeDisplay: badge ? getComputedStyle(badge).display : '',
        badgeInsideRow: !!badgeRect
          && badgeRect.left >= rowRect.left - 1
          && badgeRect.right <= rowRect.right + 1
          && badgeRect.top >= rowRect.top - 1
          && badgeRect.bottom <= rowRect.bottom + 1,
      };
    });
  return {
    collapsed: sideNav?.classList.contains('collapsed') === true,
    ariaControls: button?.getAttribute('aria-controls') || '',
    ariaExpanded: button?.getAttribute('aria-expanded') || '',
    ariaLabel: button?.getAttribute('aria-label') || '',
    title: button?.getAttribute('title') || '',
    rows,
  };
}

describe('collapsed sidebar account identity', () => {
  afterEach(async () => {
    await setCollapsed(false);
    await activateAccount(ACCOUNT_A);
  });

  it('keeps same-platform accounts distinguishable and the disclosure state accurate', async () => {
    await waitVisible(`.nav-account[data-id="${ACCOUNT_A}"] .nav-account-main`);
    await waitVisible(`.nav-account[data-id="${ACCOUNT_B}"] .nav-account-main`);
    await setCollapsed(false);

    const expanded = await browser.execute(shellSnapshot);
    assert.equal(expanded.collapsed, false);
    assert.equal(expanded.ariaControls, 'side-nav');
    assert.equal(expanded.ariaExpanded, 'true');
    assert.match(expanded.ariaLabel, /收起账号侧栏/);
    assert.match(expanded.title, /收起账号侧栏/);
    assert.deepEqual(expanded.rows.map(row => row.badgeText), ['EA', 'EB']);
    assert.ok(expanded.rows.every(row => row.badgeHidden === 'true'));
    assert.ok(expanded.rows.every(row => row.badgeDisplay === 'none'));
    assert.ok(expanded.rows.every(row => row.title === ''));

    await setCollapsed(true);
    const collapsed = await browser.execute(shellSnapshot);
    assert.equal(collapsed.collapsed, true);
    assert.equal(collapsed.ariaExpanded, 'false');
    assert.match(collapsed.ariaLabel, /展开账号侧栏/);
    assert.match(collapsed.title, /展开账号侧栏/);
    assert.deepEqual(collapsed.rows.map(row => row.badgeText), ['EA', 'EB']);
    assert.deepEqual(collapsed.rows.map(row => row.title), ['E2E Alpha', 'E2E Beta']);
    assert.deepEqual(collapsed.rows.map(row => row.ariaLabel), ['切换账号：E2E Alpha', '切换账号：E2E Beta']);
    assert.ok(collapsed.rows.every(row => row.nameDisplay === 'none'));
    assert.ok(collapsed.rows.every(row => row.badgeDisplay !== 'none'));
    assert.ok(collapsed.rows.every(row => row.badgeInsideRow), 'compact account badges must remain inside the 64px navigation rail');

    await activateAccount(ACCOUNT_B);
    const rerendered = await browser.execute(shellSnapshot);
    assert.equal(rerendered.collapsed, true, 'account rerender must not change collapse ownership');
    assert.deepEqual(rerendered.rows.map(row => row.badgeText), ['EA', 'EB']);
    const beta = rerendered.rows.find(row => row.id === ACCOUNT_B);
    assert.equal(beta?.active, true);
    assert.equal(beta?.ariaCurrent, 'page');
    assert.equal(beta?.title, 'E2E Beta');

    await setCollapsed(false);
    const restored = await browser.execute(shellSnapshot);
    assert.equal(restored.ariaExpanded, 'true');
    assert.ok(restored.rows.every(row => row.badgeDisplay === 'none'));
    assert.ok(restored.rows.every(row => row.title === ''));
  });
});
