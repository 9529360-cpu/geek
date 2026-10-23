export function serialQueue() {
  let tail = Promise.resolve();
  return (operation) => {
    const next = tail.then(operation);
    tail = next.catch(() => {});
    return next;
  };
}

export function filterAccounts(accounts, platforms, query = '', archivedOnly = false) {
  const needle = query.trim().toLowerCase();
  const names = new Map(platforms.map((p) => [p.id, p.name]));
  return accounts.filter((a) => Boolean(a.archived) === archivedOnly
    && `${a.name} ${names.get(a.platformId) || a.platformId}`.toLowerCase().includes(needle));
}

export function errorMessage(code) {
  const messages = {
    BATCH_INVALID: '添加数量必须是 1–10 的整数。',
    ACCOUNTS_CREATED_OPEN_FAILED: '账号已保存，但页面未能打开。请从账号列表重新打开，不要重复添加。',
    LAYOUT_INVALID: '\u9875\u9762\u5e03\u5c40\u65e0\u6548\uff0c\u8bf7\u91cd\u8bd5\u3002',
    PROXY_INVALID: '代理配置无效：请填写主机和 1–65535 端口，不支持带认证的地址。',
    NAME_INVALID: '备注需为 1–64 个字符，不能包含控制字符。',
    APPEARANCE_INVALID: '字体大小需为 10–28 的整数，颜色需为有效的六位十六进制色值。',
    ACCOUNT_ORDER_INVALID: '只能调整同一平台分组内未归档账号的顺序。',
    ACCOUNT_LIMIT: '开发版最多保存 20 个账号（包括已归档账号）。',
    ACCOUNT_UNKNOWN: '账号不存在，请重新同步状态。',
    ACCOUNT_NOT_OPEN: '该账号页面尚未打开。',
    ACCOUNT_ARCHIVED: '请先恢复这个已归档账号，再打开页面。',
    ACCOUNT_STILL_OPEN: '页面尚未关闭，未执行归档或网络配置修改。请重试。',
    PLATFORM_UNAVAILABLE: '这个平台尚未完成 Tauri 适配。',
    WEBSITE_URL_INVALID: '请输入 HTTPS 域名地址；不支持本地地址、IP、账号密码、非标准端口或带 ? / # 的临时链接。',
    WEBSITE_URL_UNEXPECTED: '只有自定义网站账号可以设置网站地址。',
    STORE_IO: '账号数据读写失败；未提交的修改不会生效。',
    DPAPI_FAILED: 'Windows 安全存储不可用；不会回退到明文保存。',
    WEBVIEW_FAILED: '页面操作失败，请重试并检查 WebView2 Runtime。',
    TRAY_UNAVAILABLE: '系统托盘不可用，关闭窗口仍将退出应用。',
    STATE_UNAVAILABLE: '本地状态不可用，请重启开发版；不会重置数据。',
    FORBIDDEN: '操作被安全边界拒绝。',
  };
  return Object.hasOwn(messages, code) ? messages[code] : '操作未完成，请检查开发版运行状态。';
}
