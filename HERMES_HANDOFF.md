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
更新时间：2026-08-17 21:5x Europe/Rome
任务：配置 Cloudflare -> GitHub Actions Secrets —— 已完成（最终交接）
Cloudflare 正确账户已确认：是
已看到 geek-subscription Worker：是
已看到 geek-subscriptions D1：是
Cloudflare API Token 已创建：是（用户已手动创建）
Token 已写入 GitHub Secret CLOUDFLARE_API_TOKEN：是（用户已配置）
Account ID 已找到：是
Account ID 末 4 位：8139
Account ID 已写入 GitHub Secret CLOUDFLARE_ACCOUNT_ID：是（用户已配置）
当前卡点：无（全部完成）
需要用户手动做的动作：无
补充说明（非敏感信息）：
- Cloudflare 账户：9529360@gmail.com's Account（登录邮箱 9529360@gmail.com）
- geek-subscription Worker Dashboard 路径：https://dash.cloudflare.com/ 内 Workers & Pages -> geek-subscription
- geek-subscription 生产域名：https://geek-subscription.9529360.workers.dev
- 当前可见 Worker 部署：2026-08-17T10:57:11Z（Author 9529360@gmail.com，Version 7857522b-69b4-4537-ba18-04a59327c930）
- geek-subscriptions D1：名称 geek-subscriptions，Database ID 1e78a93a-36de-43db-88aa-4551f9991200（created 2026-08-16T16:07:24Z）
- bbnba.com Zone Dashboard 路径：https://dash.cloudflare.com/ 内域名列表 -> bbnba.com
- Cloudflare API Token 管理页面路径：https://dash.cloudflare.com/profile/api-tokens
- GitHub Repository Actions Secrets 页面路径：https://github.com/9529360-cpu/geek/settings/secrets/actions
- CLOUDFLARE_API_TOKEN：已配置
- CLOUDFLARE_ACCOUNT_ID：已配置
- wrangler whoami：正常（OAuth 登录，email 9529360@gmail.com，Account ID 对应账户）
- wrangler deployments list --name geek-subscription：正常（能列出部署记录）
- wrangler d1 list：正常（能看到 geek-subscriptions）
- Cloudflare CLI 登录状态：仍处于登录状态（OAuth Token 有效）
- 下一位维护代理应从哪里开始：从"重新触发 subscription Worker 部署"开始（例如 wrangler deploy --config wrangler-subscription.toml），确认 GitHub Actions 使用新配置的 CLOUDFLARE_API_TOKEN 部署 geek-subscription 是否正常。
```

完成后不要做下一步部署，只更新本文件并停止。
