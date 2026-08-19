# Windows 真实客户端 self-hosted runner

用于 Issue #95 及后续经单独 Issue 授权的 WA/TG/LINE 真机回归。该 runner 面向真实 Windows 开发机，不是通用 PR 构建机。

## 注册

1. 打开仓库 `Settings → Actions → Runners → New self-hosted runner`。
2. 选择 Windows / x64。
3. 在 Windows 原生 PowerShell 中按 GitHub 页面当前生成的命令下载并解压 runner。注册 token 是短期凭据，只在本机命令行使用，不得复制到 Issue、PR、日志或仓库文件。
4. 配置时添加自定义标签：`geek-real-client`。
5. 首轮真实 GUI 回归不要安装为 Windows Service；在当前登录的 Windows 用户桌面会话中直接运行 runner 的 `run.cmd`，确保 job 与真实 Geek 客户端使用同一个 `%APPDATA%` / `%LOCALAPPDATA%` 用户环境。
6. GitHub Runners 页面确认状态为 `Idle`，并确认标签至少包含 `self-hosted`, `Windows`, `X64`, `geek-real-client`。

WSL 可以用于辅助开发，但本 runner 必须注册在 Windows 原生环境。Issue #95 验证的是 Windows 安装客户端、NSIS/electron-updater 和 Windows 用户 profile，不能用 WSL runner 替代。

## Issue #95 执行顺序

工作流：`windows-real-client-regression`。

### 1. probe

手动 dispatch，选择 `probe`。

只确认：

- 能检测到已安装 Geek；
- 当前版本；
- Geek 进程是否运行；
- `%APPDATA%/geek` 结构状态；
- partition 数量。

若当前机器已经是 1.2.9，`probe` 仍可运行，但不得为了制造 1.2.8 基线自动降级真实 profile。

### 2. pre-update

仅当同一 Windows 用户 profile 当前真实安装版本为 1.2.8 时运行。

`pre-update` 会 fail closed：检测不到 1.2.8 就终止，不降级、不覆盖安装、不改用户数据。成功时会把脱敏基线保存到本机：

```text
%LOCALAPPDATA%\GeekRegression\issue-95\pre-update.json
```

同时上传 7 天保留的脱敏 artifact。

### 3. 正常客户端更新

使用真实已安装 Geek 的正常 updater 路径：

1. 启动 1.2.8；
2. 等待正常更新检查与下载；
3. 使用客户端自己的“重启安装”流程；
4. 更新后确认 Geek 正常打开。

不得为此修改 `.github/release-client-version`，不得 dispatch `release-client`，不得重新发布 1.2.9。

### 4. post-update

确认安装后的 Geek 已运行，再手动 dispatch `post-update`。

该阶段要求检测到 1.2.9，并读取同一 Windows profile 上保存的 `pre-update` 脱敏基线进行结构比较。artifact 会包含：

- before/after 版本；
- 是否确认为 1.2.8 → 1.2.9；
- 更新后进程是否运行；
- accounts/config 文件存在性是否保持；
- partition 数量是否保持；
- LINE token store 仅“是否存在”的状态是否保持。

最终仍需要人工在 UI 中确认已有账号保持登录/可用；结构证据不能替代平台实际登录态确认。

## 隐私边界

采集器不得输出或上传：

- `accounts.json` / `config.json` 内容；
- Cookie 数据库内容；
- JWT、密码、API key；
- LINE token 或 Authorization header；
- 聊天正文或译文；
- 本机用户名、电脑名或原始文件路径。

artifact 只保留结构性布尔值、数量、文件大小/修改时间、客户端版本和时间戳。

## WA/TG 后续

同一 `geek-real-client` runner 可以复用到 WA/TG 真机回归，但必须各自建立/引用对应 Issue，并使用独立 workflow/证据边界。Issue #95 不负责发送真实消息或文件。
