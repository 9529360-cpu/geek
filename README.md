# 极客 Geek

Electron 多平台多账号聊天客户端，当前支持 WhatsApp、Telegram 和 LINE 六类账号形态，并提供独立账号沙箱、群发能力和统一翻译桥。

> 自动化代理接手前先阅读 [`AGENTS.md`](AGENTS.md) 和 [`docs/README.md`](docs/README.md)。跨会话维护基线见 [Issue #50](https://github.com/9529360-cpu/geek/issues/50)，Cloudflare 生产部署状态见 [Issue #21](https://github.com/9529360-cpu/geek/issues/21)，账号生产 smoke 见 [Issue #23](https://github.com/9529360-cpu/geek/issues/23)。
>
> 当前维护基线（2026-08-19）：客户端与 `package.json` 版本为 **1.2.11**，`.github/release-client-version` 为 **1.2.11**，Electron 锁定为 **43.4.0**。`npm test` 会动态发现并执行 `test/*.cjs` contract（仅排除两个 CDP 开发工具）；当前数量以 CI 输出为准，避免文档硬编码再次漂移。

## 当前来源优先级

当前行为以 `master` 上的源码、配置、测试和 GitHub Actions 工作流为准。README、运维手册和 Issue #50 用于解释这些实现；历史事故记录、逆向研究、旧发布交接和 UI 原型只提供当时背景，不是生产配置。详细分类见 [`docs/README.md`](docs/README.md)。

生产部署是否成功，应以对应 GitHub Actions run 及 Issue #21/#23 的非敏感状态记录为证据，不以本地临时环境能否解析域名为准。

## 技术架构

```text
src/main.cjs（主进程）
 ├── 每账号一个常驻 WebView，使用独立持久化 partition
 ├── session.fromPartition(...) 获取账号 Session
 ├── ses.extensions.loadExtension(...) 加载内置 LINE MV3 扩展
 ├── electron-updater 处理受控更新检查
 └── 诊断日志默认脱敏，不保留聊天正文或 URL query/hash
ui/（渲染层）
 ├── Linear 深色外壳
 ├── WebView 白底兜底
 └── 仅通过受控 IPC/WebView 桥调用主进程能力
resources/
 ├── extensions/line-3.5.1/  当前内置 LINE 扩展及兼容补丁
 ├── s3loYR.js               LINE 兼容 preload
 └── bridge-preload.cjs      WA/TG 隔离桥
data/
 ├── accounts.example.json   脱敏账号结构示例
 └── config.example.json     脱敏全局配置示例
```

真实运行数据固定写入 Electron `userData`。仓库不跟踪真实 `accounts.json`、`config.json`、登录凭据、聊天正文或会话数据；`data/` 仅保留脱敏示例和旧版首启迁移入口。

## WebView 与扩展安全边界

所有远程 WebView 都必须保持：

- `sandbox=true`
- `nodeIntegration=false`
- `nodeIntegrationInSubFrames=false`
- `webSecurity=true`
- 仅使用已登记的账号 partition 和允许的页面来源

隔离策略按平台区分：

| 平台 | `contextIsolation` | 当前状态 |
|---|---:|---|
| WhatsApp | `true` | 使用完整性校验后的 `bridge-preload.cjs` |
| Telegram Z / K | `true` | 使用同一受控隔离桥 |
| LINE 普通 / 商业版 | `false` | 有意保留的兼容例外，等待认证后完整回归或 preload 重构 |

不得把 LINE 的例外扩散成全局 `contextIsolation=false`，也不得以 `--no-sandbox`、开启 Node 集成或关闭 `webSecurity` 作为兼容方案。没有 LINE 登录后 token、HMAC、authenticated EventSource、消息收发和重启恢复证据前，不修改该例外。

LINE 扩展当前使用 Electron 43 的 `Extensions.loadExtension` API：

```js
const ses = session.fromPartition(partition, { cache: true });
await ses.extensions.loadExtension(LINE_EXTENSION_PATH);
```

旧文档中的 `Session.loadExtension` 属于 Electron 43 升级前写法，不应重新引入。

## LINE 兼容背景

LINE 页面由项目内置 3.5.1 MV3 扩展提供。其旧式 preload 依赖 `_pluginKD`、`_PluginT`、`_PluginVT`、`hS` 等页面全局，并依赖登录 token、HMAC 和认证实时事件流完成登录后消息路径。

扩展 service worker 在 Electron 中无法承担原浏览器环境的全部持久化职责，因此项目保留了受限的 token 恢复兼容链。主进程侧备份使用 Electron `safeStorage` 加密；日志只记录认证能力是否存在，不记录 token、Authorization header 或 URL query/hash。打包版还会根据受 ASAR integrity 保护的清单校验解包扩展、LINE preload 和 WA/TG bridge 文件。

2026-08-16 的真实账号恢复记录证明当时两路 WA、TG 和两路 LINE 会话可以恢复，并且 LINE 认证实时流进入可用状态。该记录是历史验证，不替代 Electron、扩展或认证逻辑变更后的重新回归。

## 跨平台翻译

- WA、TG、LINE 页面只通过受保护的 WebView 桥提交文本和语种，不持有翻译供应商密钥。
- 开发环境默认使用本机网关；正式打包版使用受控 HTTPS 翻译 Worker。
- 服务端负责认证、限流、额度检查和权威扣减；客户端检查仅用于交互与延迟优化。
- 翻译缓存按账号 partition 隔离，缓存键不保存原文明文，持久化译文使用 Electron `safeStorage`。
- 诊断、Worker 日志和生产状态记录不得包含聊天正文、译文、JWT、Cookie、token、API key 或真实运行数据。

## 运行与验证

```bash
npm install
npm start
```

完整 contract：

```bash
npm test
```

Windows 本地目录构建：

```bash
npm run pack
```

`npm run dist:test` 只生成本地测试安装包，不发布 R2、官网元数据或 tag。正常的新版本发布由 `master` 上 `.github/release-client-version` 的版本变更触发；失败后的同版本重试只能在已有独立发布授权和失败证据时，通过 `release-client` 的显式 `workflow_dispatch` 启动。普通源码或文档合并不得修改发布标记，也不得把手动 dispatch 当作日常验证入口。发布边界见 [`docs/release-security.md`](docs/release-security.md)。

涉及 Electron 大版本、LINE 扩展、WhatsApp WPP/CDP、账号认证、支付、额度、更新或 WebView 安全边界的改动，除自动 contract 外还需要对应平台或生产路径的聚焦验证。

## 目录导航

- `src/main.cjs`：主进程编排；避免继续膨胀，优先提取单一职责模块。
- `src/`：运行路径、安全存储、诊断、恢复、更新和平台辅助模块。
- `ui/`：桌面外壳、账号管理、订阅窗口和 WebView 调度。
- `scripts/`：Cloudflare Workers、发布构建、生产 smoke 和运维脚本。
- `resources/`：LINE 扩展、兼容 preload、WA/TG bridge 及完整性清单。
- `test/`：契约与集成测试；`cdp-eval.cjs`、`cdp-reload.cjs` 是手动开发工具。
- `docs/README.md`：当前运维文档与历史资料索引。
- `ISSUES.md`：按发生时间保留的历史事故与修复记录，不是当前状态清单。
