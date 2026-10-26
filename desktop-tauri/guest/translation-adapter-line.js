// Manual incoming display for the LINE extension page.
// The row does not prove direction or send time, so paid automatic translation stays closed.
function lineTranslationAdapter(platform) {
  const rowSelector = '[class*="message-module__message__"][data-mid]';
  const matches = (generation) => pageOwned('line') && window.__geekTauriPlatform?.matches(generation) === true;
  function messageId(row) {
    const value = String(row.getAttribute?.('data-mid') || '');
    return /^[A-Za-z0-9][A-Za-z0-9+/=_.-]{0,127}$/.test(value) ? value : '';
  }
  return {
    platform, automatic: false, rowSelector, matches,
    context() {
      const id = pageConversationId('line');
      if (!id) return null;
      const selected = document.querySelector(
        '[class*="chatlistItem-module__chatlist_item__"][data-mid][aria-current="true"]');
      const title = selected?.querySelector?.('[class*="chatlistItem-module__title_box__"]');
      const name = pageNormalize(title?.innerText || title?.textContent || '')
        .replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 256);
      return { id, name };
    },
    rows(chat) {
      if (pageConversationId('line') !== chat?.id) return [];
      return [...document.querySelectorAll(rowSelector)]
        .filter((row) => !row.closest?.('.geek-translation-result, #geek-translation-menu')).slice(-200);
    },
    read(root, chat) {
      if (!root?.isConnected || !root.matches?.(rowSelector) || pageConversationId('line') !== chat?.id) return null;
      const textNode = root.querySelector('[data-message-content][data-is-message-text="true"]');
      const text = pageNormalize(textNode?.innerText || textNode?.textContent || '');
      const id = messageId(root);
      if (!text || !id || /^[-+]?\d+(?:[.,]\d+)?$/.test(text)) return null;
      const node = textNode.closest?.('[class*="textMessageContent-module__content_wrap__"]')
        || root.querySelector('[class*="message-module__content_inner__"]') || textNode;
      return { node, messageId: id, text, incoming: false, sentAt: 0, observation: 'manual' };
    },
  };
}
