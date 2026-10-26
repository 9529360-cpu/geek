import { DEFAULT_POLICY, LANGUAGES, chatPolicyFrom, effectivePolicy, sessionStatus } from '../models/translation.mjs';
import { healthStatus } from '../models/translation-health.mjs';

const globalFields = {
  'translation-message-to': 'messageTarget', 'translation-message-from': 'messageFrom', 'translation-server': 'route',
  'translation-display': 'displayTranslation', 'translation-manual': 'messageAction', 'translation-group': 'groupAuto',
  'translation-font-size': 'fontSize', 'translation-font-color': 'fontColor',
  'translation-send': 'enabled', 'translation-send-from': 'source', 'translation-send-to': 'target',
  'translation-include-zh': 'includeZh',
};
const chatFields = { 'translation-channel-message-to': 'messageTarget', 'translation-message-action': 'messageAction',
  'translation-enabled': 'enabled', 'translation-target': 'target' };

export function createTranslationView(document, actions) {
  const $ = (id) => document.getElementById(id);
  const popover = $('translation-popover');
  const listeners = [];
  const bind = (id, event, action) => {
    const node = $(id);
    node.dataset.wired = 'true'; node.addEventListener(event, action);
    listeners.push(() => node.removeEventListener(event, action));
    return node;
  };
  const make = (tag, className, text = '') => {
    const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
  };
  const makeButton = (id, text, action) => {
    const node = make('button', 'translation-save translation-save--secondary', text);
    node.id = id; node.type = 'button'; node.dataset.wired = 'true';
    node.addEventListener('click', action); return node;
  };
  function languages(id, source = false) {
    const options = source ? [['auto', '自动检测'], ...LANGUAGES] : LANGUAGES;
    $(id).replaceChildren(...options.map(([value, name]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = name; return option;
    }));
  }
  for (const id of ['translation-message-to', 'translation-channel-message-to', 'translation-send-to', 'translation-target']) languages(id);
  for (const id of ['translation-message-from', 'translation-send-from']) languages(id, true);
  const sendDescription = $('translation-send').closest('.translation-card').querySelector('.translation-card-sub');
  for (const id of ['translation-receive-auto', 'translation-channel-receive-auto']) {
    $(id).closest('.translation-switch-row').querySelector('small').textContent = '仅自动翻译新收到的可见消息；过去消息可点击翻译';
  }
  popover.querySelector('.translation-intro').textContent = '收到的消息翻成你看的语言，发送时翻成对方看的语言。历史批量翻译尚未迁移。';
  $('btn-translation').title = '翻译设置'; $('btn-translation').setAttribute('aria-label', '翻译设置');
  bind('btn-translation', 'click', actions.toggle);
  bind('translation-close', 'click', actions.close);
  bind('translation-receive-auto', 'change', actions.globalChanged);
  for (const id of Object.keys(globalFields)) bind(id, 'change', actions.globalChanged);
  bind('translation-font-color', 'input', () => preview($('translation-font-size').value, $('translation-font-color').value));
  bind('translation-chat-override', 'change', () => actions.override($('translation-chat-override').checked));
  bind('translation-channel-receive-auto', 'change', actions.chatChanged);
  for (const id of Object.keys(chatFields)) bind(id, 'change', actions.chatChanged);
  bind('translation-chat-reset', 'click', () => actions.override(false));
  bind('translation-gateway-test', 'click', actions.check).textContent = '检测网关和账户';
  $('translation-gateway-status').setAttribute('role', 'status');
  $('translation-gateway-status').setAttribute('aria-live', 'polite');
  const tabs = popover.querySelectorAll('.translation-tab');
  for (const node of tabs) {
    node.dataset.wired = 'true'; node.setAttribute('role', 'tab');
    node.id = `translation-tab-button-${node.dataset.translationTab}`;
    node.setAttribute('aria-controls', `translation-tab-${node.dataset.translationTab}`);
    $(`translation-tab-${node.dataset.translationTab}`).setAttribute('role', 'tabpanel');
    $(`translation-tab-${node.dataset.translationTab}`).setAttribute('aria-labelledby', node.id);
    const action = () => actions.tab(node.dataset.translationTab);
    node.addEventListener('click', action); listeners.push(() => node.removeEventListener('click', action));
    const keys = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const index = [...tabs].indexOf(node);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault(); actions.tab(tabs[next].dataset.translationTab); tabs[next].focus();
    };
    node.addEventListener('keydown', keys); listeners.push(() => node.removeEventListener('keydown', keys));
  }
  popover.querySelector('.translation-tabs').setAttribute('role', 'tablist');
  const sessionButton = makeButton('translation-session-open', '登录极客账户', actions.session);
  $('translation-service-detail').after(sessionButton);
  for (const scope of ['global', 'chat']) {
    const retry = makeButton(`translation-${scope}-retry`, '重试保存', () => actions.retry(scope));
    retry.classList.add('translation-retry'); $(`translation-${scope}-status`).after(retry);
  }
  const feedback = make('div', 'translation-feedback'); feedback.id = 'translation-feedback';
  for (const scope of ['global', 'chat']) {
    const group = make('div', 'translation-feedback-group'); group.id = `translation-${scope}-feedback`;
    group.append($(`translation-${scope}-status`), $(`translation-${scope}-retry`)); feedback.append(group);
  }
  popover.append(feedback);
  $('translation-tab-advanced').append(makeButton('translation-global-reset', '恢复翻译推荐设置', actions.reset));
  $('translation-global-reset').classList.add('translation-reset');
  const appearance = make('div', 'translation-appearance-preview'); appearance.id = 'translation-appearance-preview';
  const example = make('div', 'translation-appearance-preview-text', '明天 10:00 见。'); example.id = 'translation-appearance-preview-text';
  appearance.append(make('div', 'translation-appearance-preview-label', '译文外观预览'),
    make('div', 'translation-appearance-preview-original', 'See you tomorrow at 10:00.'), example,
    make('div', 'translation-appearance-preview-note', '仅使用固定示例，不读取聊天、不消耗字符。'));
  $('translation-font-color').closest('.translation-advanced-body').append(appearance);

  function preview(size, color) {
    const fontSize = Number(size);
    if ([11, 13, 15].includes(fontSize)) example.style.fontSize = `${fontSize}px`;
    if (typeof color === 'string' && /^#[\da-f]{6}$/i.test(color)) example.style.color = color;
  }
  function fields(mapping, policy) {
    for (const [id, key] of Object.entries(mapping)) {
      if (typeof policy[key] === 'boolean') $(id).checked = policy[key];
      else $(id).value = policy[key];
    }
  }
  function saveStatus(scope, draft, confirmation = false) {
    const node = $(`translation-${scope}-status`);
    node.dataset.state = draft?.saving ? 'working' : draft?.error ? 'error' : draft?.saved ? 'ok' : 'idle';
    node.textContent = confirmation ? '再次点击恢复按钮，将重置全局设置；独立聊天设置会保留。'
      : draft?.saving ? '正在保存…' : draft?.error || (draft?.saved ? '已保存' : '');
    $(`translation-${scope}-retry`).hidden = !draft?.error;
  }
  function render({ account, supported, capabilities, global, chat, context, contextPending, contextError, globalDraft, chatDraft,
    shellBusy, connected, open, tab, session, sessionError, checking, health, healthError, confirmation }) {
    const globalPolicy = global || DEFAULT_POLICY;
    const chatPolicy = effectivePolicy(globalPolicy, chat);
    const hasChat = Boolean(context?.available && context.chat);
    const override = hasChat && Boolean(chat);
    const canEdit = connected && supported && !shellBusy;
    sendDescription.textContent = account?.platformId === 'telegram-k'
      ? '按 Enter 或点击发送可翻译普通文字，也可引用同聊天的纯文字消息后翻译回复。引用回复发送成功后请手动清除完整草稿；提及和聊天附件说明暂不支持。'
      : account?.platformId === 'telegram-z'
        ? '按 Enter 或点击发送可翻译普通文字。替换输入框沿用旧版做法，会清掉 Telegram A 已同步的云草稿。引用、提及和附件暂不支持。'
        : account?.platformId === 'messenger' || account?.platformId === 'instagram'
          ? '按 Enter 或点击发送可翻译普通文字。收消息翻译需手动点击。群发只发送文字，不支持附件、名片和全体提及。'
        : '按 Enter 或点击发送可翻译普通文字、群内联系人提及，以及可识别的同聊天文字、带说明的图片和视频引用。'
          + '图片、视频及可识别预览的 PDF 支持说明翻译；多附件支持最多 10 个图片/PDF，或一个选中视频搭配图片。'
          + '请点击预览发送按钮，译文仅放在选中项，最多 1024 字。'
          + '提及、引用或附件发送成功后请手动清除完整草稿。保护提及身份会增加计费字符，以实际用量为准。';
    for (const node of popover.querySelectorAll('button, input, select')) {
      node.disabled = !connected || shellBusy || node.dataset.wired !== 'true' || node.dataset.unavailable === 'true';
    }
    $('btn-translation').disabled = !connected || shellBusy || !account;
    $('btn-translation').setAttribute('aria-expanded', String(open));
    for (const id of [...Object.keys(globalFields), 'translation-receive-auto', 'translation-global-reset', 'translation-global-retry']) {
      $(id).disabled = !canEdit;
    }
    for (const id of [...Object.keys(chatFields), 'translation-channel-receive-auto', 'translation-chat-reset']) {
      $(id).disabled = !canEdit || !hasChat || !override;
    }
    $('translation-chat-retry').disabled = !canEdit || !hasChat || Boolean(chatDraft?.saving);
    $('translation-global-retry').disabled ||= Boolean(globalDraft?.saving);
    $('translation-chat-override').disabled = !canEdit || !hasChat || contextPending;
    $('translation-group').disabled = !canEdit || globalPolicy.translationMode !== 'auto';
    $('translation-send-from').disabled = !canEdit || !globalPolicy.enabled;
    $('translation-send-to').disabled = !canEdit || !globalPolicy.enabled;
    $('translation-target').disabled = !canEdit || !hasChat || !override || !chatPolicy.enabled;
    const unavailableTitle = !supported ? '此平台尚未接通翻译' : '发送翻译暂不可用';
    for (const id of ['translation-send', 'translation-send-from', 'translation-send-to', 'translation-include-zh',
      'translation-enabled', 'translation-target', 'translation-auto-send']) {
      $(id).disabled ||= !capabilities.outgoing;
      $(id).title = capabilities.outgoing ? '' : unavailableTitle;
    }
    for (const id of ['translation-receive-auto', 'translation-channel-receive-auto', 'translation-group']) {
      $(id).disabled ||= !capabilities.automatic;
      $(id).title = capabilities.automatic ? '' : '接收翻译目前需要手动点击，不会自动计费';
    }
    $('translation-global-reset').textContent = confirmation ? '确认恢复推荐设置' : '恢复翻译推荐设置';
    fields(globalFields, globalPolicy); fields(chatFields, chatPolicy);
    $('translation-receive-auto').checked = globalPolicy.translationMode === 'auto';
    $('translation-channel-receive-auto').checked = chatPolicy.translationMode === 'auto';
    $('translation-chat-override').checked = override;
    $('translation-chat-custom').classList.toggle('hidden', !override);
    $('translation-auto-send').checked = chatPolicy.enabled && chatPolicy.autoSend;
    popover.querySelector('.translation-head-copy').querySelector('small').textContent
      = account ? `${account.name}，独立保存，修改后自动生效` : '请先选择账号';
    $('translation-chat-mode').textContent = contextPending ? '正在读取聊天…' : hasChat ? (override ? '单独设置' : '跟随全局') : '未检测到聊天';
    $('translation-chat-mode').dataset.state = hasChat ? (override ? 'custom' : 'global') : 'idle';
    $('translation-chat-hint').textContent = !supported ? '此平台尚未接通翻译。'
      : contextError || (hasChat ? `当前聊天：${context.chat.name || '未命名聊天'}。本次设置固定到此聊天，其他选项跟随全局。` : '请先在当前账号打开一个聊天，再重新打开翻译设置。');
    const status = sessionStatus(session, sessionError);
    $('translation-service-state').textContent = status.label; $('translation-service-state').dataset.state = status.kind;
    $('translation-service-detail').textContent = !supported ? '此平台的翻译尚未迁移。' : status.detail;
    $('translation-service-detail').dataset.state = status.kind;
    $('translation-session-open').hidden = session?.state === 'signedIn';
    $('translation-gateway-test').disabled = !connected || shellBusy || checking;
    const gatewayStatus = healthStatus(health, healthError, checking);
    $('translation-gateway-status').textContent = gatewayStatus.text;
    $('translation-gateway-status').dataset.state = gatewayStatus.state;
    for (const node of popover.querySelectorAll('.translation-tab')) {
      const active = node.dataset.translationTab === tab;
      node.classList.toggle('active', active); node.setAttribute('aria-selected', String(active));
      node.tabIndex = active ? 0 : -1;
      $(`translation-tab-${node.dataset.translationTab}`).classList.toggle('hidden', !active);
    }
    saveStatus('global', globalDraft, confirmation); saveStatus('chat', chatDraft);
    $('translation-global-feedback').hidden = tab === 'channel';
    $('translation-chat-feedback').hidden = tab !== 'channel';
    const activeDraft = tab === 'channel' ? chatDraft : globalDraft;
    feedback.hidden = supported && !confirmation && !activeDraft?.saving && !activeDraft?.error && !activeDraft?.saved;
    if (!supported) $('translation-global-status').textContent = '当前平台尚未接通翻译，设置不可更改。';
    preview(globalPolicy.fontSize, globalPolicy.fontColor);
  }
  function read(mapping, base, autoId) {
    const result = { ...base };
    for (const [id, key] of Object.entries(mapping)) {
      result[key] = typeof base[key] === 'boolean' ? $(id).checked : key === 'fontSize' ? Number($(id).value) : $(id).value;
    }
    result.translationMode = $(autoId).checked ? 'auto' : 'click';
    result.autoSend = result.enabled;
    if (result.translationMode === 'auto') result.displayTranslation = true;
    if (autoId === 'translation-receive-auto' && result.translationMode === 'click') result.groupAuto = false;
    return result;
  }
  return { render,
    readGlobal: (base) => read(globalFields, base, 'translation-receive-auto'),
    readChat: (base) => chatPolicyFrom(read(chatFields, base, 'translation-channel-receive-auto')),
    dispose: () => listeners.forEach((remove) => remove()),
  };
}
