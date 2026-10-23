// The real tweb interfaces consumed by the adapter. No platform request method exists.
// rootScope sends MyMessage directly; history cache and peer cache are synchronous.
export function telegramKRuntime(f) {
  const emitter = () => {
    const listeners = new Map();
    return {
      addEventListener(name, callback) { const set = listeners.get(name) || new Set(); set.add(callback); listeners.set(name, set); },
      removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
      emit(name, value) { for (const callback of [...(listeners.get(name) || [])]) callback(value); },
      listeners,
    };
  };
  const root = { ...emitter(), myId: 900 };
  const im = { ...emitter(), chat: { container: f.outer, peerId: Number(f.window.location.hash.slice(1)), type: 'chat' } };
  const messages = new Map(); const peers = new Map();
  const proxy = {
    getMessageFromStorage: (key, mid) => messages.get(`${key}:${mid}`),
    getPeer: (peer) => peers.get(peer),
  };
  f.window.rootScope = root; f.window.appImManager = im; f.window.apiManagerProxy = proxy;
  const peer = (id, fields = {}) => {
    const value = { _: id < 0 ? 'chat' : 'user', id: Math.abs(id), pFlags: {}, ...fields };
    peers.set(id, value); return value;
  };
  peer(im.chat.peerId);
  const message = (row, fields = {}) => ({ _: 'message', mid: Number(row.root.getAttribute('data-mid')),
    peerId: Number(row.root.getAttribute('data-peer-id')), date: Number(row.root.getAttribute('data-timestamp')),
    fromId: Number(row.root.getAttribute('data-peer-id')) > 0 ? Number(row.root.getAttribute('data-peer-id')) : 321,
    pFlags: {}, message: row.body.textContent, ...fields });
  const put = (model) => { messages.set(`${model.peerId}_history:${model.mid}`, model); return model; };
  const receive = (row, fields = {}, { mirror = true } = {}) => {
    const value = message(row, fields); if (mirror) put(structuredClone(value));
    root.emit('history_multiappend', value); return value;
  };
  const select = (id, fields = {}) => {
    im.emit('peer_changing', im.chat); f.navigate(String(id));
    im.chat.peerId = id; im.chat.type = 'chat'; Object.assign(im.chat, fields); peer(id); f.replaceList();
  };
  return { root, im, proxy, peers, messages, peer, message, put, receive, select };
}
