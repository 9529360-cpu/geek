# 极客项目代理工作说明

本文件供 Hermes、Codex、ChatGPT 及其他自动化开发代理进入仓库后优先阅读。这里保存长期稳定规则；当前施工进度、HEAD 快照、任务队列和测试现场保存在 `.agent/HANDOFF.md`。不要依赖聊天记忆恢复项目。

## 维护目标与状态来源

维护者的首要职责是持续推进 **Geek 真实产品本身**，而不是机械消费 Issue、HANDOFF 或旧 Task Queue。分支、commit、PR、CI、HANDOFF、Issue checkpoint 和文档属于工程工具，不是产品路线。能从代码、测试、CI、生产证据、Git 和文档判断的低风险工作应自行推进到可验证结果，然后继续判断下一项最有价值的产品问题；不要每完成一个小步骤就等待用户安排。

判断当前状态时使用以下优先级：

1. 实时仓库内容、当前分支/HEAD、Git 状态与相关 diff；
2. 实际测试、构建、GitHub Actions、真实客户端与生产验证结果；
3. 当前 PR / 任务分支；
4. `.agent/HANDOFF.md` 当前现场；
5. Issue #21/#23 的生产证据索引；
6. README、运维文档和 Issue #50 的长期 checkpoint/history；
7. 历史研究、事故、UI 原型和对话描述。

若 HANDOFF、Issue 或文档与真实仓库不一致，以真实仓库为准，先对账并修正交接状态，再继续开发。HANDOFF 的 Task Queue 是上一任留下的事实和候选工作，不是不可推翻的命令。接手者必须继承事实，但应重新评估真实产品风险、用户影响和依赖关系；发现更高优先级问题时直接调整队列。

## 开始工作前

1. 先读本文件、`docs/GEEK-MAINTAINER-PROMPT.md`、`.agent/HANDOFF.md` 和 `docs/README.md`，再按当前问题读取对应源码、contract、workflow 和运维文档。
2. 核对实时默认分支 `master` HEAD、当前工作分支、`package.json.version`、`.github/release-client-version`、开放 PR/Issue、最近相关 commit/merge，以及需要时 Issue #21/#23 的最新生产状态。Issue #50 只补充长期历史，不替代实时状态。
3. 使用本地 checkout 时运行 `git status -sb` 并检查相关 diff，保留用户已有改动，不得擅自回滚或清理。使用 GitHub connector 时，从已确认的实时基线建立独立分支；不得因为本地没有 `git`/`gh` CLI 就错误判断仓库无法维护。
4. 主动检查当前最重要产品路径的入口、owner、state、lifecycle、IPC/WebView bridge、persistence、dependency、tests 和 active caller，不要只读取 Next target。
5. 修改账户、官网、发布或 Cloudflare Worker 前，先运行 `npm test`；仅使用 connector 时，至少让标准 PR CI 在最终合并树上执行并核对结果。自动入口动态发现 contract，测试数量以实际 CI 输出为准，不在永久规则里硬编码。
6. 一个根因原则上对应一个 Issue、分支和 PR。已有同根因 PR 时优先继续，不重复造实现线。涉及生产部署时，以对应 Actions run 和 #21/#23 为证据。
7. 不要把 API Key、JWT 密钥、管理员密码、邮箱密码、重置令牌、Cookie、LINE auth header、聊天正文或真实用户数据写进代码、日志、提交信息、HANDOFF、Issue 或文档。

## 产品判断与开发方式

选择下一项工作时优先问：**这件事情完成后，真实 Geek 用户最重要的体验、可靠性、安全性或产品闭环改善了多少？** P0 优先处理数据/账号/凭证破坏或泄露、严重安全问题和核心客户端/生产服务不可用；P1 优先处理登录、账号隔离、消息/群发、订阅等主路径阻塞，WebView/runtime 生命周期与恢复问题、高概率严重回归和生产 contract 漂移；随后处理 UI/架构已经声明但 active caller 未真正接通的核心能力和能够闭合真实用户场景的缺口；一般维护性、纯文档和非阻塞整理靠后。Issue 顺序、旧 Task Queue、测试数量或 Git 状态不能覆盖更高优先级的真实产品问题。

主动检查 UI 与 runtime 是否真正接通、多账号 partition/登录态/重启恢复、WA/TG/LINE transport active caller、群发 Job ownership 与附件/发送授权、客户端与 Worker contract、错误吞噬、失败脏状态、retry/timeout/cancellation、幂等/并发，以及 mock-only/stub/placeholder 和只有测试没有真实客户端/生产证据的关键能力。

重要能力至少按以下层级判断：

```text
存在：代码/UI/API 已出现
→ 接通：真实 Electron/Worker/transport/active caller 已使用
→ 验证：相关测试/CI/真实客户端证明行为成立
→ 产品闭环：真实用户场景从入口、状态、执行、结果到失败恢复成立；需要生产参与的能力还有生产证据
```

不要因为代码存在或测试数量增加就宣布完成。不得用增加文档、测试数字、evidence、Issue、PR、commit、HANDOFF 或流程步骤来替代真实产品能力进展。

默认工作循环：

```text
理解产品状态和真实用户场景
→ 主动体检并找到最值得解决的问题
→ 追真实调用链 / owner / state / lifecycle / dependency / tests / active caller
→ 判断存在 / 接通 / 验证 / 产品闭环层级
→ 找根因并选择最小完整方案
→ 修改代码并补测试
→ 实际验证并修失败
→ 检查 diff / 安全 / 隐私 / 性能 / 回归
→ commit / push / PR / CI
→ 修复门禁问题并正常合并
→ 更新必要 HANDOFF/文档
→ 重新评估产品并继续
```

小型低风险修改使用轻量闭环；中大型、跨模块、生产或高风险工作再增加完整 Task Queue、集成/E2E/真实客户端/生产验证。发现与当前根因直接相关、低风险且明确的 bug、安全问题、错误处理或测试缺口可以顺手修；不要无关大重构，不要擅自改变业务规则、公开 API、数据库兼容性、付费/额度语义或产品语义。

## 工作中与收工对齐

- 中大型任务在 `.agent/HANDOFF.md` 维护简洁 Task Queue，状态使用 `planned / in_progress / blocked / done`，优先级使用 `P0 / P1 / P2 / P3`。
- 每完成有意义阶段同步 HANDOFF；HANDOFF 只记录当前现场和候选下一步，不复制聊天、不保存密钥、不长期堆积失效 TODO。
- HANDOFF 至少记录当前目标、关键决策、重要文件、实际测试/CI/真实客户端/生产验证、分支/HEAD、风险和 blocker。
- 每轮结束前核对真实代码、Git/diff、测试、CI、版本/release marker 和 HANDOFF 是否一致。
- 完成可恢复 checkpoint 后可在 Issue #50 留简洁历史记录，但不要把写 checkpoint 变成产品工作本身。

## 仓库操作与发布边界

- Geek 没有固定开发分支；`master` 是正式代码基线。正常维护走“根因 → 独立任务分支 → 修改/测试 → commit/push → PR → CI/回归 → merge”。分支用于隔离风险，不用于长期堆积已验证工作。
- GitHub connector-native 的 Issue、分支、文件、PR、CI 检查和合并路径是正式可用维护方式；本地 `git`/`gh` 仅在环境具备且需要时使用。
- `src/main.cjs`、`ui/app.js` 等大文件兼容敏感。优先提取单一职责模块；使用整文件 contents API 时必须基于准确 blob SHA 和完整 diff 核对。
- 普通源码、Worker、测试或文档维护不得修改 `.github/release-client-version`，也不得手动启动正式客户端发布。
- 正常新版本发布由 release marker 变更触发；同版本 `workflow_dispatch` 只用于已有独立发布授权和失败证据的恢复重试，不能绕过完整测试、回滚和公网验证。
- force-push、Git 历史重写、凭据轮换、正式客户端发布/强制回退、破坏性数据库迁移和高影响生产变更不属于普通维护授权。其他正常低风险分支、commit/push、PR、CI 修复和普通 merge 应自行完成，不要反复询问。

## 账户、官网与安全关键位置

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

稳定生产端点/资源：官网 `https://geek.bbnba.com`；账户 API/管理后台 `https://admin.bbnba.com`；D1 `geek-subscriptions`；正式重置邮件发件人 `极客 Geek <no-reply@send.bbnba.com>`；Resend 发信域名 `send.bbnba.com`。Cloudflare Worker secret 名称包括 `RESEND_API_KEY`、`RESET_FROM_EMAIL`、`JWT_SECRET`、`ADMIN_PASSWORD`，只允许通过受控部署/`wrangler secret put` 管理，不得尝试读取、打印或提交明文。易变化的版本、HEAD、测试数量、最新发布和部署结果每轮实时核对，不写成永久事实。

不能破坏的安全约束：忘记密码接口必须返回统一提示；重置令牌随机生成、数据库只存 SHA-256 哈希、有效期 30 分钟且只能使用一次；修改密码必须递增 `users.token_version` 使旧会话失效；Workers Free 登录热路径不得重新引入 PBKDF2/Argon2/bcrypt 等高 CPU KDF；当前生产新密码使用 `v4$` 随机盐 + 由服务端 `JWT_SECRET` 做用途隔离的 HMAC-SHA-256 校验值，旧 `v2$`/`v3$`/无前缀 PBKDF2 行不得在 Free Worker 上重算，必须进入密码重置流程；`JWT_SECRET` 轮换会使现有 v4 密码校验失效，未经迁移/重置方案不得随意轮换；限流、HttpOnly Cookie、同源/CORS 和支付确认校验不得绕过；`002-password-resets.sql` 已在生产执行，禁止重复其中 ALTER。

Electron/WebView 安全边界、LINE 兼容例外、群发 ownership/安全发送、真实用户数据与附件 opaque token 等详细产品约束以 `docs/GEEK-MAINTAINER-PROMPT.md` 和对应当前 contract 为准，修改相关路径前必须读取并保持这些边界。

## 提交与验证最低纪律

有本地 checkout 时按变更范围至少运行相关检查；账户/官网常用基线：

```powershell
npm test
node --check scripts/geek-subscription-worker.js
node --check scripts/geek-subscription-entry.js
node --check scripts/geek-website-worker.js
git diff --check
```

只修改其中一个服务时执行与根因相关的额外检查和部署验证。完整账户/官网步骤见 `docs/account-password-reset-operations.md`，Cloudflare 控制面与状态通道见 `docs/github-control-plane.md`，客户端发布边界见 `docs/release-security.md`。

测试结果必须区分本地实际跑过、GitHub CI 实际跑过、真实客户端实际验证过、生产实际验证过和仅代码判断。PR merge 前核对最新 head SHA、与 master 的关系、最终 diff、当前 HEAD CI、必要真实客户端回归、版本/release marker 和安全/产品边界。生产部署结果由执行部署的 GitHub-hosted job 验证并写入 #21；账号生产 smoke 写入 #23。普通维护合并不得描述为正式客户端发布。
