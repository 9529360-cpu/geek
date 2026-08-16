'use strict';
// guest 页面桥（WA/TG webview preload）：运行在隔离世界。
// 页面脚本通过 window.postMessage({__geekBridge:true, payload}) 上报，
// preload 校验同窗口来源后经 sendToHost('geek-bridge') 转发宿主。
// documentElement 上的 data-geek-bridge 标记供页面检测桥是否可用（DOM 属性跨世界共享）。
const { ipcRenderer } = require('electron');

const HOST_CHANNEL = 'geek-bridge';
const MARKER = 'data-geek-bridge';

try {
  document.documentElement.setAttribute(MARKER, '1');
} catch { /* 页面未就绪时忽略 */ }

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.__geekBridge !== true) return;
  try {
    ipcRenderer.sendToHost(HOST_CHANNEL, data.payload);
  } catch { /* 转发失败不影响页面 */ }
});
