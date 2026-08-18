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
- `CLOUDFLARE_ACCOUNT_ID` 也不要写完整值，只写“已找到/未找到”和末尾 4 位即可用于核对。

## 状态模板

Hermes 每次只覆盖下面这一段：

```text
更新时间：
任务：配置 Cloudflare -> GitHub Actions Secrets
Cloudflare 正确账户已确认：是/否
已看到 geek-subscription Worker：是/否
已看到 geek-subscriptions D1：是/否
Cloudflare API Token 已创建：是/否
Token 已写入 GitHub Secret CLOUDFLARE_API_TOKEN：是/否
Account ID 已找到：是/否
Account ID 末 4 位：____
Account ID 已写入 GitHub Secret CLOUDFLARE_ACCOUNT_ID：是/否
当前卡点：
需要用户手动做的动作：
补充说明：
```

完成后不要做下一步部署，只更新本文件并停止。