# 文档索引与来源优先级

本仓库同时保留当前运行手册、长期架构约束、历史事故交接、逆向研究、旧实现契约和 UI 原型。它们的用途不同。**Markdown 不是实时状态数据库**：旧文档里的版本、SHA、PR 状态、测试数量、供应商、命令、分支名或“下一步”不能直接当作当前产品事实。

## 当前事实从哪里恢复

判断当前行为时按以下顺序取证：

1. live GitHub `master`、当前源码/配置、Git 状态、`package.json`、锁文件与 `.github/release-client-version`；
2. 当前 contract / integration / E2E、GitHub Actions、真实客户端与生产运行证据；
3. live open PR / Issues 及其最新相关评论；
4. 生产证据通道 Issue #21（Worker deploy）和 #23（账号 smoke）；
5. 当前运维/架构文档与 `.agent/HANDOFF.md` 中的 durable recovery/invariant 说明；
6. Issue #50 的最新 dated checkpoint/history；
7. 历史事故、旧实现契约、研究、进度快照、旧发布交接与 UI 原型。

若任何 Markdown、Issue 或旧 PR 与当前源码/工作流冲突，以真实仓库和实际验证为准。先修正文档/交接漂移，**不要反过来修改产品去迎合旧文字**。

## 跨会话恢复入口

- [`../AGENTS.md`](../AGENTS.md)：长期稳定的 Agent 操作规则、安全边界、产品判断与授权边界。
- [`../.agent/HANDOFF.md`](../.agent/HANDOFF.md)：跨会话恢复契约和 durable architecture/security invariants。它不是 live Task Queue，也不负责保存“当前 HEAD/当前版本”。
- [`GEEK-MAINTAINER-PROMPT.md`](GEEK-MAINTAINER-PROMPT.md)：换电脑/换会话/换模型时可直接复制的维护提示词。
- [Issue #50](https://github.com/9529360-cpu/geek/issues/50)：长期 checkpoint/history；评论是 dated snapshot，不替代 live GitHub。
- [`FULL-STACK-HARDENING.md`](FULL-STACK-HARDENING.md)：FH-01～FH-08 的 owner 收敛历史与 mutation evidence 索引，不是后续路线图。

新会话推荐顺序：`AGENTS.md` → `.agent/HANDOFF.md` → 本索引 → **实时查询** `master` / version / marker / open PR+Issues / Actions → 当前任务 owner + contract → 必要时 #21/#23/#50 和历史资料。

## 当前运维与架构文档

这些文件描述仍需维护的边界或操作方式，但其中涉及生产状态的内容仍需实时验证：

- [`../README.md`](../README.md)：产品入口、开发/验证入口和高层安全边界；动态版本不在 README 硬编码。
- [`github-control-plane.md`](github-control-plane.md)：GitHub Actions、Cloudflare validation/deploy、生产证据与 control-plane 边界。
- [`release-security.md`](release-security.md)：Windows 客户端构建、免费 unsigned 发布策略、版本标记、正式发布与回滚边界。
- [`windows-real-client-runner.md`](windows-real-client-runner.md)：真实 Windows 客户端人工证据边界；不把 GitHub-hosted CI 冒充持久真实 profile。
- [`account-password-reset-operations.md`](account-password-reset-operations.md)：账户、忘记密码、Resend、D1 与生产验证 runbook。
- [`account-number-rollout.md`](account-number-rollout.md)：`account_no` 两阶段 D1 迁移/repair runbook。执行前必须先确认生产已应用到哪一步，不能因为文件存在就重跑 migration。
- [`translation-gateway-auth-design.md`](translation-gateway-auth-design.md)：翻译鉴权/计费安全边界；具体 provider/model/配额实现必须以当前 Worker 和 contract 为准。
- [`翻译网关接口契约.md`](翻译网关接口契约.md)：客户端 ↔ 翻译服务边界与账号缓存约束；当前 endpoint/provider 细节需实时验证。
- [`账号沙箱数据边界.md`](账号沙箱数据边界.md)：账号级 Electron 数据持久化、allowlist、加密、compaction 和删除生命周期。
- [`群发最终实现约束-20260824.md`](群发最终实现约束-20260824.md)：账号级 Broadcast Job、queued/scheduled、固定 owner、durable attachment 的长期产品约束；当前实现仍以 runtime/contracts 为最终权威。

仓库治理状态本身是动态事实，必须读取 live repository rulesets / Issues，而不是在这里维护“当前待办列表”。历史上 #444 已用于跟踪 `master` protection/required checks，#445 已用于评估 Windows Authenticode；两者的最终状态与决策应直接从 GitHub Issue 和 live ruleset 恢复。当前发布策略以 `release-security.md` 和 owner 最新明确决策为准。

## 历史回归契约与实施记录

以下文件记录某轮实现/回归的验收条件。很多永久 invariant 仍有价值，但其中的 Draft PR、分支名、“本轮”、当时 UI 状态和下一步属于历史：

- [`群发附件回归修复契约-20260828.md`](群发附件回归修复契约-20260828.md)
- [`群发UI保存与标签修复契约-20260828.md`](群发UI保存与标签修复契约-20260828.md)
- [`群发体验与账号级任务改造.md`](群发体验与账号级任务改造.md) — 其中“第一版全局只允许一个活动 Job”已被后来的多账号并发约束明确废止；
- [`群发多账号并发补充.md`](群发多账号并发补充.md)
- [`群发差异审计-20260814.md`](群发差异审计-20260814.md)
- [`群发组件一比一审计-20260814.md`](群发组件一比一审计-20260814.md)
- [`进度-20260814-群组工具.md`](进度-20260814-群组工具.md)
- [`群组克隆编辑-技术结论.md`](群组克隆编辑-技术结论.md)

维护者可以从这些文件提取仍被当前代码/contract 证明的 invariant，但不得把旧“待做”“当前状态”自动恢复成 live backlog。

## 历史事故、研究与竞品资料

以下资料用于理解方案来源或当时故障，不代表已经实现、仍在使用或仍需实现：

- [`../ISSUES.md`](../ISSUES.md)：历史事故、逆向过程、修复与当时发布状态；不是 live issue tracker。
- [`release-worker-r2-mismatch-handoff.md`](release-worker-r2-mismatch-handoff.md)：2026-08-17 发布/R2/翻译网关交接；其中版本、provider、手工命令和状态均属于当时快照。
- [`helloworld-高级功能工具研究.md`](helloworld-高级功能工具研究.md)
- [`HaloGPT群发参考分析-20260824.md`](HaloGPT群发参考分析-20260824.md)
- [`群发竞品与任务模型调研-20260824.md`](群发竞品与任务模型调研-20260824.md)
- [`多平台翻译架构研究.md`](多平台翻译架构研究.md) — “TG/LINE 仍需接入”等阶段性描述是历史进度，不是当前 Translation Runtime 状态。

研究文件中的本地绝对路径、模型名、上游 endpoint、限流数字、旧 Electron/WPP 兼容结论、部署步骤和产品差距必须用当前实现重新验证。不得因为历史研究提到某供应商、API 或内部调用，就直接加入生产代码或 secrets。

## UI 原型与视觉参考

以下 HTML/PNG 是历史设计原型或截图，不是运行时页面，也不定义当前 DOM、文案、支付流程或安全边界：

- `original-ui-reference.html`
- `极客UI-v2-设计原型.html` 与对应预览图
- `极客UI-v3-Linear质感.html`
- `极客UI-v4-Mac质感.html` 与对应预览图
- `极客UI-v5-原位置Mac质感.html` 与对应预览图
- `极客UI-v6-到位版.html` 与对应真实效果图

产品改动应以 `ui/`、相关 owner、contract 和当前需求为准。不得直接复制原型里的旧接口、地址、凭据占位、支付文案或安全配置进入运行时。

## 动态事实不要硬编码

以下信息变化频繁，不应在长期规则/索引中复制成“当前永远如此”的事实：

- 客户端版本与 release marker；
- `master` HEAD / 当前分支 HEAD；
- contract/test 数量；
- 最新 release/tag；
- 当前开放 PR 数量或“当前没有 PR”；
- 最近一次 CI、Worker deploy、账号 smoke 或正式客户端 release 结果；
- 临时 Task Queue、诊断分支、artifact SHA。

这些内容每轮从 GitHub、源码、Actions、Issue #21/#23 和 live PR/Issues 重新读取。Issue #50 可以保存 dated checkpoint；`.agent/HANDOFF.md` 只维护恢复规则与 durable invariant，不复制 live 状态数据库。

## 维护规则

- 需要表达**当前进行中的工作**：使用 focused Issue / branch / PR / Actions；不要把 HANDOFF 或 README 当看板。
- 只有 recovery procedure、长期 owner、安全边界或跨会话 invariant 真正改变时，才更新 `.agent/HANDOFF.md`。
- 当前 runbook/architecture 文档可以通过聚焦 docs PR 更新。
- 历史事故、研究、回归契约和原型正文原则上保留原貌；通过本索引说明其权威等级，不把历史改写成“现在”。
- 文档不得记录 API key、JWT、Cookie、密码、reset token、LINE auth header、聊天正文、真实账号数据或 Cloudflare 响应正文。
- 普通文档维护不得修改 `.github/release-client-version`，也不得触发或描述为正式客户端发布。