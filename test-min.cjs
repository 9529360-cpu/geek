// D:/项目/whatsapp-multi/test-min.cjs — 最小 Electron 显示测试
const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 800, height: 600, backgroundColor: '#ffffff' });
  w.loadURL('data:text/html,<html><body style="background:#fff"><h1>TEST - 如果能看到这行字说明渲染正常</h1></body></html>');
});
