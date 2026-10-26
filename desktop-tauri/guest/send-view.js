// Original compact composer feedback; never renders message content as markup.
function createSendView() {
  let box = null;
  let timer = null;
  const messages = Object.freeze({
    SESSION_REQUIRED: '请先登录极客账户，原文未发送',
    SESSION_CHANGED: '登录状态已变化，原文未发送',
    SESSION_ACCOUNT_DISABLED: '极客账户已停用，原文未发送',
    SESSION_PERSISTENCE: '登录状态未能保存，原文未发送',
    TRANSLATION_QUOTA_EXHAUSTED: '翻译字符已用完，原文未发送',
    TRANSLATION_UNAUTHORIZED: '翻译授权失效，请重新登录',
    TRANSLATION_OUTPUT_INVALID: '译文未通过校验，请修改原文后重试',
    TRANSLATION_RESULT_UNAVAILABLE: '同一次译文暂不可取回，请稍后查询',
    TRANSLATION_CONFLICT: '翻译请求有冲突，原文未发送',
    TRANSLATION_TIMEOUT: '翻译结果待确认，再次发送可查询同一次结果',
    NETWORK_UNAVAILABLE: '翻译结果待确认，再次发送可查询同一次结果',
    NETWORK_RESPONSE_INVALID: '翻译服务返回异常，原文未发送',
    SEND_INTENT_UNSUPPORTED: '当前草稿暂不支持发送翻译，请检查引用、提及或附件；附件说明请点击预览中的发送按钮',
    SEND_INTENT_CHANGED: '聊天或草稿已变化，未发送',
    SEND_INTENT_BUSY: '上一条消息正在处理，请稍候',
    SEND_INTENT_LIMIT: '当前页面发送记录已满，请重新打开此账号页面',
    SEND_INTENT_CONFLICT: '发送请求已变化，原文未发送',
    SEND_INTENT_INVALID: '消息内容暂不支持发送翻译',
    SEND_INTENT_STATE: '发送通道暂不可用，原文已保留',
    TRANSLATION_CANCELLED: '翻译已取消，原文已保留',
  });
  function hide() {
    if (timer !== null) window.clearTimeout(timer);
    timer = null; box?.remove(); box = null;
  }
  function show(text, kind = 'working', temporary = false) {
    hide();
    box = document.createElement('div'); box.id = 'geek-translation-send-progress';
    box.className = 'translation-send-progress';
    box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); box.setAttribute('aria-atomic', 'true');
    Object.assign(box.style, { position: 'fixed', left: '50%', bottom: '82px', transform: 'translateX(-50%)',
      zIndex: '999999', padding: '8px 12px', borderRadius: '7px', maxWidth: 'calc(100vw - 40px)',
      background: kind === 'error' ? '#b42318' : '#202c33', color: '#fff', fontSize: '12px', lineHeight: '1.4',
      boxShadow: '0 8px 24px rgba(0,0,0,.35)', pointerEvents: 'none', whiteSpace: 'pre-wrap' });
    box.textContent = text; document.body.append(box);
    if (temporary) timer = window.setTimeout(hide, 2500);
  }
  function outcome(value) {
    if (value.status === 'confirmed') {
      show(value.draftCleared ? '已发送' : '已发送；输入框未清空，请自行清除', 'done', value.draftCleared);
    } else if (value.status === 'uncertain') show('发送结果未确认，请检查聊天记录；不会自动重发', 'error');
    else {
      const message = messages[value.code] || (value.retryable ? '未发送，原文已保留；可再次发送重试' : '未发送，原文已保留');
      show(message, 'error');
    }
  }
  return { show, hide, outcome, dispose: hide };
}
