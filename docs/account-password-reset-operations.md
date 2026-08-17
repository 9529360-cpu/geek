# 账户与忘记密码系统交接/运维手册

更新时间：2026-08-17

这份文档记录极客官网账户系统、忘记密码邮件、Resend、Cloudflare Worker 和 D1 的当前生产实现，供后续维护代理直接接手。

## 1. 已完成内容

- 官网登录页提供“忘记密码”。
- `/forgot-password` 提交邮箱，调用 `POST /api/password-reset/request`。
- `/reset-password?token=...` 设置新密码，调用 `POST /api/password-reset/complete`。
- 邮件由 Resend 自动发送，生产发件人为 `极客 Geek <no-reply@send.bbnba.com>`。
- 重置令牌为 32 字节安全随机值；D1 只保存 SHA-256 哈希，不保存原始令牌。
- 链接 30 分钟过期、只能使用一次。
- 请求响应统一，防止通过接口枚举已注册邮箱。
- 请求按 IP 限制为每小时 3 次，完成接口按 IP 限制为每小时 10 次。
- 改密后递增 `users.token_version`，此前签发的登录 JWT 自动失效。
- 邮件发送失败时，请求回退到 `requested`，不会伪装成已发送；发送成功状态为 `issued`。

对应提交：

- `2dc1a24 feat(account): add secure email password reset`
- `204326f chore(account): log password email delivery failures`

## 2. 生产资源

| 项目 | 值 |
|---|---|
| 官网 | `https://geek.bbnba.com` |
| 账户 API/后台 | `https://admin.bbnba.com` |
| 订阅 Worker | `geek-subscription` |
| 官网 Worker | `geek-website` |
| D1 数据库 | `geek-subscriptions` |
| Resend 域名 | `send.bbnba.com` |
| 正式发件人 | `极客 Geek <no-reply@send.bbnba.com>` |

Resend 自动配置产生的 DNS 记录采用子域名嵌套，这是正常的：

- DKIM TXT：`resend._domainkey.send.bbnba.com`
- SPF TXT：`send.send.bbnba.com`
- MX：`send.send.bbnba.com`

不要误把 SPF/MX 查询成 `send.bbnba.com`。权威 DNS 已确认以上记录存在。

## 3. Secret 管理

订阅 Worker 必须存在以下 secret：

```text
ADMIN_PASSWORD
JWT_SECRET
RESEND_API_KEY
RESET_FROM_EMAIL
```

只检查名称，不读取值：

```powershell
npx wrangler secret list --config wrangler-subscription.toml
```

轮换 Resend Key：

```powershell
npx wrangler secret put RESEND_API_KEY --config wrangler-subscription.toml
```

设置正式发件人：

```powershell
npx wrangler secret put RESET_FROM_EMAIL --config wrangler-subscription.toml
```

交互输入：`极客 Geek <no-reply@send.bbnba.com>`。不得把实际 Key 写入 shell 历史、仓库文件或聊天记录。旧 Key 曾经在聊天中暴露，后续应在 Resend 控制台创建新 Key、更新 Worker secret，然后撤销旧 Key。

## 4. 数据库与迁移

迁移文件：`scripts/migrations/002-password-resets.sql`。

它已经在生产 D1 执行，增加：

- `users.token_version`
- `password_reset_requests` 表及索引

不要重复执行该迁移，因为 SQLite/D1 的 `ALTER TABLE ... ADD COLUMN` 不是幂等操作。新环境初始化使用 `scripts/geek-subscription-schema.sql`；已有旧环境才按迁移顺序执行未执行的迁移。

只读检查最近请求：

```powershell
npx wrangler d1 execute geek-subscriptions --remote --command "SELECT id, email, status, created_at, expires_at FROM password_reset_requests ORDER BY id DESC LIMIT 10" --config wrangler-subscription.toml
```

状态含义：

- `requested`：已记录但邮件未成功发送，可由后台/后续流程处理。
- `issued`：Resend 已接受邮件，令牌有效。
- `processing`：重置提交正在处理。
- `used`：密码已成功修改，令牌作废。
- `expired`：旧请求或过期请求已作废。

## 5. 修改后的验证流程

本地必须运行：

```powershell
npm test
node --check scripts/geek-subscription-worker.js
node --check scripts/geek-website-worker.js
git diff --check
```

当前基线为 37 项测试全部通过。账户改动至少要保持
`test/account-security-contract.cjs` 通过。

部署：

```powershell
npx wrangler deploy --config wrangler-subscription.toml
npx wrangler deploy --config wrangler-website.toml
```

线上只读检查：

```powershell
curl.exe -sS https://admin.bbnba.com/health
curl.exe -sS https://geek.bbnba.com/forgot-password
curl.exe -sS "https://geek.bbnba.com/reset-password?token=invalid"
```

健康接口应返回 `{"ok":true,"service":"geek-subscription"}`，两个官网页面应包含对应表单。不要在生产环境批量创建重置请求。

## 6. 真实邮件测试

使用一个确实注册的测试邮箱，在官网点一次“忘记密码”。随后只读查询最新记录：

```sql
SELECT id, status, created_at, expires_at
FROM password_reset_requests
ORDER BY id DESC
LIMIT 3;
```

看到 `issued` 代表 Resend 已接受发送；再检查收件箱和垃圾邮件。若为 `requested`：

1. 查看 Worker 日志中的 `password reset email rejected`，日志只记录 HTTP 状态、错误类型和截断消息，不记录 Key 或重置链接。
2. 检查 `RESEND_API_KEY` 和 `RESET_FROM_EMAIL` secret 名称是否存在。
3. 检查 Resend 域名状态和上述三条 DNS 记录。
4. 检查发件地址是否属于已经验证的 `send.bbnba.com`。

连续测试可能返回 `{"error":"rate_limited"}`。这是安全功能，不是发信故障。不要为了方便删除或放宽生产限流；只有明确的受控诊断才能清理精准的测试 bucket，禁止清空整个 `rate_limits` 表。

## 7. 代码导航

- `sendResetEmail`：调用 Resend API。
- `issuePasswordReset`：生成令牌、保存哈希、建立 30 分钟链接并发信。
- `handlePasswordResetRequest`：统一响应、防枚举、过期旧请求。
- `handlePasswordResetComplete`：领取令牌、改密、递增会话版本并标记使用。
- `requireUser`：校验 JWT 中的版本与数据库 `token_version`。
- 官网页面常量：`FORGOT_PASSWORD`、`RESET_PASSWORD`。

## 8. 维护铁律

- 不允许把重置链接、令牌或用户密码写进日志。
- 不允许在数据库中保存原始重置令牌。
- 不允许根据邮箱是否存在返回不同文案或状态。
- 不允许跳过 `token_version` 会话撤销。
- 不允许覆盖生产 secrets 或重复跑迁移后不验证。
- 修改后必须提交明确 commit、推送 `master`，再分别部署两个 Worker，并报告 Worker Version ID 和测试结果。

## 9. BUG 维护流程（Hermes 必须执行）

任何账户、邮件、官网或发布 BUG 都按下面的小块处理，不要一边排查一边进行无关重构。

### Block 0：建立现场

- 记录用户看到的页面、准确时间、URL、操作顺序和是否为正式安装包。
- 执行 `git status -sb`、`git log -5 --oneline`，确认当前分支和生产对应提交。
- 只读检查 Worker 健康、最新部署版本和相关 D1 状态。
- 不得删除用户数据、清空表、重跑迁移或覆盖 secret 来“试试看”。

### Block 1：最小复现与定位

- 先确认故障属于官网 UI、网站 Worker 代理、订阅 Worker、D1、Resend/DNS 还是客户端。
- 使用一个受控测试账号复现一次，保存 HTTP 状态和不含敏感信息的日志。
- 为已确认的根因新增或更新契约测试；测试在修复前应能捕获问题。
- 只修改与根因直接相关的最少文件。

### Block 2：修复与本地回归

- 运行本手册第 5 节的全部检查和 `npm test`。
- 检查 `git diff`，确认没有账号数据、密钥、构建产物或 Playwright 临时文件进入提交。
- 对安全边界做人工复核：防枚举、令牌哈希、过期/单次使用、限流、旧会话撤销。

### Block 3：提交、部署和线上验证

- 一个根因对应一个清晰提交，禁止把多个无关修复塞进同一 commit。
- 推送后分别部署受影响的 Worker；没改的 Worker 不必为了形式重复部署。
- 线上先做只读检查，再做一次最小真实流程验证。
- 记录 commit、Worker Version ID、验证时间、测试邮箱（可脱敏）和最终状态。

### Block 4：关闭与回滚准备

- 在本文件“维护记录”增加一行，说明症状、根因、修复提交和验证结果。
- 若线上验证失败，优先回滚到上一个已知正常 Worker 版本；不要在生产上连续盲改。
- 回滚代码不能回滚 D1 用户数据。涉及 schema 时必须先评估向后兼容，禁止直接删除列或表。

## 10. 常见 BUG 快速对照

| 症状 | 优先检查 | 正确判断 |
|---|---|---|
| 点击忘记密码一直提示成功但没邮件 | D1 最新请求状态、Worker 日志、Resend 域名 | `issued` 才表示 Resend 接受；`requested` 表示发信失败 |
| 返回 `rate_limited` | `rate_limits` 对应精准 bucket | 安全限流正常工作，不要全表清空或永久放宽 |
| 重置链接提示无效 | 令牌是否过期/使用过、服务器时间 | 30 分钟、单次使用是设计要求 |
| 改密后旧设备仍登录 | JWT `ver` 与 `users.token_version` | 改密必须递增版本，旧 JWT 应失效 |
| 所有人都收不到邮件 | Worker secret 名称、Resend 状态、DNS | 检查 DKIM 与 `send.send.bbnba.com` 的 SPF/MX |
| 只有部分邮箱收不到 | Resend 投递日志、退信/垃圾邮件 | 不要把单个邮箱退信误判为全局故障 |
| 官网页面有表单但 API 404 | 网站 Worker 路由/代理和订阅 Worker 路由 | 两个 Worker 可能版本不一致 |
| 部署后官网仍是旧内容 | `wrangler deploy` 输出的 Version ID、域名路由、缓存 | GitHub 推送不等于 Worker 已部署 |
| D1 报重复列 | 是否误跑 `002-password-resets.sql` | 生产迁移已经执行，禁止重复执行 |

## 11. 维护记录

| 日期 | 症状/任务 | 根因 | 修复/配置 | 验证 |
|---|---|---|---|---|
| 2026-08-17 | 增加忘记密码邮件 | 原系统缺少安全重置流程 | `2dc1a24` | 37 项测试通过；生产请求为 `issued` |
| 2026-08-17 | 正式发件域名接入 | 初始只能使用 Resend 测试发件人 | 验证 `send.bbnba.com`，Worker `RESET_FROM_EMAIL` 切换为正式地址 | DKIM/SPF/MX 存在；Gmail 实收成功 |

后续代理每修复一个相关 BUG，都必须追加一行；不要改写已有历史。
