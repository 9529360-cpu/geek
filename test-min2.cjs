// D:/项目/whatsapp-multi/test-min2.cjs — 加载项目 index.html 测试（无 preload/sandbox）
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 1280, height: 820, backgroundColor: '#111318' });
  w.loadFile(path.join(__dirname, 'ui/index.html'));
});
