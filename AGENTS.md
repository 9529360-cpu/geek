# 极客项目代理工作说明

本文件供 Hermes、Codex、ChatGPT 及其他自动化开发代理进入仓库后优先阅读。这里保存**长期稳定规则**；当前施工进度、HEAD 快照、任务队列和测试现场保存在 `.agent/HANDOFF.md`。不要依赖聊天记忆恢复项目。

## 状态来源与恢复顺序

判断当前状态时使用以下优先级：

1. 实时仓库内容、当前分支/HEAD、Git 状态与相关 diff；
2. 实际测试、构建、GitHub Actions 与生产验证结果；
3. `.agent/HANDOFF.md` 当前现场；
4. Issue #50 的长期 checkpoint/history；
5. README、运维文档和对话描述；历史研究、事故和 UI 原型只用于背景理解。

若 HANDOFF、Issue 或文档与真实仓库不一致，以真实仓库为准，先对账并修正交接状态，再继续开发。不要为了让代码“符合旧 HANDOFF”而覆盖真实代码。

## 开始工作前

1. 先读本文件和 `.agent/HANDOFF.md`，再读 `docs/README.md` 及本次任务对应的当前运维文档。
2. 核对实时默认分支 HEAD、当前工作分支、`package.json.version`、`.github/release-client-version`、开放 PR/Issue，以及需要时 Issue #21/#23 的最新生产状态。Issue #50 用于补充自 HANDOFF checkpoint 之后的历史，不再要求新 Agent 从全部评论中自行猜最新状态。
3. 使用本地 checkout 时运行 `git status -sb` 并检查相关 diff，保留用户已有改动，不得擅自回滚或清理。使用 GitHub connector 时，从已确认的实时基线建立独立分支；不得因为本地没有 `git`/`gh` CLI 就错误判断仓库无法维护。
4. 如果 `.agent/HANDOFF.md` 与仓库状态不一致，先判断差异来源并按真实状态修正 HANDOFF。只有差异可能覆盖他人工作、涉及高风险意图或无法判断时才询问用户。
5. 修改账户、官网、发布或 Cloudflare Worker 前，先运行 `npm test`；仅使用 connector 时，至少让标准 PR CI 在最终合并树上执行并核对结果。自动入口动态发现 contract，测试数量以实际 CI 输出为准，不在永久规则里硬编码。
6. 一个根因原则上对应一个 Issue、分支和 PR。涉及生产部署时，以对应 Actions run 和 #21/#23 为证据，不以本地临时环境能否解析域名为准。
7. 不要把 API Key、JWT 密钥、管理员密码、邮箱密码、重置令牌、Cookie、LINE auth header、聊天正文或真实用户数据写进代码、日志、提交信息、HANDOFF、Issue 或文档。

## 工作中与收工对齐

- 中大型任务必须在 `.agent/HANDOFF.md` 维护简洁 Task Queue，状态使用 `planned / in_progress / blocked / done`，优先级使用 `P0 / P1 / P2 / P3`。
- 每完成一个有意义阶段（代码修改、测试结果变化、合并、发布状态变化）就同步 HANDOFF；不要等到聊天结束才凭记忆补写。
- HANDOFF 至少记录：当前目标、已完成/未完成事项、关键决策、重要文件、已运行测试及结果、分支、基线/当前 HEAD、工作区或分支改动、风险、下一步。
- HANDOFF 只记录当前现场，不复制整段聊天，不保存密钥，不长期堆积已失效 TODO。永久架构/开发规范应写回本文件或对应正式文档。
- 每轮准备结束前再次核对真实代码、Git 状态/diff、测试结果、版本/发布标记和 HANDOFF 是否一致。
- 完成一个可恢复 checkpoint 后，可在 Issue #50 留简洁历史记录；Issue #50 是在线历史保险，不替代仓库内 HANDOFF。

## 仓库操作与发布边界

- GitHub connector-native 的 Issue、分支、文件、PR、CI 检查和合并路径是正式可用的维护方式；本地 `git`/`gh` 仅在当前环境具备且确有需要时使用。
- `src/main.cjs`、`ui/app.js` 等大文件兼容敏感。优先提取单一职责模块；使用整文件 contents API 时必须基于准确 blob SHA 和完整 diff 核对，禁止顺手重写无关内容。
- 普通源码、Worker 或文档维护不得修改 `.github/release-client-version`，也不得手动启动正式客户端发布。
- 正常新版本发布由 release marker 变更触发；同版本 `workflow_dispatch` 只用于已有独立发布授权和失败证据的恢复重试，且不能绕过完整测试、回滚和公网验证。
- force-push、Git 历史重写、凭据轮换、正式客户端发布、破坏性数据库迁移和高影响生产变更不属于普通维护授权。

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

## 当前生产事实与动态事实

稳定的生产端点/资源：

- 官网：`https://geek.bbnba.com`
- 账户 API/管理后台：`https://admin.bbnba.com`
- D1：`geek-subscriptions`
- 正式重置邮件发件人：`极客 Geek <no-reply@send.bbnba.com>`
- Resend 发信域名：`send.bbnba.com`
- Cloudflare Worker secret 名称：`RESEND_API_KEY`、`RESET_FROM_EMAIL`、`JWT_SECRET`、`ADMIN_PASSWORD`
- secret 只允许通过受控部署/`wrangler secret put` 管理，不得尝试读取、打印或提交明文。

易变化的版本、HEAD、测试数量、最新发布和部署结果**不要写成永久事实**。每轮从 `package.json`、`.github/release-client-version`、GitHub Actions、Issue #21/#23 和 `.agent/HANDOFF.md` 实时核对。

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

有本地 checkout 时，按变更范围至少运行相关检查；账户/官网常用基线为：

```powershell
npm test
node --check scripts/geek-subscription-worker.js
node --check scripts/geek-subscription-entry.js
node --check scripts/geek-website-worker.js
git diff --check
```

只修改其中一个服务时，执行与该根因相关的额外语法检查和部署验证。完整账户/官网步骤见 `docs/account-password-reset-operations.md`，Cloudflare 控制面与状态通道见 `docs/github-control-plane.md`，客户端发布边界见 `docs/release-security.md`。

测试、diff 和 PR CI 通过后才可合并。生产部署结果必须由执行部署的 GitHub-hosted job 验证并写入 #21；账号注册、登录、鉴权和清理 smoke 写入 #23。普通维护合并不得被描述为发布了新客户端。
