if (!window.WUPE || !window.require) {
  console.error('[WUP] Missing dependencies');
  throw new Error('Missing dependencies');
}
window.WUPE.DEBUG_LOGS = window.WUPE.DEBUG_LOGS !== undefined ? window.WUPE.DEBUG_LOGS : false;
const debugLog = (...args) => {
  if (window.WUPE.DEBUG_LOGS) {
    console.log(...args);
  }
};
const debugError = (...args) => {
  if (window.WUPE.DEBUG_LOGS) {
    console.error(...args);
  }
};
const debugWarn = (...args) => {
  if (window.WUPE.DEBUG_LOGS) {
    console.warn(...args);
  }
};

window.WUPE.chat.DCCAV2 = async function (inputId) {
  if (inputId.includes('@g.us')) {
    return { success: true, finalChatId: inputId };
  }
  const WF = require('WAWebWidFactory');
  const WAWebFindChatAction = require('WAWebFindChatAction');
  const chatStore = WUPE.chat.chat_();
  let existingChat = chatStore.get(inputId);
  if (!existingChat && !inputId.includes('@')) {
    existingChat = chatStore.get(inputId + '@c.us');
  }
  if (existingChat) {
    return {
      success: true,
      finalChatId: existingChat.id._serialized,
      chat: existingChat,
    };
  }
  let wid;
  if (inputId.includes('@')) {
    wid = WF.createWid(inputId);
  } else {
    wid = WF.createWid(inputId + '@c.us');
  }
  try {
    const { chat } = await WAWebFindChatAction.findOrCreateLatestChat(wid, 'newChatFlow');
    return {
      success: true,
      finalChatId: chat.id._serialized,
      chat: chat,
    };
  } catch (e) {
    return {
      success: false,
      error: e?.message || String(e),
      inputId,
    };
  }
};
window.WUPE.chat.stm = async function (c, m, le) {
  if (!m || m == ' ') return;
  const w = window.require;
  const C = window.WUPE.chat;
  const W = window.WUPE.wa;
  const s1 = w('WAWebSendTextMsgChatAction').sendTextMsgToChat;
  let ch = null;
  if (c.includes('@g.us')) {
    ch = C.chat_().get(c);
  } else {
    let verifica_chat = await WUPE.chat.DCCAV2(c);
    if (!verifica_chat?.success) {
      return { error: verifica_chat?.error };
    }
    c = verifica_chat.finalChatId;
    ch = verifica_chat.chat || C.chat_().get(c);
    if (!ch) {
      return { error: '在收藏中未找到聊天' };
    }
  }
  const procMenc = async (msg) => {
    if (ch.isGroup) {
      if (le?.tagall) {
        const g = W.gmd(ch.id),
          mc = g.participants.map((e) => e.id),
          r = await window.WUPE.loader.verificaArrayLid(mc);
        msg.mentionedJidList = r.result;
      }
    }
  };
  let msg = {};
  const hasLink = m.includes('http'),
    noPreview = (hasLink === false && !le?.wulp) || le?.lp === false;
  await procMenc(msg);
  if (le?.quotedMsg) {
    let q = await C.getMsg(le.quotedMsg);
    msg = noPreview ? { quotedMsg: q } : { ...msg, quotedMsg: q };
  }
  if (!noPreview) {
    if (le?.lp || (!le?.lp && !le?.wulp)) {
      let p = await w('WAWebGenMinimalLinkPreviewChatAction').genMinimalLinkPreview(m);
      if (p) msg.linkPreview = p.data;
    } else if (le?.wulp) {
      let p = await w('WAWebGenMinimalLinkPreviewChatAction').genMinimalLinkPreview2(le.wulp);
      msg.ctwaContext = {
        description: p.data.description,
        title: p.data.title,
        sourceUrl: p.data.canonicalUrl,
        thumbnailUrl: 'data:image/jpeg;base64,' + p.data.thumbnail,
        renderLargerThumbnail: true,
        mediaType: 1,
        thumbnail: p.data.thumbnail,
      };
    }
  }
  return await s1(ch, m, msg);
};
window.WUPE.chat.sfm = async function (c, f, o = {}) {
  const w = window.require;
  const C = window.WUPE.chat;
  const W = window.WUPE.wa;
  const chat_ = C.chat_;
  const createUser = C.createUser;
  const gmd = W.gmd;
  const verificaArrayLid = window.WUPE.loader.verificaArrayLid;
  const getMsg = C.getMsg;
  const convertToFile = window.WUPE.loader.convertToFile;
  const fetchTrans = window.WUPE.loader.fetchTrans;
  let ch = null;
  if (c.includes('@g.us')) {
    ch = C.chat_().get(c);
  } else {
    let verifica_chat = await WUPE.chat.DCCAV2(c);
    if (!verifica_chat?.success) {
      return { error: verifica_chat?.error };
    }
    c = verifica_chat.finalChatId;
    ch = verifica_chat.chat || C.chat_().get(c);
    if (!ch) {
      return { error: '在收藏中未找到聊天' };
    }
  }
  const file = await convertToFile(f, o.mimetype, o.filename);
  const createFromData = w('WAWebMediaOpaqueData').createFromData;
  const mediaData = await createFromData(file, file.type);
  const prepOptions = {
    isPtt: o.isPtt,
    asDocument: o.asDocument,
    asGif: o.asGif,
    isAudio: o.type === 'audio',
    asSticker: o.asSticker,
    precomputedFields: { duration: null, waveform: null },
  };
  if (o.type === 'audio' && o.isPtt) {
    try {
      const ab = await file.arrayBuffer();
      const ac = new AudioContext();
      const decoded = await ac.decodeAudioData(ab);
      const channelData = decoded.getChannelData(0);
      const samples = 64;
      const blockSize = Math.floor(channelData.length / samples);
      const amplitudes = [];
      for (let i = 0; i < samples; i++) {
        const start = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum += Math.abs(channelData[start + j]);
        }
        amplitudes.push(sum / blockSize);
      }
      const max = Math.max(...amplitudes);
      const normalized = amplitudes.map((a) => a / max);
      const waveform = new Uint8Array(normalized.map((n) => Math.floor(100 * n)));
      prepOptions.precomputedFields = {
        duration: Math.floor(decoded.duration),
        waveform: waveform,
      };
    } catch (e) {}
  } else if (o.type === 'document') {
    prepOptions.asDocument = true;
  } else if (o.type === 'sticker') {
    prepOptions.asSticker = true;
  } else if (o.type === 'video' && o.isGif) {
    prepOptions.asGif = true;
  }
  const preparedMedia = w('WAWebMedia').prepRawMedia(mediaData, prepOptions);
  let extra = {};
  if (o.markIsRead) {
    await w('WAWebUpdateUnreadChatAction').sendSeen({ chat: ch, threadId: null });
  }
  await preparedMedia.waitForPrep();
  if (o.wulp) {
    const lp = await w('WAWebGenMinimalLinkPreviewChatAction').genMinimalLinkPreview2(o.wulp);
    extra.ctwaContext = {
      description: lp.data.description,
      title: lp.data.title,
      sourceUrl: lp.data.canonicalUrl,
      thumbnailUrl: 'data:image/jpeg;base64,' + lp.data.thumbnail,
      renderLargerThumbnail: true,
      mediaType: 1,
      thumbnail: lp.data.thumbnail,
    };
  }
  if (ch.isGroup && o.tagall) {
    const g = gmd(ch.id);
    const participants = g.participants.map((e) => e.id);
    const r = await verificaArrayLid(participants);
    extra.mentionedJidList = r.result;
  }
  if (o.buttons) {
    extra.nativeFlowName = 'quick_reply';
    extra.interactiveHeader = {
      title: o.title || ' ',
      subtitle: o.subtitle || ' ',
      mediaType: o.type.toUpperCase(),
      thumbnail: undefined,
    };
    extra.interactivePayload = {
      messageVersion: 1,
      $$unknownFieldCount: 0,
      buttons: o.buttons.map((bt, i) =>
        bt.startsWith('http://') || bt.startsWith('https://')
          ? {
              $$unknownFieldCount: 0,
              name: 'cta_url',
              buttonParamsJson: JSON.stringify({
                display_text: bt.split('|')[1] || 'Acesse já!',
                url: bt.split('|')[0] || bt,
                merchant_url: bt.split('|')[0] || bt,
              }),
            }
          : {
              $$unknownFieldCount: 0,
              name: 'quick_reply',
              buttonParamsJson: JSON.stringify({
                display_text: bt,
                id: 'MYID' + i,
              }),
            }
      ),
    };
    extra.interactiveType = 'native_flow';
    extra.kind = 'interactive';
    extra.type = 'interactive';
    extra.caption = o.caption;
  }
  if (o.quotedMsg) {
    extra.quotedMsg = await getMsg(o.quotedMsg);
  }
  if (c === 'status@broadcast') {
    return {
      result: await w('WAWebWhatsUpPlusStatusMedia').sendMediaMsgToChat(preparedMedia, ch, {
        addEvenWhilePreparing: false,
        caption: o.caption,
        type: o.type,
        backgroundColor: o.backgroundColor || null,
      }),
    };
  }
  if ((o.type === 'image' || o.type === 'video') && o.caption && o.caption !== '') {
    let contatos = localStorage.getItem('contatos_traduzir');
    let contatosTraduzir = JSON.parse(contatos || '[{"error":"error"}]');
    let contato = contatosTraduzir.filter((f) => f.id == ch.id._serialized);
    let meu_nome = localStorage.getItem('meu_nome') ? '*' + localStorage.getItem('meu_nome') + ':*\n\n' : '';
    if (contato[0]) {
      let trans = { text: o.caption, target: contato[0].target };
      let traducao = await fetchTrans(trans);
      o.caption = meu_nome !== '' ? meu_nome + traducao.result : traducao.result;
    } else if (meu_nome !== '') {
      o.caption = meu_nome + o.caption;
    }
  }
  const result = await w('WAWebMediaPrep').sendMediaMsgToChat({
    chat: ch,
    options: {
      addEvenWhilePreparing: false,
      caption: o.caption,
      type: o.buttons ? 'interactive' : o.type,
      ...extra,
    },
    prep: preparedMedia,
    earlyUpload: null,
  });
  if (o.waitForAck) await result;
  return { sendMsgResult: result };
};
window.WUPE.__premiumLoaded = true;
console.log('[WUP] Premium functions loaded');
console.log('[WUP] stm:', typeof window.WUPE.chat.stm);
console.log('[WUP] sfm:', typeof window.WUPE.chat.sfm);
console.log('[WUP] Para ativar logs de debug: window.WUPE.DEBUG_LOGS = true');
console.log('[WUP] Para desativar logs: window.WUPE.DEBUG_LOGS = false');
