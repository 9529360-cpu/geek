# WhatsApp Multi Phase1 — Hello-GPT 复刻版

Electron 多平台多账号客户端（复刻 Hello-GPT v1.4.39 的架构与行为）。

> AI/自动化代理接手前请先阅读 [`AGENTS.md`](AGENTS.md)。账户、忘记密码、Resend 与 Cloudflare 的生产交接见 [`docs/account-password-reset-operations.md`](docs/account-password-reset-operations.md)。

> 当前范围：WhatsApp / Telegram / LINE 三平台共 6 类型（WA=普通+纯净版、TG=Z版+K版、LINE=普通+商业版），支持多账号沙箱、群发和统一翻译桥。
> 2026-08-16 非破坏性回归：极客主页面和 5 个账号 WebView 正常恢复；两路 WA 与 TG 已登录，TG 翻译适配器已注入；两路 LINE token、聊天页和认证实时事件流均恢复，“网络不稳定”已消失。
> TG 翻译策略：缓存命中优先；未命中才进入主进程 20 并发队列；旧历史消息默认不自动翻译；历史 DOM 延迟重试仍保留 `isHistory`。

## 技术架构

```
main.cjs (主进程)
 ├── 每账号一个常驻 webview（独立 partition: persist:webview-page-<id>）
 ├── session.loadExtension(扩展目录)  → MV3 Chrome 扩展
 ├── webRequest 日志/拦截（[line-api] 全量）
 └── electron-updater（自动更新框架）
ui/ (渲染层：Linear 深色外壳，webview 白底)
resources/
 ├── extensions/line-3.5.1/  → 原版 LINE 扩展（+2 patch：明文 token 存/读）
 └── s3loYR.js              → 原版 preload（+4 全局补全：_pluginKD/_PluginT/_PluginVT/hS）
data/                        → 仅作为本机旧版首启迁移来源（真实文件被 Git 忽略）
├── accounts.example.json   → 脱敏账号结构示例
└── config.example.json     → 脱敏全局配置示例
```

## 核心机制（破解要点）

### 1. 扩展加载
- 每账号独立 partition（多开隔离），`session.fromPartition(partition).loadExtension(EXT_PATH)`
- MV3 service worker 在 Electron 注册失败（Status 15）是历史兼容现象；LINE 页面功能依赖扩展页面与现有补丁，Electron 大版本升级必须重新回归
- webview 加载扩展页面本身 `chrome-extension://<id>/index.html?lw-key=...`（LINE 聊天应用打包在扩展里）

### 2. webview 对齐（照抄原版 DOM）
```
webpreferences="contextIsolation=no,sandbox=true,nativeWindowOpen=yes,spellcheck=no"
style="background-color: rgb(255,255,255)"   ← 白底兜底（深色外壳会让手机扫不了二维码）
useragent="Mozilla/5.0 ... Chrome/124"        ← 标签属性（webPreferences.userAgent 对 webview 无效）
```

安全边界以当前 Geek 主进程配置为准：远程 WebView 保持 `sandbox=true`、`nodeIntegration=false`、`webSecurity=true`，不得为兼容某个平台改成全局 `--no-sandbox`。

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
  1. `setTokenV3IssueResult`：登录成功 → token JSON 存入扩展 localStorage（`__stardust_line_token`）
  2. `getAccessToken`：内存 token 为空 → 读 fallback（绕过解密死循环）
- **Geek 当前安全补强**：主进程备份的 LINE token 使用 Electron `safeStorage` 加密后落盘；日志只记录认证头是否存在，不输出值
- **铁律**：恢复链路不能在 createSession 前清空 fallback；登录成功后内存 token 优先
- 登录成功表现：localStorage 出现 `__stardust_line_token`；重启后页面 `#/friends` / `#/chats` 而非登录首页

### 5. 运行时与安全基线
- **Electron 43.4.0**：从 35.7.5 升级后的当前目标运行时；依赖锁文件固定实际安装版本，升级必须通过 Linux/Windows contract 与 Windows 完整打包
- Electron 42+ 不再依赖 npm postinstall 自动下载运行时；`pack` / `dist:test` / 正式 `dist` 会显式运行官方 `install-electron` 下载步骤
- 远程页面保持 Chromium sandbox、`nodeIntegration=false`、`webSecurity=true`
- 仅保留已验证且不降低网页安全边界的进程参数；禁止把 `--no-sandbox` 作为兼容性方案
- LINE 扩展和 WhatsApp WPP/CDP 对 Electron/Chromium 版本敏感，因此跨大版本升级必须独立分支、自动测试和发布候选构建通过后再进入主线

### 6. 跨平台翻译
- WA / TG / LINE 只通过受保护的 WebView 桥向主进程提交文本和语种；客户端页面不持有翻译服务地址或供应商密钥。
- 开发环境默认使用 `http://127.0.0.1:18991`，正式打包版使用受控 HTTPS 翻译网关。
- 翻译缓存按账号 partition 隔离，缓存键不保存原文明文，译文使用 Electron `safeStorage` 加密持久化。
- Telegram Z/K 与 LINE 普通/商业版使用同一平台适配器；回归测试锁定平台映射和注入分支。
- 服务端负责认证、额度与限流；客户端上报不能作为计费安全边界。

### 7. LINE 重启后的实时流认证
- LINE 普通 API 使用 `X-Line-Access` 与 `X-Hmac`，重启后可由持久化 token 恢复；实时收消息走原生 `EventSource`，标准实现不能携带这两个认证头，表现为普通 API 200、`/api/operation/receive` 401、页面显示“网络不稳定”。
- 当前扩展增加 `GeekAuthenticatedEventSource`：仍调用 LINE 自带 token manager 和 HMAC sandbox，只替换实时流传输层为带认证头的 Fetch SSE，不修改消息业务协议。
- 历史真实验证：两路 LINE 页面恢复到 `#/chats`，token 有效；认证事件流进入 `OPEN`，页面不再显示“网络不稳定”。Electron 大版本升级后仍需重新验证真实 LINE 会话。

## 运行

```bash
npm install
npm start
```

首次启动 Electron 43 时运行时二进制可能按 Electron 官方机制下载；Windows 打包使用 `npm run pack`，正式候选构建使用 `npm run dist`，两者都会显式准备 Electron 运行时。

需要 CDP 调试时可使用远程调试端口，但只对本机测试实例开放。结束调试进程时先核对端口对应 PID，不按进程名误杀其他 Electron 应用。

## 验证

```bash
npm test
npm run pack
```

正式发布前至少要求完整 contract suite 和 Windows release candidate 构建通过；涉及 Electron 大版本、LINE 扩展、WhatsApp WPP/CDP 的改动还应保留独立兼容性记录。

## 目录

- `src/main.cjs` — 主进程（窗口/webview/扩展加载/日志）
- `ui/` — 外壳 UI（深色 Linear 风；webview 白底）
- `resources/extensions/` — 原版扩展（仅保留当前 LINE 兼容所需补丁）
- `resources/s3loYR.js` — 原版 preload + 全局补全
- `data/` — 本机旧版首启迁移来源；真实 `accounts.json`/`config.json` 被 Git 忽略，仓库只保留脱敏示例；运行期固定写入 Electron `userData`
- `ISSUES.md` — 完整逆向过程与坑记录
