# 极客项目代理工作说明

本文件供 Hermes、Codex 及其他自动化开发代理进入仓库后优先阅读。

## 开始工作前

1. 先读 `README.md` 和 `docs/account-password-reset-operations.md`。
2. 运行 `git status -sb`，保留用户已有改动，不得擅自回滚或清理。
3. 修改账户、官网、发布或 Cloudflare Worker 前，先运行 `npm test`。
4. 不要把 API Key、JWT 密钥、管理员密码、邮箱密码、重置令牌或真实用户数据写进代码、日志、提交信息和文档。

## 账户与官网关键位置

- 账户/订阅生产入口：`scripts/geek-subscription-entry.js`
- 账户/订阅基础 Worker：`scripts/geek-subscription-worker.js`
- 官网页面：`scripts/geek-website-worker.js`
- D1 初始结构：`scripts/geek-subscription-schema.sql`
- D1 增量迁移：`scripts/migrations/`
- 账户安全契约：`test/account-security-contract.cjs`
- Free Worker 认证契约：`test/account-free-worker-kdf-contract.cjs`
- 生产注册/登录冒烟：`scripts/account-live-smoke.mjs`
- 订阅 Worker 配置：`wrangler-subscription.toml`
- 官网 Worker 配置：`wrangler-website.toml`

## 当前生产事实

- 官网：`https://geek.bbnba.com`
- 账户 API/管理后台：`https://admin.bbnba.com`
- D1：`geek-subscriptions`
- 正式重置邮件发件人：`极客 Geek <no-reply@send.bbnba.com>`
- Resend 发信域名：`send.bbnba.com`
- Cloudflare Worker secret 名称：`RESEND_API_KEY`、`RESET_FROM_EMAIL`、`JWT_SECRET`、`ADMIN_PASSWORD`
- secret 只允许通过受控部署/`wrangler secret put` 管理，不得尝试读取、打印或提交明文。

## 不能破坏的安全约束

- 忘记密码接口必须返回统一提示，不能泄露邮箱是否注册。
- 重置令牌必须随机生成，数据库只存 SHA-256 哈希，有效期 30 分钟且只能使用一次。
- 修改密码必须递增 `users.token_version`，使旧登录会话失效。
- Workers Free 每个 HTTP 请求 CPU 预算很小；生产入口不得在注册/登录热路径重新引入 PBKDF2/Argon2/bcrypt 等高 CPU KDF。
- 当前生产新密码使用 `v4$`：随机盐 + 由服务端 `JWT_SECRET` 做用途隔离的 HMAC-SHA-256 校验值。旧 `v2$`/`v3$`/无前缀 PBKDF2 行不得在 Free Worker 上重算，必须进入密码重置流程。
- `JWT_SECRET` 既用于 JWT，也作为 v4 密码校验的服务端机密根；轮换它会使现有 v4 密码校验失效，除非同时安排密码重置/迁移，因此不得随意轮换。
- 限流、HttpOnly 会话 Cookie、同源/CORS 边界和支付确认校验不能绕过。
- `002-password-resets.sql` 已在生产执行，禁止重复执行其中的 `ALTER TABLE`。

## 提交与部署最低流程

```powershell
npm test
node --check scripts/geek-subscription-worker.js
node --check scripts/geek-subscription-entry.js
node --check scripts/geek-website-worker.js
git diff --check
```

测试通过后才可提交、推送和部署。完整部署与线上验证步骤见
`docs/account-password-reset-operations.md`。

