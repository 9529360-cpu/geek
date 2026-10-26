import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { guest } from './send-guest.mjs';

const source = readFileSync(new URL('../../guest/whatsapp-mentions.js', import.meta.url), 'utf8');
const create = runInNewContext(`${source}\ncreateWhatsAppMentions`, { TextEncoder });
export const mentionId = '15550001111@c.us';
export const lidId = '987650001111@lid';
export const marker = (id) => `\u200b${id}\u200b`;

export function mentionsFixture({ parts = ['Hello ', { id: mentionId, name: 'Alice' }, ', please confirm.'], policy = {},
  chatId = '120363001@g.us', session } = {}) {
  const ui = guest({ policy, ...(session === undefined ? {} : { session }) });
  const W = ui.window.WPP;
  const { ModelEvents, Wid, ContactModel } = W.whatsapp;
  class Collection extends ModelEvents {
    constructor() { super(); this.models = new Map(); }
    get(id) { return this.models.get(String(id)); }
    add(model) { this.models.set(String(model.id), model); this.emit('add', model); }
    remove(id) { const model = this.get(id); this.models.delete(String(id)); this.emit('remove', model); return model; }
  }
  class ParticipantModel extends ModelEvents {
    constructor(id) { super(); this.field('id', id); }
  }
  class GroupMetadataModel extends ModelEvents {
    constructor(id) {
      super(); this.field('id', new Wid(id)); this.field('isParentGroup', false); this.field('isLidAddressingMode', false);
      this.field('participants', new Collection());
    }
  }
  const contacts = new Collection();
  const self = { pn: new Wid('16660009999@c.us'), lid: new Wid('999660009999@lid') };
  Object.assign(W.whatsapp, { ParticipantModel, GroupMetadataModel, ContactStore: contacts,
    UserPrefs: { getMaybeMePnUser: () => self.pn, getMaybeMeLidUser: () => self.lid } });
  ui.switchChat(chatId);
  const chat = ui.model(chatId);
  chat.field('groupMetadata', new GroupMetadataModel(chatId));
  chat.field('draftMessage', { text: '', timestamp: 1 });
  chat.getComposeContents = () => ({ ...chat.draftMessage });
  const elements = [];
  const setParts = (nextParts, { paragraph = true, trusted = false } = {}) => {
    if (trusted) ui.document.fire('beforeinput', { target: ui.editor });
    ui.editor.textContent = '';
    elements.length = 0;
    const parent = paragraph ? ui.document.createElement('p') : ui.editor;
    if (paragraph) ui.editor.append(parent);
    let raw = '';
    for (const part of nextParts) {
      if (typeof part === 'string') { parent.append(part); raw += part; continue; }
      if (!contacts.get(part.id)) contacts.add(new ContactModel(part.name, new Wid(part.id)));
      if (!chat.groupMetadata.participants.get(part.id)) chat.groupMetadata.participants.add(new ParticipantModel(new Wid(part.id)));
      const node = ui.document.createElement('span');
      node.setAttribute('class', 'x1ph7ams'); node.setAttribute('data-lexical-text', 'true');
      node.setAttribute('data-app-text-template', marker(part.id)); node.textContent = `@${part.name}`;
      parent.append(node); elements.push(node); raw += marker(part.id);
    }
    ui.state.text = raw; chat.draftMessage = { text: raw, timestamp: 1 };
    if (trusted) ui.document.fire('input', { target: ui.editor });
    return raw;
  };
  setParts(parts);
  const value = () => ({ W, chat, chatId: ui.state.chatId, editor: ui.editor, footer: ui.footer });
  const adapter = create({ normalize: (text) => String(text || '').replace(/\r\n?/g, '\n').replace(/\u200b/g, '').trim(),
    visible: (node) => Boolean(node?.isConnected && node.getClientRects().length && !node.hidden),
    issue: () => Object.assign(new Error('SEND_INTENT_UNSUPPORTED'), { code: 'SEND_INTENT_UNSUPPORTED' }) });
  return { ui, W, chat, contacts, self, elements, setParts, value, adapter, read: () => adapter.read(value()),
    get metadata() { return chat.groupMetadata; }, get participants() { return chat.groupMetadata.participants; } };
}
