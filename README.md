# WhatsApp Multi Phase1 — Hello-GPT 复刻版

Electron 多平台多账号客户端（复刻 Hello-GPT v1.4.39 的架构与行为）。

> 状态：**LINE 全链路已攻破**（扫码登录 / 聊天 / 发消息 / 重启自动恢复）——2026-08-13 用户双账号实测通过。
> 平台只做 WhatsApp / Telegram / LINE 三平台共 6 类型（对齐原版：WA=普通+纯净版、TG=Z版+K版、LINE=普通+商业版），不做翻译。

## 技术架构

```
main.cjs (主进程)
 ├── 9 个 webview 常驻（每账号一个独立 partition: persist:webview-page-<id>）
 ├── session.loadExtension(扩展目录)  → MV3 Chrome 扩展
 ├── webRequest 日志/拦截（[line-api] 全量）
 └── electron-updater（自动更新框架）
ui/ (渲染层：Linear 深色外壳，webview 白底)
resources/
 ├── extensions/line-3.5.1/  → 原版 LINE 扩展（+2 patch：明文 token 存/读）
 └── s3loYR.js              → 原版 preload（+4 全局补全：_pluginKD/_PluginT/_PluginVT/hS）
data/
 ├── accounts.json          → 账号列表（partition / 平台 / 登录态）
 └── config.json            → 全局配置
```

## 核心机制（破解要点）

### 1. 扩展加载
- 每账号独立 partition（多开隔离），`session.fromPartition(partition).loadExtension(EXT_PATH)`
- MV3 service worker 在 Electron 注册失败（Status 15）是**官方预期**，不影响页面功能
- webview 加载扩展页面本身 `chrome-extension://<id>/index.html?lw-key=...`（LINE 聊天应用打包在扩展里）

### 2. webview 对齐（照抄原版 DOM）
```
webpreferences="contextIsolation=no,sandbox=false,nativeWindowOpen=yes,spellcheck=no"
style="background-color: rgb(255,255,255)"   ← 白底兜底（深色外壳会让手机扫不了二维码）
useragent="Mozilla/5.0 ... Chrome/124"        ← 标签属性（webPreferences.userAgent 对 webview 无效）
```

### 3. 缺失全局补全（不补则崩）
| 全局 | 缺失表现 | 补全 |
|---|---|---|
| `_pluginKD` | 点好友进聊天 → 崩溃空白 | 输入框按键包装透传 |
| `_PluginT` | 发消息 → 崩溃空白 | 消息原样返回 |
| `_PluginVT` | 消息渲染 → 崩 | no-op |
| `hS()` | 初始化崩 → 恢复流程不跑 | setDevConfigs 配置对象 |

### 4. 重启自动恢复（本项目的核心突破）
- **原版机制**：Hello-GPT 把 LINE accessToken（JWT, HS256）**明文保存**到
  `AppData/Roaming/Hello-GPT/line.json`（`partition名 → JWT`），重启注入页面 → getProfile 200 → 恢复
- **为什么需要它**：LINE 扩展的本地凭据（lcs_secure_*）加密密钥 wrappedNonce 依赖 SW 持久化，
  Electron 不支持扩展 SW → 密钥不持久 → 重启必退。这是死循环：getEncryptedIdentityV3 需要有效 token、
  token 解密又需要它
- **复刻方案（patch 扩展 main.js 仅 2 处）**：
  1. `setTokenV3IssueResult`：登录成功 → token JSON **明文存 localStorage**（`__stardust_line_token`）
  2. `getAccessToken`：内存 token 为空 → **读明文 fallback**（绕过解密死循环）
- **铁律**：只存+读、**不清除**（createSession 前清明文会破坏恢复；登录成功后内存 token 优先，fallback 不触发）
- 登录成功表现：localStorage 出现 `__stardust_line_token`；重启后页面 `#/friends` 而非 `#/`

### 5. 环境选型
- **Electron 35.5.1**（对齐原版）：chrome.storage.local 原生支持 Promise 式（35.7.5 不支持）
- 不要 mock chrome.storage（破坏原生 LevelDB 持久化）
- 主进程对齐原版参数：`--no-sandbox --no-zygote --js-flags=--max-old-space-size=4096 --service-worker-schemes=http,https`

## 运行

```bash
npm install           # electron@35.5.1
npx electron . --remote-debugging-port=9344
```

调试：CDP `http://127.0.0.1:9344`；杀进程 `MSYS2_ARG_CONV_EXCL='*' taskkill /F /IM electron.exe`

## 目录

- `src/main.cjs` — 主进程（窗口/webview/扩展加载/日志）
- `ui/` — 外壳 UI（深色 Linear 风；webview 白底）
- `resources/extensions/` — 原版扩展（md5 对齐原版，仅 LINE main.js +2 patch）
- `resources/s3loYR.js` — 原版 preload + 全局补全
- `data/` — accounts.json / config.json（用户数据在 `AppData/Roaming/whatsapp-multi/`）
- `ISSUES.md` — 完整逆向过程与坑记录

## 逆向参考

- 原版：`D:/GPT/Hello-GPT`（只读观察，不修改）；逆向文档 `D:/GPT/Hello-GPT-analysis/`
- 技能：`electron-chrome-extension-integration`（完整方案 + 坑列表）
