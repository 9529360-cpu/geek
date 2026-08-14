// line-preload.cjs — LINE 扩展 preload（原版 s3loYR.js + Hello-GPT 缺失全局补全）
// 原版 s3loYR.js：chrome API mock + 原版注入逻辑（照抄原版）
// _pluginKD：Hello-GPT 注入的按键事件包装（main.js 聊天输入框 onKeyDown 引用），
// 原版由 Hello-GPT 运行时注入，这里透传 handler 保持聊天输入正常。
try {
  // preload 沙箱里 require('node:path') 不可用，直接用 __dirname 拼接绝对路径
  require(__dirname + '/s3loYR.js');
} catch (e) {
  console.log('[line-preload] s3loYR 加载失败:', e && e.message);
}
try {
  if (typeof window !== 'undefined' && typeof window._pluginKD === 'undefined') {
    window._pluginKD = function (handler) { return handler; };
  }
} catch (e) { /* ignore */ }
