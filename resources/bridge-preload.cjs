'use strict';
// guest 页面桥（WA/TG webview preload）：运行在隔离世界。
// 页面脚本通过 window.postMessage({__geekBridge:true, payload}) 上报，
// preload 校验同窗口来源后经 sendToHost('geek-bridge') 转发宿主。
// documentElement 上的 data-geek-bridge 标记供页面检测桥是否可用（DOM 属性跨世界共享）。
const { ipcRenderer } = require('electron');

const HOST_CHANNEL = 'geek-bridge';
const MARKER = 'data-geek-bridge';

// preload 时机 documentElement 可能尚未就绪：先标记 document，元素就绪后再补标记
// （DOM 属性跨世界共享，页面脚本可检测）。
function markReady() {
  try {
    const root = document.documentElement || (document.head && document.head.parentElement) || document;
    root.setAttribute(MARKER, '1');
    return true;
  } catch {
    return false;
  }
}
markReady();
document.addEventListener('readystatechange', () => markReady());
document.addEventListener('DOMContentLoaded', () => markReady());
setTimeout(markReady, 50);

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || data.__geekBridge !== true) return;
  try {
    ipcRenderer.sendToHost(HOST_CHANNEL, data.payload);
  } catch { /* 转发失败不影响页面 */ }
});
