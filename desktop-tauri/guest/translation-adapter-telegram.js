// Read-only Web A/K adapters. Message/pending/result ownership stays in translation.js.
// Source contracts: Ajaxy/telegram-tt Message/MessageMeta/Avatar and
// morethanwords/tweb ChatBubbles: data-mid + data-peer-id, .message and .time.
function telegramTranslationAdapter(platform, invalidate, eligibility) {
  const isA = platform === 'telegram-z';
  const rowSelector = isA ? '.Message[data-message-id]' : '.bubble[data-mid][data-peer-id]';
  const versions = new WeakMap();
  const owners = new WeakMap();
  const listOwners = new WeakMap();
  let epoch = 0;
  let incoming = null;
  const integer = (value, signed = false) => {
    if (!(signed ? /^-?[1-9]\d{0,18}$/ : /^[1-9]\d{0,18}$/).test(value)) return false;
    const number = BigInt(value);
    return number >= -9223372036854775808n && number <= 9223372036854775807n;
  };
  const matches = () => {
    const url = window.location;
    return url?.protocol === 'https:' && url.hostname === 'web.telegram.org'
      && (!url.port || url.port === '443') && !url.username && !url.password
      && [isA ? '/a' : '/k', isA ? '/a/' : '/k/'].includes(url.pathname) && !url.search;
  };
  const displayed = (node) => {
    if (!node?.isConnected || node.closest('[hidden],[aria-hidden="true"]')) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const ours = (node) => node?.nodeType === 1 && (node.matches('.geek-translation-result,#geek-translation-menu')
    || node.closest('.geek-translation-result,#geek-translation-menu'));
  const ownRows = (element, peer) => {
    if (!element?.querySelectorAll || !peer) return;
    const rows = [...(element.matches(rowSelector) ? [element] : []), ...element.querySelectorAll(rowSelector)];
    for (const row of rows) if (!owners.has(row)) owners.set(row, `tg:${peer}`);
  };
  const mark = (node, descendants = false) => {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    if (!element || ours(element)) return;
    const row = element.closest(rowSelector);
    if (row) versions.set(row, (versions.get(row) || 0) + 1);
    if (descendants) for (const child of element.querySelectorAll(rowSelector)) versions.set(child, (versions.get(child) || 0) + 1);
  };
  function changed(records) {
    for (const record of records) {
      if (ours(record.target)) continue;
      const nodes = [...(record.addedNodes || []), ...(record.removedNodes || [])];
      if (record.type === 'childList' && nodes.length && nodes.every(ours)) continue;
      // Remember even offscreen/unread rows before a keyed list can remove/move them.
      if (isA && record.type === 'childList') {
        const owner = listOwners.get(record.target.closest?.('.MessageList'));
        for (const node of nodes) ownRows(node, owner);
      }
      mark(record.target);
      for (const node of nodes) mark(node, true);
      if (record.type === 'attributes' && (record.target.matches?.('.MessageList,.chat')
          || record.target.closest?.('.MiddleHeader'))) epoch += 1;
    }
  }
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['class', 'data-message-id', 'data-mid', 'data-peer-id', 'data-type', 'hidden', 'aria-hidden'] });
  const invalidated = () => { epoch += 1; incoming?.reset(); invalidate(); };
  window.addEventListener('hashchange', invalidated);
  document.addEventListener('visibilitychange', invalidated);
  const flush = () => changed(observer.takeRecords());

  function scope() {
    flush();
    if (!matches() || document.visibilityState === 'hidden') return null;
    const peer = window.location.hash.slice(1);
    // Threads, pinned/scheduled lists, public username links and searches are not ordinary chats.
    if (!integer(peer, true)) return null;
    if (isA) {
      const middle = document.querySelector('#MiddleColumn');
      if (!middle || !displayed(middle)) return null;
      const headers = [...middle.querySelectorAll('.MiddleHeader .ChatInfo [data-peer-id]')].filter(displayed);
      if (headers.length !== 1 || headers[0].getAttribute('data-peer-id') !== peer) return null;
      const lists = [...middle.querySelectorAll('.MessageList')].filter(displayed);
      if (lists.length !== 1 || lists[0].matches('.is-animating,.type-pinned,.saved-dialog')) return null;
      // MiddleColumn keys MessageList by chat/thread/type (official source). A header
      // update cannot reauthorize the prior list while its old DOM is still visible.
      if (listOwners.has(lists[0]) && listOwners.get(lists[0]) !== peer) return null;
      listOwners.set(lists[0], peer);
      ownRows(lists[0], peer);
      return { peer, container: lists[0] };
    }
    const chats = [...document.querySelectorAll('.chat[data-type="chat"]')].filter(displayed);
    if (chats.length !== 1) return null;
    const lists = [...chats[0].querySelectorAll('.bubbles-inner')].filter(displayed);
    if (lists.length !== 1) return null;
    return { peer, outer: chats[0], container: lists[0] };
  }

  // Only the actual body is read. Metadata/reply previews never become source text.
  const ignored = '.MessageMeta,.time,.message-time,.Reactions,.reactions,.reactions-element,'
    + '.reply,.reply-wrapper,.embedded-message,.clearfix-sizer,.geek-translation-result';
  const unsupported = 'img,video,audio,canvas,svg,input,textarea,button,iframe,object,'
    + '.spoiler,.spoiler-text,.custom-emoji,.content-unsupported,.translation-animation,'
    + '.message-translated,.summary-header';
  function plainText(node) {
    let count = 0;
    const visit = (part) => {
      if (++count > 4000) throw new Error('bounded body');
      if (part.nodeType === 3) return part.textContent;
      if (part.nodeType !== 1) return '';
      if (part.matches(ignored) || part.hidden || part.getAttribute('aria-hidden') === 'true') return '';
      const tag = part.tagName.toUpperCase();
      if (part.matches(unsupported) || !['DIV', 'SPAN', 'A', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'CODE', 'PRE'].includes(tag)) {
        throw new Error('unsupported body');
      }
      if (tag === 'BR') return '\n';
      return [...part.childNodes].map(visit).join('');
    };
    try { return visit(node).replace(/\u200b/g, '').trim(); } catch { return ''; }
  }
  // Capture the currently loaded list before the first native poll or user gesture.
  scope();
  if (!isA) incoming = telegramKIncoming(scope, eligibility, invalidated);
  return {
    platform: 'telegram', automatic: !isA, rowSelector, matches,
    resetAutomatic() { incoming?.reset(); },
    claimAutomatic(entry) { return incoming?.claim(entry) === true; },
    close() { incoming?.close(); },
    context() {
      incoming?.sync();
      const current = scope();
      return current ? { id: `tg:${current.peer}`, name: current.peer } : null;
    },
    rows(chat) {
      const current = scope();
      return current && chat.id === `tg:${current.peer}` ? [...current.container.querySelectorAll(rowSelector)].slice(-200) : [];
    },
    read(root, chat) {
      const current = scope();
      if (!current || chat.id !== `tg:${current.peer}` || !current.container.contains(root) || !displayed(root)) return null;
      const messageId = root.getAttribute(isA ? 'data-message-id' : 'data-mid') || '';
      if (!integer(messageId) || (!isA && root.getAttribute('data-peer-id') !== current.peer)) return null;
      if (isA && root.id !== `message-${messageId}`) return null;
      // A has no peer attribute on rows: never adopt an old peer's DOM node.
      if (isA && owners.has(root) && owners.get(root) !== chat.id) return null;
      if (root.matches('.is-album,.is-in-document-group,.is-sponsored,.is-service,.service,.is-ephemeral,.is-deleting,.is-dissolving')
        || root.querySelector('.attachment,.media-container,.Photo,.Video,.Audio,.Document,.Poll,.WebPage,.message-translated,.summary-header')) return null;
      const nodes = [...root.querySelectorAll(isA ? '.content-inner > .text-content' : '.bubble-content > .message')]
        .filter((node) => node.closest(rowSelector) === root);
      if (nodes.length !== 1) return null;
      const duplicates = [...current.container.querySelectorAll(rowSelector)]
        .filter((row) => row.getAttribute(isA ? 'data-message-id' : 'data-mid') === messageId
          && (isA || row.getAttribute('data-peer-id') === current.peer));
      if (duplicates.length !== 1) return null;
      const node = nodes[0]; const text = plainText(node);
      if (!text) return null;
      owners.set(root, chat.id);
      return { node, messageId, text, incoming: false, sentAt: 0,
        ...incoming?.proof(root, messageId, text), observation: `${epoch}:${versions.get(root) || 0}` };
    },
  };
}
