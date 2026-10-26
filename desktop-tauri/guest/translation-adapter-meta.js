// Manual incoming display for Messenger and Instagram. Direction and send time
// are not proved by the page, so paid automatic translation stays closed.
function metaTranslationAdapter(platform) {
  const kind = platform === 'instagram' ? 'instagram' : 'messenger';
  const rowSelector = '[role="main"] [role="row"]';
  const matches = (generation) => pageOwned(kind) && window.__geekTauriPlatform?.matches(generation) === true;
  const ours = (node) => node?.closest?.('.geek-translation-result, #geek-translation-menu');
  function body(row) {
    const clone = row.cloneNode(true);
    clone.querySelectorAll('button, [role="button"], [contenteditable="true"], .geek-translation-result, [aria-hidden="true"]')
      .forEach((node) => node.remove());
    return pageNormalize(clone.innerText || clone.textContent || '');
  }
  function messageId(row) {
    const existing = row.dataset?.geekMessageKey || '';
    if (/^[0-9a-f-]{36}$/i.test(existing)) return existing;
    if (typeof crypto?.randomUUID !== 'function') return '';
    const id = crypto.randomUUID();
    row.dataset.geekMessageKey = id;
    return id;
  }
  return {
    platform, automatic: false, rowSelector, matches,
    context() {
      const id = pageConversationId(kind);
      if (!id) return null;
      const header = document.querySelector('[role="main"] h1, [role="main"] h2');
      const name = pageNormalize(header?.innerText || header?.textContent || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 256);
      return { id, name };
    },
    rows(chat) {
      if (pageConversationId(kind) !== chat?.id) return [];
      return [...document.querySelectorAll(rowSelector)].filter((row) => !ours(row)).slice(-200);
    },
    read(root, chat) {
      if (!root?.isConnected || pageConversationId(kind) !== chat?.id || root.querySelector('[contenteditable="true"]')) return null;
      const node = root;
      const text = body(root);
      const id = messageId(root);
      if (!text || !id) return null;
      return { node, messageId: id, text, incoming: false, sentAt: 0, observation: 'manual' };
    },
  };
}
