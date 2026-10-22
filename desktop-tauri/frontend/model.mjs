export function serialQueue() {
  let tail = Promise.resolve();
  return (operation) => {
    const next = tail.then(operation);
    tail = next.catch(() => {});
    return next;
  };
}

export function errorMessage(code) {
  const messages = {
    NAME_INVALID: '备注需为 1–64 个字符，不能包含控制字符。',
    ACCOUNT_LIMIT: '开发版最多保存 20 个账号。',
    ACCOUNT_UNKNOWN: '账号不存在，请重新选择。',
    ACCOUNT_NOT_OPEN: '该账号页面尚未打开。',
    PLATFORM_UNAVAILABLE: '这个平台尚未完成 Tauri 适配。',
    STORE_IO: '账号数据保存失败；未提交的修改不会生效。',
    DPAPI_FAILED: 'Windows 安全存储不可用；不会回退到明文保存。',
    WEBVIEW_FAILED: '页面操作失败，请重试并检查 WebView2 Runtime。',
    FORBIDDEN: '操作被安全边界拒绝。',
  };
  return Object.hasOwn(messages, code) ? messages[code] : '操作未完成，请检查开发版运行状态。';
}
