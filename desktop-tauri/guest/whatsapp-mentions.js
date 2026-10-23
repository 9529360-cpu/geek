// Official WAWebMentionNode writes a ZWS-wrapped Wid into this exact DOM
// attribute; WAWebEditorStatePlugin projects it to @wid.user + mentionedJidList.
// Read only loaded models and the existing draft. No query, send or draft write.
function createWhatsAppMentions({ normalize, visible, issue }) {
  const marker = 'data-app-text-template';
  const userId = /^[1-9]\d{0,29}@(c\.us|lid)$/;
  const wrappedId = /^\u200b([1-9]\d{0,29}@(c\.us|lid))\u200b$/;
  const textAttributes = new Set(['class', 'dir', 'style', 'data-lexical-text', 'data-lexical-linebreak']);
  const names = ['name', 'shortName', 'pushname', 'notifyName', 'formattedName', 'displayName', 'mentionName', 'verifiedName'];
  const owned = new WeakSet();
  const listenable = (target) => target && typeof target.on === 'function' && typeof target.off === 'function';
  const idOf = (value) => typeof value === 'string' ? value : value?._serialized || '';
  const same = (left, right) => left.length === right.length && left.every((item, index) => item === right[index]);
  const badText = /[\x00-\x08\x0b-\x1f\x7f\u200b]/;

  function userWid(W, value, expected) {
    const Wid = W?.whatsapp?.Wid;
    if (typeof Wid !== 'function' || !(value instanceof Wid) || !userId.test(expected)
        || value._serialized !== expected || value.toString() !== expected
        || `${value.user}@${value.server}` !== expected || value.isUser() !== true
        || value.isBot() !== false || value.isGroup() !== false) throw issue();
    return value;
  }

  function selfIds(W) {
    const prefs = W.whatsapp.UserPrefs;
    if (typeof prefs?.getMaybeMePnUser !== 'function' || typeof prefs.getMaybeMeLidUser !== 'function') throw issue();
    const result = [prefs.getMaybeMePnUser(), prefs.getMaybeMeLidUser()].map((wid, index) => {
      if (wid == null) return '';
      const id = idOf(wid);
      userWid(W, wid, id);
      if (!id.endsWith(index === 0 ? '@c.us' : '@lid')) throw issue();
      return id;
    });
    if (!result.some(Boolean)) throw issue();
    return result;
  }

  function loaded(value) {
    const { W, chat, chatId, editor, footer } = value;
    const types = W?.whatsapp;
    const metadata = chat?.groupMetadata;
    const participants = metadata?.participants;
    if (typeof types?.ChatModel !== 'function' || !(chat instanceof types.ChatModel)
        || typeof types.Wid !== 'function' || !(chat.id instanceof types.Wid)
        || idOf(chat.id) !== chatId || chat.id.toString() !== chatId
        || !/^[1-9]\d{0,29}(?:-\d{1,20})?@g\.us$/.test(chatId) || chat.isGroup !== true || chat.canSend !== true
        || chat.isReadOnly || chat.isBroadcast || chat.isNewsletter || chat.isParentGroup
        || typeof types.GroupMetadataModel !== 'function' || !(metadata instanceof types.GroupMetadataModel)
        || !(metadata.id instanceof types.Wid) || idOf(metadata.id) !== chatId || metadata.isParentGroup !== false
        || typeof types.ParticipantModel !== 'function' || typeof types.ContactModel !== 'function'
        || typeof participants?.get !== 'function' || typeof types.ContactStore?.get !== 'function'
        || !listenable(chat) || !listenable(metadata) || !listenable(participants) || !listenable(types.ContactStore)
        || !visible(editor) || !visible(footer) || !footer.contains(editor)
        || editor.getAttribute('contenteditable') !== 'true') throw issue();
    return { metadata, participants, contacts: types.ContactStore, self: selfIds(W) };
  }

  function contactFor(value, owner, id, label) {
    const types = value.W.whatsapp;
    const contact = owner.contacts.get(id);
    const participant = owner.participants.get(id);
    if (!(contact instanceof types.ContactModel) || !(participant instanceof types.ParticipantModel)
        || !listenable(contact) || !listenable(participant)) throw issue();
    const wid = userWid(value.W, contact.id, id);
    userWid(value.W, participant.id, id);
    const own = owner.self[id.endsWith('@lid') ? 1 : 0];
    if (!own || own === id || contact.isMe === true) throw issue();
    const values = names.map((key) => contact[key]);
    const known = new Set(values.filter((name) => typeof name === 'string' && name.length <= 200 && !badText.test(name)));
    for (const key of ['pushname', 'notifyName']) if (typeof contact[key] === 'string') known.add(`~${contact[key]}`);
    if (!known.has(label.slice(1))) throw issue();
    return { contact, participant, wid, memberWid: participant.id, names: Object.freeze(values), id, label };
  }

  function read(value) {
    const { editor, chat } = value;
    if (!editor) return null;
    const roots = [...editor.querySelectorAll(`[${marker}]`)];
    const contents = typeof chat?.getComposeContents === 'function' ? chat.getComposeContents() : null;
    if (!roots.length) {
      if (typeof contents?.text === 'string' && /\u200b[^\u200b\n]*@[^\u200b\n]*\u200b/.test(contents.text)) throw issue();
      return null;
    }
    if (roots.length > 32 || !contents || typeof contents !== 'object' || Array.isArray(contents)
        || typeof contents.text !== 'string' || contents.text.length > 14000
        || Object.keys(contents).some((key) => !['text', 'timestamp'].includes(key))) throw issue();
    const owner = loaded(value);
    const entries = [], nodes = [], nodeValues = [], users = new Map();
    let text = '', parsable = '', ordinary = '';
    const remember = (node) => {
      if (nodes.length >= 512) throw issue();
      nodes.push(node);
      nodeValues.push(node.nodeType === 3 ? node.textContent
        : JSON.stringify([node.tagName, [...node.attributes].map((attr) => [attr.name, attr.value]).sort()]));
    };
    const plain = (source) => {
      if (typeof source !== 'string' || badText.test(source)) throw issue();
      text += source; parsable += source; ordinary += source;
      if (text.length > 12000) throw issue();
    };
    const element = (node, mention = false) => {
      if (!visible(node) || [...node.attributes].some((attr) => !textAttributes.has(attr.name)
          && !(mention && attr.name === marker))) throw issue();
      const dir = node.getAttribute('dir'), lexical = node.getAttribute('data-lexical-text');
      if (dir != null && !['auto', 'ltr', 'rtl'].includes(dir) || lexical != null && lexical !== 'true'
          || node.hasAttribute('style') && node.getAttribute('style').trim() !== '') throw issue();
    };
    const visit = (node, depth = 0) => {
      if (depth > 8) throw issue();
      remember(node);
      if (node.nodeType === 3) { plain(node.textContent); return; }
      if (node.nodeType !== 1 || !['SPAN', 'BR'].includes(node.tagName)) throw issue();
      const template = node.getAttribute(marker);
      element(node, template != null);
      if (template != null) {
        const match = wrappedId.exec(template);
        const label = node.textContent;
        if (!match || node.tagName !== 'SPAN' || node.getAttribute('data-lexical-text') !== 'true'
            || node.childNodes.length !== 1 || node.childNodes[0].nodeType !== 3
            || label.length < 2 || label.length > 201 || label[0] !== '@' || badText.test(label)) throw issue();
        const id = match[1], user = id.split('@')[0], canonical = `@${user}`;
        if (users.has(user) && users.get(user) !== id) throw issue();
        users.set(user, id);
        const entity = contactFor(value, owner, id, label);
        entries.push({ ...entity, node, offset: text.length, length: canonical.length });
        remember(node.childNodes[0]);
        text += canonical; parsable += template; ordinary += ' ';
      } else if (node.tagName === 'BR') {
        if (node.childNodes.length) throw issue();
        plain('\n');
      } else for (const child of node.childNodes) visit(child, depth + 1);
    };
    const children = [...editor.childNodes];
    if (children.some((node) => node.nodeType === 1 && node.tagName === 'P')) {
      if (children.some((node) => node.nodeType !== 1 || node.tagName !== 'P')) throw issue();
      children.forEach((paragraph, index) => {
        if (index) plain('\n');
        remember(paragraph); element(paragraph);
        // Lexical renders an empty paragraph with a placeholder BR, whose
        // editor-state text is empty rather than another explicit line break.
        const children = [...paragraph.childNodes];
        if (children.length === 1 && children[0].tagName === 'BR' && !children[0].hasAttribute(marker)) {
          if (children[0].childNodes.length) throw issue();
          remember(children[0]); element(children[0]);
        } else for (const child of children) visit(child);
      });
    } else for (const child of children) visit(child);
    // Match the actual editor-state projection, not layout innerText: Chromium
    // inserts two newlines between P elements while Lexical joins them with one.
    if (entries.length !== roots.length || parsable !== contents.text
        || /(^|\s)@[\p{L}\p{N}_]/u.test(ordinary)) throw issue();
    const left = text.length - text.trimStart().length;
    text = normalize(text);
    if (!text || text.length > 10000 || new TextEncoder().encode(text).length > 32768) throw issue();
    const wire = entries.map((entry) => Object.freeze({ id: entry.id, offset: entry.offset - left, length: entry.length }));
    const proof = Object.freeze({ W: value.W, chat, chatId: value.chatId, editor, footer: value.footer,
      ...owner, self: Object.freeze(owner.self), text, parsable, entries: Object.freeze(entries.map(Object.freeze)),
      nodes: Object.freeze(nodes), nodeValues: Object.freeze(nodeValues),
      metadataId: owner.metadata.id, addressingMode: owner.metadata.isLidAddressingMode,
      context: Object.freeze({ kind: 'mentions', mentions: Object.freeze(wire) }) });
    owned.add(proof);
    return { text, context: proof.context, proof };
  }

  function matches(proof, value) {
    if (!proof || !owned.has(proof)) return false;
    try {
      const current = read(value)?.proof;
      return Boolean(current && ['W', 'chat', 'chatId', 'editor', 'footer', 'metadata', 'participants', 'contacts',
        'text', 'parsable', 'metadataId', 'addressingMode'].every((key) => proof[key] === current[key])
        && same(proof.self, current.self) && same(proof.nodes, current.nodes) && same(proof.nodeValues, current.nodeValues)
        && proof.entries.length === current.entries.length && proof.entries.every((entry, index) => {
          const next = current.entries[index];
          return ['node', 'contact', 'participant', 'wid', 'memberWid', 'id', 'label', 'offset', 'length']
            .every((key) => entry[key] === next[key]) && same(entry.names, next.names);
        }));
    } catch { return false; }
  }

  function submitOptions(proof) {
    if (!proof || !owned.has(proof)) throw issue();
    return { mentionedList: [...new Set(proof.entries.map((entry) => entry.id))], detectMentioned: false };
  }

  function watch(proof, changed) {
    if (!proof || !owned.has(proof)) throw issue();
    let disposed = false;
    const subscriptions = [];
    const notify = () => { if (!disposed) changed(); };
    const bind = (target, events) => {
      if (!listenable(target)) throw issue();
      for (const event of events) {
        if (subscriptions.some(([old, name]) => old === target && name === event)) continue;
        target.on(event, notify); subscriptions.push([target, event]);
      }
    };
    bind(proof.chat, ['change:draftMessage', 'change:groupMetadata', 'change:id']);
    bind(proof.metadata, ['change:id', 'change:participants', 'change:isParentGroup', 'change:isLidAddressingMode']);
    bind(proof.participants, ['add', 'remove', 'reset', 'change:id']);
    bind(proof.contacts, ['remove', 'reset']);
    for (const entry of proof.entries) {
      bind(entry.contact, ['change:id', 'change:isMe', ...names.map((key) => `change:${key}`)]);
      bind(entry.participant, ['change:id']);
    }
    bind(proof.W, ['conn.authenticated', 'conn.logout', 'conn.require_auth']);
    return () => {
      if (disposed) return;
      disposed = true;
      for (const [target, event] of subscriptions) target.off(event, notify);
    };
  }

  return { read, matches, submitOptions, watch,
    allowsNode: (proof, node) => Boolean(proof && owned.has(proof) && proof.entries.some((entry) => entry.node === node)) };
}
