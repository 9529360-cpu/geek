# 账户与忘记密码系统交接/运维手册

最初整理：2026-08-19。本文是账户/密码重置的运行与安全手册，不是实时生产状态数据库；当前源码、migration 应用状态、Worker 部署结果和生产行为必须从 live GitHub、对应 Actions、Issue #21/#23 与必要的只读生产检查重新确认。

## 1. 当前设计边界

- 官网登录页提供“忘记密码”。
- `/forgot-password` 提交邮箱，调用 `POST /api/password-reset/request`。
- `/reset-password?token=...` 设置新密码，调用 `POST /api/password-reset/complete`。
- 邮件由 Resend 自动发送，生产发件人为 `极客 Geek <no-reply@send.bbnba.com>`。
- 重置令牌为 32 字节安全随机值；D1 只保存 SHA-256 哈希，不保存原始令牌。
- 链接 30 分钟过期且只能使用一次。
- 请求响应统一，防止通过接口枚举已注册邮箱。
- 请求按 IP 限制为每小时 3 次，完成接口按 IP 限制为每小时 10 次。
- 改密后递增 `users.token_version`，此前签发的登录 JWT 自动失效。
- 邮件发送失败时，请求回退到 `requested`，不会伪装成已发送；发送成功状态为 `issued`。
- Workers Free 的注册、登录和重置完成热路径使用以 `JWT_SECRET` 为机密根、用途隔离的 HMAC-SHA-256 `v4$` 校验，不得重新引入 PBKDF2、Argon2 或 bcrypt。

最初实现对应提交：

- `2dc1a24 feat(account): add secure email password reset`
- `204326f chore(account): log password email delivery failures`

上述提交只用于 Git archaeology；当前 active path 以 live source/contracts 为准。

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

生产资源名、域名和绑定若与 live Wrangler/source/Cloudflare evidence 冲突，以 live 配置为准并更新本手册。

Resend 自动配置产生的 DNS 记录采用子域名嵌套，这是正常的：

- DKIM TXT 名称：`resend._domainkey.send.bbnba.com`
- SPF TXT 名称：`send.send.bbnba.com`
- MX 名称：`send.send.bbnba.com`

不要误把 SPF/MX 查询成 `send.bbnba.com`。只在受控诊断中检查公开记录是否存在，不把 Cloudflare DNS 响应内容复制到 Issue、Actions summary 或仓库文档。

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

交互输入正式发件人地址。不得把实际 key、密码或 secret 值写入 shell 历史、仓库文件、Actions 输出、Issue 或聊天记录。

`JWT_SECRET` 同时用于 JWT 和当前 `v4$` 密码校验。轮换会使现有 v4 密码无法验证，除非同步安排迁移或密码重置，因此不属于普通维护授权范围。任何凭据轮换都必须单独计划、验证并记录结果，但不得记录新旧值。

## 4. 数据库与迁移

迁移文件：`scripts/migrations/002-password-resets.sql`。

历史生产记录表明它已执行并增加：

- `users.token_version`
- `password_reset_requests` 表及索引

**执行任何 migration 前必须再次只读确认 live 生产 schema / migration 状态。** 不得因为本文写着某个 migration 文件就盲目重跑；SQLite/D1 的 `ALTER TABLE ... ADD COLUMN` 并非天然幂等。新环境初始化使用当前 `scripts/geek-subscription-schema.sql`；已有环境只按实际尚未应用的迁移顺序执行。

只读检查最近请求：

```powershell
npx wrangler d1 execute geek-subscriptions --remote --command "SELECT id, email, status, created_at, expires_at FROM password_reset_requests ORDER BY id DESC LIMIT 10" --config wrangler-subscription.toml
```

查询结果不得粘贴真实邮箱、令牌、密码哈希或其他用户数据到日志、Issue 或文档。

状态含义：

- `requested`：已记录但邮件未成功发送，可由后台或后续流程处理。
- `issued`：Resend 已接受邮件，令牌有效。
- `processing`：重置提交正在处理。
- `used`：密码已成功修改，令牌作废。
- `expired`：旧请求或过期请求已作废。

## 5. 修改后的验证与部署

### 本地/PR 前检查

```powershell
npm test
node --check scripts/geek-subscription-worker.js
node --check scripts/geek-subscription-entry.js
node --check scripts/geek-website-worker.js
git diff --check
```

`scripts/run-tests.cjs` 动态发现 `test/*.cjs` contract，并排除仓库明确标记为手动工具的条目。**当前 contract 数量以 live runner/CI 输出为准，不在本手册硬编码。** 历史记录中的 37、62 或任何其他数量都只是当时快照。

账户改动至少要保持当前存在的相关聚焦 contract 通过，例如：

- `test/account-security-contract.cjs`
- `test/account-free-worker-kdf-contract.cjs`
- `test/account-live-smoke-contract.cjs`
- 与具体根因对应的其他 account/website contract

若上述文件后来重命名/拆分，以 live test tree 为准，不为了迎合本手册恢复旧测试名。

### 正常生产路径

1. 一个根因建立一个 Issue、分支和 PR。
2. PR 的标准 `test` / 相关验证工作流通过后再合并到 `master`。
3. 合并内容命中现有生产 path filter 时，仓库自动运行受影响的生产工作流：
   - `deploy-subscription`：完整测试、订阅 Worker/入口/smoke/reporter 语法检查、Wrangler 部署、账号 smoke、公网 `/health` 验证；
   - `deploy-website`：完整测试、网站 Worker 语法检查、Wrangler 部署、官网 `/health` 验证。
4. `deploy-subscription` 将注册、登录、鉴权和测试账号清理结果写入 Issue #23，并把整体部署结果写入 Issue #21。
5. `deploy-website` 将非敏感部署与公网检查结果写入 Issue #21。
6. 对应 Actions run 和 #21/#23 评论共同构成生产证据；不得用本地临时容器的 DNS 结果替代。

两个 Worker 相互独立。只修改其中一个服务时，不为形式重复部署另一个服务；跨两个服务的同一根因仍需分别通过各自工作流。

### 手工 Wrangler 仅作受控回退

仅在自动化不可用、已明确记录原因且具备生产变更授权时，才使用手工部署：

```powershell
npx wrangler deploy --config wrangler-subscription.toml
npx wrangler deploy --config wrangler-website.toml
```

手工回退不得跳过完整测试、语法检查、公网验证和非敏感状态记录。不得为诊断读取或打印 Worker secrets、D1 数据内容、Cloudflare 响应正文或 DNS 值。

### 只读页面检查

```powershell
curl.exe -sS https://admin.bbnba.com/health
curl.exe -sS https://geek.bbnba.com/forgot-password
curl.exe -sS "https://geek.bbnba.com/reset-password?token=invalid"
```

健康接口应返回成功状态，两个官网页面应包含对应表单。上述命令适合受控诊断，不替代 GitHub-hosted 工作流的正式部署证据。不要在生产环境批量创建重置请求。

## 6. 真实邮件测试

使用一个确实注册的受控测试邮箱，在官网点一次“忘记密码”。随后只读查询最新记录：

```sql
SELECT id, status, created_at, expires_at
FROM password_reset_requests
ORDER BY id DESC
LIMIT 3;
```

看到 `issued` 代表 Resend 已接受发送；再检查收件箱和垃圾邮件。若为 `requested`：

1. 查看 Worker 日志中的 `password reset email rejected`；日志只能记录 HTTP 状态、错误类型和截断消息，不记录 key、邮箱、重置 token 或完整链接。
2. 只确认 `RESEND_API_KEY` 和 `RESET_FROM_EMAIL` secret 名称存在。
3. 检查 Resend 域名状态和必要的公开 DNS 记录。
4. 检查发件地址是否属于已验证的 `send.bbnba.com`。

连续测试可能返回 `{"error":"rate_limited"}`。这是安全功能，不是发信故障。不要为了方便删除或放宽生产限流；只有明确的受控诊断才能清理精准的测试 bucket，禁止清空整个 `rate_limits` 表。

## 7. 代码导航

以下名称用于快速定位，最终仍以 live source/search 为准：

- `scripts/geek-subscription-entry.js`：账户/订阅生产入口。
- `scripts/geek-subscription-worker.js`：账户、订阅和重置基础 Worker。
- `scripts/geek-website-worker.js`：官网页面与代理。
- `scripts/account-live-smoke.mjs`：生产注册、登录、鉴权和清理 smoke。
- `sendResetEmail`：调用 Resend API。
- `issuePasswordReset`：生成令牌、保存哈希、建立 30 分钟链接并发信。
- `handlePasswordResetRequest`：统一响应、防枚举、过期旧请求。
- `handlePasswordResetComplete`：领取令牌、改密、递增会话版本并标记使用。
- `requireUser`：校验 JWT 中的版本与数据库 `token_version`。
- 官网页面常量：`FORGOT_PASSWORD`、`RESET_PASSWORD`。

## 8. 维护铁律

- 不允许把重置链接、令牌、用户密码、JWT、Cookie 或真实邮箱写进日志。
- 不允许在数据库中保存原始重置令牌。
- 不允许根据邮箱是否存在返回不同文案或状态。
- 不允许跳过 `token_version` 会话撤销。
- 不允许绕过限流、HttpOnly Cookie、同源/CORS 边界和支付确认校验。
- 不允许覆盖生产 secrets 或盲目重复 migration。
- 不允许在 Workers Free 认证热路径重新引入高 CPU KDF。
- 修改后必须通过分支/PR、相关 contract 和完整测试；合并后核对实际触发的生产 workflow 及 #21/#23 状态。
- 失败时优先回滚到上一个已知正常 Worker 版本，不在生产上连续盲改。

## 9. BUG 维护流程

任何账户、邮件或官网 BUG 都按下面的小块处理，不要一边排查一边进行无关重构。

### Block 0：建立现场

- 记录用户看到的页面、准确时间、URL、操作顺序和是否为正式安装包。
- 确认 live `master`、生产对应提交、open PR/Issues 和相关 Actions run。
- 只读检查 Worker 健康、最新 #21/#23 状态和必要的 D1 元数据。
- 不得删除用户数据、清空表、重跑 migration 或覆盖 secret 来“试试看”。

### Block 1：最小复现与定位

- 先确认故障属于官网 UI、网站 Worker 代理、订阅 Worker、D1、Resend/DNS 还是客户端。
- 使用一个受控测试账号复现一次，只保存 HTTP 状态和不含敏感信息的日志。
- 为已确认的根因新增或更新契约测试；测试在修复前应能捕获问题。
- 只修改与根因直接相关的最少文件。

### Block 2：修复与回归

- 运行本手册第 5 节的当前有效检查和 `npm test`。
- 检查 diff，确认没有账号数据、密钥、构建产物或临时诊断文件进入提交。
- 人工复核防枚举、令牌哈希、过期/单次使用、限流、旧会话撤销和 Free Worker CPU 边界。

### Block 3：提交、部署和线上验证

- 一个根因对应一个 Issue、分支、PR 和清晰提交。
- PR CI 通过后合并，由命中 path filter 的受影响工作流部署；没改的 Worker 不重复部署。
- 线上先做只读检查，再做一次最小真实流程验证。
- 记录 commit、Actions run、公开 HTTP 状态和最终结果；测试邮箱仅可脱敏，不记录凭据。
- 自动化不可用时，只有在明确授权和回退计划下才执行手工 Wrangler 部署。

### Block 4：关闭与回滚准备

- 若本轮形成长期有效的新安全/运维 invariant，更新本手册；单纯当前状态不要写成永久事实。
- 如这次维护产生值得跨会话保留的恢复事实，可在 Issue #50 追加**简洁 dated checkpoint**；不要每个 merge 机械更新 #50。
- 生产账号 smoke 由 #23 留档，整体 Worker 部署由 #21 留档。
- 若线上验证失败，优先回滚到上一个已知正常 Worker 版本。
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
| 合并后未触发部署 | PR 文件范围、workflow paths、Actions 状态 | 普通文档/无关路径不会触发生产部署 |
| D1 报重复列 | 是否误跑已应用 migration | 先核对生产 schema / migration 状态，禁止盲目重跑 |

## 11. 维护记录

以下记录明确是历史快照，不代表当前版本、测试数量或生产状态。

| 日期 | 症状/任务 | 根因 | 修复/配置 | 验证 |
|---|---|---|---|---|
| 2026-08-17 | 增加忘记密码邮件 | 原系统缺少安全重置流程 | `2dc1a24` | 当时 37 项测试通过；生产请求为 `issued` |
| 2026-08-17 | 正式发件域名接入 | 初始只能使用 Resend 测试发件人 | 验证 `send.bbnba.com`，Worker `RESET_FROM_EMAIL` 切换为正式地址 | 当时 DKIM/SPF/MX 存在；Gmail 实收成功 |

后续只有在记录**历史上真正发生过且有证据的安全/运维事件**时追加一行；当前 live 状态仍从 GitHub/Actions/#21/#23 读取。