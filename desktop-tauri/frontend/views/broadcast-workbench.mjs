import { steps, draftPayload, previewMessage, formatTime } from '../models/broadcast.mjs';
import { errorMessage } from '../models/broadcast-status.mjs';
import { element, button, hidden, statusNode, wire } from './broadcast-elements.mjs';

export function createWorkbenchView(document, retry, changed) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('broadcast-overlay');
  const body = overlay.querySelector('.bc-body');
  const header = overlay.querySelector('.bc-header');
  const navigation = element(document, 'nav', 'bc-workbench-nav');
  navigation.id = 'broadcast-workbench-nav';
  navigation.setAttribute('aria-label', '群发创建步骤');
  const navButtons = new Map();
  let step = 'content';
  let blocked = false;
  for (const [index, name] of ['消息内容', '发送对象', '发送设置', '检查发送'].entries()) {
    const id = steps[index];
    const node = button(document, '', () => setStep(id), 'bc-workbench-step');
    node.dataset.step = id;
    node.append(element(document, 'b', '', String(index + 1)), element(document, 'span', '', name));
    navigation.append(node); navButtons.set(id, node);
  }
  header.after(navigation);
  const feedback = statusNode(document, 'broadcast-workbench-status', 'bc-workbench-status');
  feedback.append(element(document, 'i'));
  const feedbackText = element(document, 'span');
  const retryButton = button(document, '重新读取聊天', retry);
  retryButton.id = 'broadcast-reload-chats';
  feedback.append(feedbackText, retryButton);
  body.firstElementChild.before(feedback);

  const review = element(document, 'div', 'bc-card bc-review-card');
  review.id = 'broadcast-review-card';
  review.append(element(document, 'h3', 'bc-card-title', '检查发送'));
  const grid = element(document, 'div', 'bc-review-grid');
  const values = new Map();
  for (const [key, name] of [['account', '发送账号'], ['audience', '发送对象'], ['time', '发送时间'],
    ['interval', '随机间隔'], ['extras', '高级内容'], ['mode', '任务方式']]) {
    const item = element(document, 'div', 'bc-review-item');
    const value = element(document, 'strong'); value.dataset.review = key;
    item.append(element(document, 'small', '', name), value); grid.append(item); values.set(key, value);
  }
  const preview = element(document, 'div', 'bc-review-preview');
  const previewText = element(document, 'p'); previewText.dataset.review = 'message';
  preview.append(element(document, 'small', '', '首个对象的消息预览，随机版本以发送时为准'), previewText);
  const launch = statusNode(document, 'broadcast-launch-check', 'bc-launch-check');
  review.append(grid, preview, launch); body.append(review);
  const footer = overlay.querySelector('.bc-footer__btns');
  const footerTools = element(document, 'div', 'bc-workbench-footer-tools');
  const prev = button(document, '上一步', () => setStep(steps[Math.max(0, steps.indexOf(step) - 1)]), '');
  const next = button(document, '下一步', () => setStep(steps[Math.min(3, steps.indexOf(step) + 1)]), '');
  prev.id = 'broadcast-workbench-prev'; next.id = 'broadcast-workbench-next';
  footerTools.append(prev, next); footer.firstElementChild.before(footerTools);
  const cards = { content: [overlay.querySelector('.bc-compose-card')], audience: [overlay.querySelector('.bc-recipient-card')],
    settings: [overlay.querySelector('.bc-schedule-card'), overlay.querySelector('.bc-interval-card')], review: [review] };

  function setStep(value) {
    if (!steps.includes(value)) return;
    step = value;
    for (const [own, list] of Object.entries(cards)) for (const card of list) card.dataset.workbenchHidden = String(own !== step);
    for (const [own, node] of navButtons) {
      node.dataset.active = String(own === step);
      node.setAttribute('aria-current', own === step ? 'step' : 'false');
    }
    hidden($('broadcast-send'), step !== 'review');
    hidden(next, step === 'review');
    wire(prev, blocked || step === 'content');
    body.scrollTo?.({ top: 0 });
    changed();
  }

  function render(draft, catalog, owner, activeJob = null) {
    const count = draft.recipientIds.length;
    const scheduledAt = draft.scheduleEnabled ? new Date(draft.scheduleTime).getTime() : null;
    const account = owner?.name || catalog?.accountName || '当前账号';
    values.get('account').textContent = `${account}，WhatsApp`;
    values.get('audience').textContent = draft.excludedRecipientCount
      ? `${count} 个对象，已排除 ${draft.excludedRecipientCount} 个` : count ? `${count} 个对象` : '尚未选择对象';
    values.get('time').textContent = draft.scheduleEnabled ? (scheduledAt > Date.now() ? formatTime(scheduledAt) : '请选择未来的时间') : '立即发送';
    values.get('interval').textContent = `${draft.intervalMin}–${draft.intervalMax} 秒，随机等待`;
    const files = draft.attachments?.length || 0;
    values.get('extras').textContent = `${files} 个附件，${draft.vcardIds.length} 张名片${draft.tagAll ? '，@全体群成员' : ''}`;
    values.get('mode').textContent = '固定账号与受众快照';
    const target = catalog?.chats.find((chat) => chat.id === draft.recipientIds[0]);
    previewText.textContent = draft.message.trim() ? previewMessage(draft.message, target).slice(0, 2000)
      : files ? '无文本，仅发送附件' : draft.vcardIds.length ? '无文本，仅发送电子名片' : '未填写文本消息';
    let error = null;
    try { draftPayload(draft, catalog); } catch (code) { error = code; }
    if (!draft.scheduleEnabled && activeJob) error = 'BROADCAST_ACCOUNT_BUSY';
    launch.dataset.state = error ? 'block' : 'ready';
    launch.textContent = error ? errorMessage(error) : draft.scheduleEnabled
      ? '定时任务创建时固定受众，到点后按当前账号队列执行。' : '发送后可暂停或停止后续对象，已提交的消息无法撤回。';
    $('broadcast-send').textContent = draft.scheduleEnabled ? `定时发送给 ${count} 个聊天` : `发送给 ${count} 个聊天`;
    overlay.querySelector('.bc-footer-note').textContent = `${files ? `${files} 个附件，` : ''}间隔 ${draft.intervalMin}–${draft.intervalMax} 秒`;
  }

  setStep('content');
  return {
    setStep, render,
    status(message, state = 'ready', canRetry = false) {
      feedback.dataset.state = state; feedbackText.textContent = message;
      hidden(retryButton, !canRetry); wire(retryButton, blocked || !canRetry);
    },
    availability(value) {
      blocked = value;
      for (const node of navButtons.values()) wire(node, blocked);
      wire(prev, blocked || step === 'content'); wire(next, blocked);
      wire(retryButton, blocked || retryButton.classList.contains('hidden'));
    },
  };
}
