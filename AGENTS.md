# 极客项目代理工作说明

本文件供 Codex、ChatGPT、Claude、Gemini 及其他自动化开发代理进入仓库后优先阅读。这里保存**长期稳定规则、产品判断和安全边界**；可复制维护提示词见 `docs/GEEK-MAINTAINER-PROMPT.md`；跨会话恢复契约和 durable invariants 见 `.agent/HANDOFF.md`。**当前 HEAD、版本、开放 PR/Issue、CI、生产状态和 Task Queue 不以 Markdown 为权威，必须从 live GitHub 恢复。**

## 维护目标与事实来源

维护者的首要职责是持续推进 **Geek 真实产品本身**，不是机械消费旧 Issue、旧 HANDOFF、旧 roadmap 或历史 Task Queue。分支、commit、PR、CI、文档和 evidence 是工程工具，不是产品目标。能从代码、测试、CI、生产证据、Git 和现有设计判断的低风险工作应自行推进到可验证结果，然后继续判断下一项最有价值的产品问题。

事实优先级：

1. live `master`、当前源码/配置、Git 状态、`package.json`、锁文件与 `.github/release-client-version`；
2. 当前 contract / integration / E2E、GitHub Actions、真实客户端与生产运行结果；
3. live open PR / Issues 及其最新相关评论；
4. Issue #21/#23 的生产部署与账号 smoke 证据；
5. 当前 runbook / architecture docs 与 `.agent/HANDOFF.md` 的 durable recovery/invariant 说明；
6. Issue #50 dated checkpoint/history；
7. 历史研究、事故、旧 PR/Issue、UI 原型和聊天。

任何 Markdown 中的 SHA、版本、测试数量、分支名、PR 状态或“下一步”都只可能是历史快照。与 live repo 冲突时，以 live repo 为准并修正文档漂移；不要修改当前产品去迎合旧文字。

## 开工恢复流程

开始工作先读 `AGENTS.md`、`.agent/HANDOFF.md`、`docs/README.md`；需要复制完整维护提示词时再读 `docs/GEEK-MAINTAINER-PROMPT.md`。然后实时查询：

- `master` HEAD；
- `package.json.version` 与 `.github/release-client-version`；
- 当前任务相关源码、contract、workflow 和 owner；
- open PR/Issues 与 write set；
- 当前 HEAD 的 CI / E2E / deploy / release 证据；
- 需要时 #21/#23 的生产状态。

Issue #50 只用于 checkpoint/history。使用本地 checkout 时检查 `git status -sb` 并保留已有改动；只有 GitHub connector 时直接从 live remote 建独立分支，不要因为没有本地 git/gh CLI 就判断仓库无法维护。

## 产品与所有权判断

Geek 的真实 Electron 入口是 `src/main-entry.cjs`，它先确定 runtime profile/userData 和 single-instance boundary，再进入主进程编排。产品同时包含 `ui/`、WA/TG/LINE/Website WebView 与 bridge/transport、每账号独立持久化 partition、账户/订阅 Worker、官网 Worker、翻译 Worker、release Worker、D1/R2 与 Windows updater。

修改前尽量追完整链路：**入口 → owner → state → lifecycle → IPC/WebView bridge → persistence → dependency → tests → active caller**。重要能力按“存在 → 接通 → 验证 → 产品闭环”判断；代码、UI、contract 或绿色 CI 单独存在都不能自动等于真实产品闭环。

选择下一项时优先看真实用户影响：P0 数据/账号/凭证泄露或破坏、严重安全问题、核心客户端/生产不可用；P1 登录、账号隔离、消息/群发、订阅、WebView/runtime 生命周期与恢复、高概率严重回归和客户端/Worker contract 漂移；之后才是一般维护性、纯文档和非阻塞整理。旧 Issue 顺序、旧 roadmap、测试数量或 Task Queue 不能覆盖更高优先级的真实风险。

优先单一 owner、最小完整改动。`src/main.cjs`、`ui/app.js` 等大文件兼容敏感，能在小 owner 模块解决就不要继续堆全局状态。已有同根因 PR 时优先继续，不另造平行实现线；并行维护前检查 live PR write set，避免覆盖其他人工作。

`docs/FULL-STACK-HARDENING.md` 记录 FH-01～FH-08 的历史 owner 收敛。它是 archaeology/design ledger，不是后续编号路线图；不要凭空发明 FH-09～12。

## 默认开发闭环

理解当前产品状态和用户场景 → 主动体检 → 追 active path 与 owner → 找根因 → 参考成熟实现/官方文档 → 选择最小完整方案 → 修改并补对应测试 → 实际验证 → 检查 diff / 安全 / 隐私 / 性能 / 回归 → commit/push → PR → exact-head CI/E2E → 修门禁 → 正常 merge → 核对 merge 后真实触发的测试/部署 → 必要时更新 runbook/Issue → 重新评估产品并继续。

小型低风险修改使用轻量闭环；跨模块、生产、高风险或兼容敏感工作再增加完整集成/E2E/真实客户端/生产证据。不要为了流程而把两行修复做成大型项目，也不要因为改动小就跳过与风险匹配的验证。

## 测试、真实客户端、部署与正式发布必须分开

任何 Actions 结果都先确认 workflow 名称、触发方式、目标环境、实际步骤和 exact HEAD，再描述结论。

- `npm test` / `test` workflow：contract/CI 测试；绿色只表示对应 CI 测试通过。
- `electron-e2e`：GitHub-hosted Electron 自动 E2E；其中的 Windows cold-start / Linux smoke 只证明它们实际覆盖的机制。
- `npm run pack`：本地 unpacked Windows 目录，不是发布。
- `npm run dist:test` / validation client：测试安装包，不上传正式 R2/updater metadata/tag，不是发布。
- **真实 Windows 客户端证据**：按 `docs/windows-real-client-runner.md` 在真实 Windows 用户会话中人工采集/验证。仓库当前不维护 `geek-real-client` / `geek-linux` 等 self-hosted Actions runner，也不存在 `windows-real-client-regression` 作为当前正式 workflow。
- `deploy-website` / `deploy-translate` / `deploy-subscription` / `deploy-release-worker`：各自独立的 Cloudflare 生产 Worker 部署；只部署匹配服务，不等于客户端发布。
- `deploy-release-worker`：只更新 updater-serving Worker 并验证现有公开 updater，**不等于发布新 Windows 客户端**。
- `release-client`：正式 Windows 客户端发布。只有完成目标版本正式构建、版本化 installer/blockmap、rollback snapshot、`latest.yml` 最后 promotion 与公网 production verification 后，才可以说正式客户端发布成功。

仓库既有自动 Worker 部署应保持自动：正常 Worker 源码通过 PR 合入 `master` 后，若现有 path filter 自然触发对应生产部署，维护者应观察并核对结果；不要为了测试修改无关路径强行触发部署，也不要擅自扩大 secrets 权限。

Windows 正式客户端发布是独立授权边界。普通源码、Worker、测试或文档维护不得修改 `.github/release-client-version`，也不得手动 dispatch `release-client`。正常新版本在独立发布决策下同步更新 package version 与 release marker；已授权版本失败后的同版本恢复重试才允许显式 dispatch。两个入口都必须经过相同校验、构建、上一稳定版本验证、immutable upload、rollback snapshot、`latest.yml`-last promotion 和公网验证。

## Electron / WebView 安全边界

不得降低：`sandbox=true`、`nodeIntegration=false`、`nodeIntegrationInSubFrames=false`、`webSecurity=true`；每账号独立持久化 partition；WA/TG 保持 `contextIsolation=true`。LINE 当前局部 `contextIsolation=false` 是兼容例外，未经真实登录、认证、收发消息和重启恢复回归不得删除，也不得扩散。禁止通过 `--no-sandbox`、Node integration 或关闭 webSecurity 解决兼容问题。

账号 identity、partition、guest `WebContents`、Session 与账号级状态不得因为 UI focus/active account 改变而重新绑定。WebView ownership、导航、IPC sender、permission、attachment token 等边界必须 fail closed。

真实用户运行数据属于 Electron userData，不属于仓库。不得读取、打印、提交或写入 HANDOFF/Issue/PR：API Key、Token、JWT secret、密码、Cookie、Authorization header、LINE token/HMAC、reset token、真实用户数据、聊天正文、私有 URL query/hash、D1 用户内容和生产 Secrets。不要要求用户把密钥贴进聊天。

## 群发边界

群发是兼容敏感核心能力：不同账号独立 Broadcast Job 可以同时运行；同账号最多一个 executing Job，可有 scheduled/queued；Job 内 targets 串行并遵守随机间隔。Job 创建后固定 account/partition/platform/WebView/targets/message/attachments 等归属，切换查看账号不得改变 Job owner。

继续复用 `GeekPlatformTransports` 和 `GeekBroadcastSafety.authorizeSend`；不得绕过 WA/TG/LINE 安全发送边界。Renderer 不获得真实附件路径，附件保持 opaque token/owner 校验。历史上被真实客户端否决并标记不复用的实现线/测试安装包不得自动恢复；真实客户端否决属于有效产品证据。

当前群发长期约束先读 `docs/群发最终实现约束-20260824.md`，再以 live runtime/contracts 为最终权威；其他 dated 群发文档按 `docs/README.md` 的分类用于历史回归/研究。

## 账户 / 订阅 / 密码 / 额度边界

修改前读当前 contract 与 `docs/account-password-reset-operations.md`。忘记密码不得泄露邮箱是否存在；reset token 只存哈希、有有效期且单次使用；改密后旧会话失效。Workers Free 登录热路径不得重新引入 PBKDF2/Argon2/bcrypt；当前 `v4$` 密码验证依赖服务端 `JWT_SECRET` 用途隔离 HMAC-SHA-256。旧 `v2$`/`v3$`/无前缀 PBKDF2 不得在 Free Worker 热路径重算。

`JWT_SECRET` 轮换会影响现有 v4 密码验证，未经迁移/重置方案不得轮换；已执行的 migration 不得因为历史 runbook 存在就重复执行。翻译额度、rate limit、扣减以服务端为权威。限流、HttpOnly Cookie、同源/CORS、支付确认校验不得绕过。

## 文档治理与交接

仓库文档职责固定如下：

- `AGENTS.md`：长期稳定规则、安全边界和维护方法；
- `docs/GEEK-MAINTAINER-PROMPT.md`：可复制维护提示词；
- `.agent/HANDOFF.md`：**recovery contract + durable architecture/security invariants**，不是 live status database / Task Queue；
- `docs/README.md`：当前 runbook、历史资料、研究和原型的权威分层索引；
- Issue #21/#23：生产部署/账号 smoke 证据；
- Issue #50：长期 dated checkpoint/history；
- focused Issue / branch / PR / Actions：当前进行中的工作与验证现场；
- `ISSUES.md`、旧事故交接、研究、dated contract、UI 原型：历史背景/考古资料。

中大型任务的当前目标、风险、状态和 TODO 放在对应 focused Issue / PR，而不是写进 HANDOFF 形成第二套实时看板。只有 recovery procedure、长期 owner、安全边界或跨会话 invariant 真正改变时才更新 HANDOFF。动态版本、HEAD、测试数量、最新 deploy/release、开放 PR 数量每轮实时读取。

PR merge 前核对最新 head SHA、与 `master` 的关系、最终 diff、exact-head CI、必要真实客户端回归、版本/release marker 与安全/产品边界。合并后检查该 merge **实际**触发了什么 workflow，并用准确证据名称记录结果。

## 需要明确人工确认的操作

force push、Git 历史重写、大规模删除、不可逆数据库迁移、生产数据破坏、Secrets/密钥轮换、扩大凭据权限、正式客户端新版本发布或同版本恢复重试、版本强制回退、签名私钥/证书变更、关闭 CI/安全校验、高影响生产基础设施变更及其他明显不可逆操作，必须先取得明确人工确认。

普通低风险分支、代码修改、测试、commit/push、普通 PR、CI 修复、普通 merge、由既有 `master` path-filter 自然触发的对应 Worker 自动部署、聚焦文档修正默认自行完成。仓库级 branch protection / required checks 的 admin 配置目前由 Issue #444 跟踪；Windows Authenticode owner 操作由 Issue #445 跟踪。

回答用户时先用大白话说明产品发生了什么、为什么重要、实际做了什么、真实验证结果和剩余风险。严格区分：本地 contract、GitHub CI、测试安装包、GitHub-hosted Electron E2E、真实客户端人工验证、某 Worker 生产部署、账号生产 smoke、正式客户端发布。不要把 partial 写成 complete。

始终记住：**仓库是真相；实际运行结果比文字描述重要；安全边界比临时方便重要；测试不是发布；Worker 部署不是客户端发布；正式客户端发布永远是独立授权动作。**