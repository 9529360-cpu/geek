# 复刻过程关键问题记录

## LINE 扫码登录 + 重启自动恢复（2026-08-13 最终解决）

### 最终方案（照原版 line.json 机制）
原版 Hello-GPT 把 LINE 的 accessToken（JWT）**明文保存**到 `AppData/Roaming/Hello-GPT/line.json`
（`partition名 → base64(JWT)`，JWT payload 含 aud=LINE/scp=LINE_CORE/lsid 等），重启后注入页面。
复刻版等价实现（patch 扩展 main.js，3 处）：
1. **setTokenV3IssueResult**：登录成功后把 tokenV3IssueResult **明文存 localStorage**（`__stardust_line_token`）
2. **getAccessToken**：内存 token 为空时**读 localStorage 明文**（绕过解密死循环：
   getEncryptedIdentityV3 需要 token 认证、token 解密又需要它——Electron 不支持扩展 SW 导致密钥无法持久化）
3. **createSession 前不能清明文**（会把重启恢复要读的明文清掉）——登录时内存新 token 自然覆盖旧值，无需清

### 扫码成功关键（早前）
- **白色背景**：深色面板会让手机扫码器识别不了二维码（webview 强制 `background-color: rgb(255,255,255)` 对齐原版）
- **不要放大二维码**（原始尺寸即可扫，放大后扫不上）
- 原版 s3loYR.js preload + 补全：`_pluginKD`（输入框按键包装，不补聊天崩空白）、
  `_PluginT`（接收消息处理，返回原样）、`_PluginVT`（消息渲染后 no-op）、`hS()`（初始化配置）
- webRequest 监听器**必须调 callback()**（不调阻塞全部请求→页面 blank）

### 登录环境
- MV3 原版扩展 + Electron 35.5.1（原生 chrome.storage.local 支持 Promise 式）
- chrome.storage 不要 mock（Electron 原生 LevelDB 持久化更可靠）

### 验收结果（2026-08-13 用户实测）
- ✅ 双 LINE 账号（line头测试 + line2）扫码登录
- ✅ 聊天 / 发消息
- ✅ **重启后两个账号全部自动恢复**（直接进聊天页面，不用再扫码）
- ✅ WhatsApp 重启恢复（基础架构验证）
- 当前复刻进程：CDP 9344（`proc_fdbaa6d920bf`）
