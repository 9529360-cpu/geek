# Windows 真实客户端人工回归

用于需要真实 Windows 安装、真实 Electron userData、持久登录态或跨版本 profile 的验证。它是独立的人工产品证据，不是 CI，也不再通过 GitHub Actions self-hosted runner 执行。

## 与在线 CI 的边界

仓库中的自动化 CI、构建、Cloudflare 部署和正式客户端发布统一使用 GitHub-hosted runner：Linux 使用 `ubuntu-latest`，Windows 使用 `windows-latest`。仓库不得要求维护者启动、注册或养护 `geek-linux` / `geek-real-client` 等 self-hosted runner。

GitHub-hosted runner 是临时环境，适合 contract、Windows ACL、打包、Electron 隔离烟测、部署和发布流水线；但它不会拥有某台真实用户机器上已经安装的 Geek、长期 `%APPDATA%/geek`、WA/TG/LINE 登录态或跨版本 userData。因此这些产品证据必须与 CI 结果明确区分。

真实客户端采集器仍保留在：

```text
scripts/windows-real-client-evidence.ps1
```

它只输出脱敏结构证据，不上传任何账号内容、Cookie、Token、聊天正文或原始路径。

## 运行要求

在需要验证的真实 Windows 机器和目标 Windows 用户会话中，从仓库对应 revision 手工运行 PowerShell。不要注册 GitHub Actions runner，也不要把真实 profile 复制到 CI。

探测当前安装状态：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-real-client-evidence.ps1 -Phase probe -OutputDir .\real-client-evidence
```

如果某个历史升级验收明确要求 `pre-update` / `post-update`，必须在同一台 Windows 机器、同一个 Windows 用户 profile 上按对应版本要求执行。采集器会 fail closed；不会为了制造基线自动降级客户端。

历史 Issue #95 的旧 1.2.8 → 1.2.9 证据规则仍由脚本保留：

- `pre-update` 只有检测到 1.2.8 才接受；
- `post-update` 只有检测到 1.2.9 且同一用户存在本地 pre-update 基线才接受；
- 结构证据不能替代 UI 中真实账号是否仍登录、可收发的人工确认。

这组旧版本规则只用于历史证据兼容；新版本升级回归应建立新的、版本明确的验收契约，而不是修改旧证据去迎合当前版本。

## 输出与隐私边界

采集结果只能包含结构性信息，例如：

- 客户端是否安装及版本；
- Geek 进程是否运行；
- accounts/config 文件是否存在、文件大小/时间元数据；
- partition 数量；
- LINE token store 仅“是否存在”；
- pre/post 结构比较结果。

不得读取、打印、提交、上传或复制到 Issue/PR：

- `accounts.json` / `config.json` 内容；
- Cookie 数据库内容；
- JWT、密码、API key；
- LINE token 或 Authorization header；
- 聊天正文或译文；
- Windows 用户名、电脑名或原始 profile 路径。

## 证据判定

任何结论都要说明证据层级：

- GitHub-hosted CI 绿色：只证明相应 contract/集成/E2E 自动验证通过；
- validation installer 构建成功：只证明测试安装包可生成；
- 本脚本结构证据：只证明该真实 Windows profile 的脱敏结构状态；
- WA/TG/LINE 真实登录、消息、附件、升级后会话恢复：仍需要对应真实客户端人工验证；
- `release-client` 生产 workflow 成功：才代表对应正式客户端发布链完成。

不要用任意一层绿色结果替代另一层证据。
