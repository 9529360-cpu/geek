# Hermes -> ChatGPT 交接通道

这个分支只用于 Hermes 把非敏感状态交给 ChatGPT 读取。

## Hermes 只能做这些事

- 只允许修改本文件 `HERMES_HANDOFF.md`。
- 可以在本文件中记录：当前页面、已经完成的步骤、卡住的步骤、看到的错误提示、是否已创建某个 Secret、是否已找到 Account ID、是否需要用户手动点击。
- 每次更新后提交到分支 `agent/hermes-handoff`。

## 严格禁止

- 不得修改 `master`。
- 不得修改任何其他分支。
- 不得修改任何代码、Workflow、PR、Issue、Cloudflare Worker、D1、DNS 或部署配置。
- 不得运行、重跑或取消 GitHub Actions。
- 不得部署任何 Worker。
- 不得在本文件、commit message、截图、PR、Issue 或任何 GitHub 内容中写入密码、验证码、Cloudflare API Token、GitHub Token、JWT_SECRET、ADMIN_PASSWORD、Resend Key 或其他 Secret。
- `CLOUDFLARE_API_TOKEN` 只能直接填入 GitHub Repository Actions Secret，绝不能写入本分支。
- `CLOUDFLARE_ACCOUNT_ID` 也不要写完整值，只写"已找到/未找到"和末尾 4 位即可用于核对。

## 状态模板

Hermes 每次只覆盖下面这一段：

```text
更新时间：2026-08-17 21:4x Europe/Rome
任务：配置 Cloudflare -> GitHub Actions Secrets
Cloudflare 正确账户已确认：是
已看到 geek-subscription Worker：是
已看到 geek-subscriptions D1：是
Cloudflare API Token 已创建：否
Token 已写入 GitHub Secret CLOUDFLARE_API_TOKEN：否
Account ID 已找到：是
Account ID 末 4 位：8139
Account ID 已写入 GitHub Secret CLOUDFLARE_ACCOUNT_ID：否
当前卡点：Cloudflare Dashboard 创建 API Token 的页面自动化失败。已登录（9529360@gmail.com），已进入 Create Token -> Edit Cloudflare Workers 模板页（权限已正确加载：Workers KV/Scripts/Routes/Account Settings 等 Edit/Read），但 "Token name" 输入框无法通过脚本操作（React 受控组件，DOM 中不渲染为可编辑 input，点击/键盘/Tab 均无效）。账号/区域下拉框同样无法脚本操作。已按规则停止，未继续乱点，未创建任何 Token。
需要用户手动做的动作：1) 浏览器已打开 https://dash.cloudflare.com/profile/api-tokens 且已登录。2) 请手动点击 Create Token -> 选 "Edit Cloudflare Workers" 模板 -> Token 名称填 github-geek-worker-deploy -> Account Resources 只选 9529360@gmail.com's Account（ID 末4位 8139）-> Zone Resources 只选 bbnba.com -> Create Token。3) 创建后把 Token 值告诉 Hermes 或直接由 Hermes 填入 GitHub Secret（Hermes 不会把它写进本分支/任何 GitHub 内容）。
补充说明：GitHub 仓库 9529360-cpu/geek 的 Repository Actions Secrets 当前为空（gh secret list 无输出），不存在 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID，可安全新建，无需担心覆盖。Cloudflare 账户确认依据：wrangler whoami 显示 9529360@gmail.com's Account ID 4f92d1ce757f9612a6c6955afaa28139；wrangler deployments list --name geek-subscription 成功；wrangler d1 list 显示 geek-subscriptions（uuid 1e78a93a-36de-43db-88aa-4551f9991200）。
```

完成后不要做下一步部署，只更新本文件并停止。
