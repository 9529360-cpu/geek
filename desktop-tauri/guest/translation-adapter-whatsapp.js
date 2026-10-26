// Existing WA read contract. Never shared with Telegram IDs or send adapters.
function whatsappTranslationAdapter() {
  const rowSelector = '[data-testid^="conv-msg-"][data-id]';
  const wid = (value) => typeof value === 'string' ? value : value?._serialized || '';
  const textOf = (node) => String(node?.querySelector('span[dir="ltr"],span[dir="rtl"]')?.innerText
    || node?.innerText || node?.textContent || '').replace(/\u200b/g, '').trim();
  return {
    platform: 'whatsapp', automatic: true, rowSelector,
    matches: (generation) => window.__geekTauriPlatform?.matches(generation) === true,
    context() {
      try {
        const chat = window.WPP?.chat?.getActiveChat?.(); const id = wid(chat?.id);
        if (!/^\d[\d-]{0,39}@(c\.us|lid|g\.us)$/.test(id)
          || chat.isNewsletter || chat.isBroadcast || chat.isParentGroup || chat.groupMetadata?.parent) return null;
        const name = String(chat.formattedTitle || chat.name || chat.contact?.pushname || id)
          .replace(/[\x00-\x1f\x7f]/g, '').slice(0, 256);
        return { id, name };
      } catch { return null; }
    },
    rows: () => [...document.querySelectorAll(`#main ${rowSelector}`)].slice(-200),
    read(root, chat) {
      const node = root.querySelector('[data-pre-plain-text]');
      const messageId = root.getAttribute('data-id') || '';
      let incoming = false; let sentAt = 0;
      try {
        const message = window.WPP?.whatsapp?.MsgStore?.get?.(messageId);
        incoming = message?.id?.fromMe === false && wid(message?.id?.remote) === chat.id;
        if (incoming && Number.isSafeInteger(message.t) && message.t > 0) sentAt = message.t;
      } catch { /* Missing metadata is manual-only. */ }
      return node ? { node, messageId, text: textOf(node), incoming, sentAt, observation: 0 } : null;
    },
  };
}
