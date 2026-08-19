# 极客项目代理工作说明

本文件供 Hermes、Codex 及其他自动化开发代理进入仓库后优先阅读。当前项目状态不能只从对话记忆或历史文档恢复，必须先核对 GitHub 上的实时来源。

## 开始工作前

1. 先读 Issue #50 的最新评论，再读 `README.md`、`docs/README.md` 和本次任务对应的当前运维文档。历史事故、研究、旧发布交接和 UI 原型只用于理解背景，不是生产配置。
2. 核对实时 `master` HEAD、`package.json.version`、`.github/release-client-version`、开放 PR/Issue，以及 Issue #21/#23 的最新生产状态。若 HEAD 与 #50 最新 checkpoint 不同，先检查全部新增提交和合并，再开始修改。
3. 使用本地 checkout 时先运行 `git status -sb`，保留用户已有改动，不得擅自回滚或清理。使用 GitHub connector 时，从已确认的实时 `master` 建分支；不得因为本地没有 `gh` CLI 就错误判断仓库无法维护。
4. 修改账户、官网、发布或 Cloudflare Worker 前，先运行 `npm test`；仅使用 connector 时，至少让标准 PR CI 在最终合并树上执行并核对结果。自动入口动态发现 contract，当前数量以 CI 输出为准。
5. 一个根因对应一个 Issue、分支和 PR。合并后立即更新 Issue #50；涉及生产部署时，以对应 Actions run 和 #21/#23 为证据，不以本地临时环境能否解析域名为准。
6. 不要把 API Key、JWT 密钥、管理员密码、邮箱密码、重置令牌、Cookie、LINE auth header、聊天正文或真实用户数据写进代码、日志、提交信息和文档。

## 仓库操作与发布边界

- GitHub connector-native 的 Issue、分支、文件、PR、CI 检查和合并路径是正式可用的维护方式；本地 `git`/`gh` 仅在当前环境具备且确有需要时使用。
- `src/main.cjs`、`ui/app.js` 等大文件兼容敏感。优先提取单一职责模块；使用整文件 contents API 时必须基于准确 blob SHA 和完整 diff 核对，禁止顺手重写无关内容。
- 普通源码、Worker 或文档维护不得修改 `.github/release-client-version`，也不得手动启动正式客户端发布。
- 正常新版本发布由 release marker 变更触发；同版本 `workflow_dispatch` 只用于已有独立发布授权和失败证据的恢复重试，且不能绕过完整测试、回滚和公网验证。
- force-push、Git 历史重写、凭据轮换、正式客户端发布和高影响生产变更不属于普通维护授权。

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

有本地 checkout 时运行：

```powershell
npm test
node --check scripts/geek-subscription-worker.js
node --check scripts/geek-subscription-entry.js
node --check scripts/geek-website-worker.js
git diff --check
```

只修改其中一个服务时，仅执行与该根因相关的额外语法检查和部署验证；完整账户、官网部署与线上验证步骤见 `docs/account-password-reset-operations.md`，Cloudflare 控制面与状态通道见 `docs/github-control-plane.md`，客户端发布边界见 `docs/release-security.md`。

测试、diff 和 PR CI 通过后才可合并。生产部署结果必须由执行部署的 GitHub-hosted job 验证并写入 #21；账号注册、登录、鉴权和清理 smoke 写入 #23。普通维护合并不得被描述为发布了新客户端。
