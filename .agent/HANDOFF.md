# Geek Agent Handoff

> 当前施工现场的结构化镜像，不是聊天记录或永久规范。永久规则见 `AGENTS.md`，可复制项目提示词见 `docs/GEEK-MAINTAINER-PROMPT.md`。真实仓库、实际测试/CI/生产结果始终优先。

## 2026-08-30 联系人备注施工现场

- Telegram 标签群发修复 `aed52c382ffb881ee16254490a4e4ff20df6f7ca` 已由用户在真实客户端确认通过：标签只恢复普通收件人选择，不再走专用发送路由。证据已记录在 Draft PR #166。
- 当前分支：`feat/contact-notes`，基于在线 `origin/master` 的 `cc047df`；联系人备注与群发修复保持独立。
- 当前实现：WhatsApp / Telegram / LINE 共用顶部“备注”入口，包含客户名称、国家/地区、来源渠道、跟进状态、下次跟进时间、备注六项；按账号加密数据仓 + 平台 + 当前聊天 ID 隔离，不进入消息正文或 WebView 注入链路。
- 数据键：`contactNotes`；单条上限 2000 字、每账号最多 2000 条。支持查看、保存、删除及聊天切换时刷新。
- 验证：`npm test` 全部 85 项通过；`git diff --check` 仅报告仓库既有 Windows 行尾提示，无空白错误。
- 边界：尚未生成测试安装包、尚未做三平台真实客户端交互验证、尚未发布正式客户端。

## 2026-08-30 翻译双回车修复

- 当前叠加分支：`fix/translation-double-enter`，基于联系人备注提交 `65fd2c3`，方便生成同时包含备注和修复的验证安装包。
- 根因：Telegram / LINE 翻译发送锁命中时直接返回，却没有吞掉第二次真实用户回车或发送按钮事件，导致事件落入平台原生发送链路并发出原文；该缺口早于本轮群发标签修复。
- 修复：锁定期间只拦截 `isTrusted` 的用户重复发送；保留翻译完成后程序化提交译文的非可信事件。
- 验证：新增 `translation-double-enter-contract.cjs`；`npm test` 全部 86 项通过。仍需真实客户端快速双击回车验证。

## 当前目标

让 Geek 的跨 Agent 维护体系从“安全恢复上一任任务”升级为“恢复整个真实产品现场 + 自主判断并持续推进最高价值问题”，同时准确继承仓库已有的文档分层、自动 Worker 部署、真实客户端证据、账户安全和正式客户端发布边界。

## 当前仓库状态

- Repository: `9529360-cpu/geek`
- 正式基线：`master`
- 本轮基线 master HEAD：`b6e7a89d33f0f6504e9ba3bad6b5fa9960b0568b`，`fix: prevent concurrent Electron instances per runtime profile (#197)`。
- 当前维护分支：`docs/maintainer-product-agency`
- 当前 PR：#225 `docs: make Geek maintenance product-first and autonomous`。
- 本轮只修改 `AGENTS.md`、`docs/GEEK-MAINTAINER-PROMPT.md`、`.agent/HANDOFF.md`；不修改 runtime、Worker、workflow、依赖、数据库、package version 或 release marker。
- `master` 当前未启用 branch protection required checks；维护者仍必须真实检查 PR CI。

## 已完成

- [x] 读取 master 递归仓库树，核对维护文档、src/scripts/ui/test/resources、Cloudflare/Windows workflow 和发布控制面的位置。
- [x] 读取并核对 `README.md`、`docs/README.md`、`AGENTS.md`、旧 HANDOFF、`docs/github-control-plane.md`、`docs/release-security.md`、`docs/account-password-reset-operations.md`、`package.json`、`scripts/run-tests.cjs`、`src/main-entry.cjs`、`test.yml`、`release-client.yml`、`windows-real-client-regression.yml` 等关键事实源。
- [x] 确认真实启动入口为 `src/main-entry.cjs`，它在进入 `src/main.cjs` 前建立 runtime profile/userData、single-instance、附件与账号数据边界。
- [x] 确认仓库文档交接分层：AGENTS=长期规则；maintainer prompt=可复制启动词；HANDOFF=当前施工现场；docs/README=当前/历史索引；#21/#23=生产证据；#50=长期 checkpoint；ISSUES/事故/研究/UI 原型=历史背景。
- [x] 将 Task Queue/Issue 降级为候选工作和事实来源，要求接手者重新评估真实产品优先级。
- [x] 增加 Geek 专属主动产品体检与“存在 → 接通 → 验证 → 产品闭环”成熟度判断。
- [x] 明确测试、测试安装包、真实客户端 evidence、Worker 生产部署和正式客户端发布五类证据不能混用。
- [x] 明确 `test` 绿只代表 CI；`dist:test` 只代表测试安装包；`windows-real-client-regression` 只代表真实客户端 evidence；`deploy-*` 只代表对应 Worker 部署；只有 `release-client` 完成 promotion + public verification 才能称正式客户端发布成功。
- [x] 明确现有 Worker path-filter 自动部署应继续自动工作：普通修复 merge master 后自然触发的对应 Worker deployment 属于仓库既有自动链路，不需要错误升级为每次人工批准。
- [x] 保留正式 Windows 客户端发布独立授权：普通维护不改 release marker、不 dispatch release-client；新版本由已授权 marker 变更合入 master 后自动触发；同版本 dispatch 仅用于已授权失败恢复。
- [x] 保留 Electron/WebView、LINE、群发、真实用户数据、账户密码、Workers Free、JWT_SECRET、D1 migration 等具体安全边界。

## Task Queue

| Priority | Status | Task | Completion condition |
|---|---|---|---|
| P1 | done | Repository-wide maintenance/document/control-plane review | 关键架构、文档交接、自动化和发布边界已从真实 master 复核并进入规则 |
| P1 | in_progress | Final review PR #225 | 最终 diff 仅 3 个维护文件；无 workflow/runtime/version/release marker 意外变化 |
| P1 | planned | Observe exact-head PR CI | 最新 PR head 的标准 CI 真实通过；不复用旧 HEAD 绿灯 |
| P1 | planned | Merge PR #225 normally | 可追踪合并 master；本维护 PR 本身不触发正式客户端发布 |
| P1 | planned | Resume autonomous Geek product development | 新维护者从真实产品/PR/Issue/active code 自主选择最高价值未阻塞问题 |

## 关键决策

1. Geek 维护者首先是产品工程负责人，其次才是流程执行者。
2. Task Queue、Issue、#50 和历史文档不能覆盖更高优先级的真实用户、安全或可靠性问题。
3. 重要能力使用“存在/接通/验证/产品闭环”四层判断。
4. 正常 Git/CI/merge 后台化；现有 path-filter Worker 自动部署保持自动；正式客户端发布/恢复、凭据轮换和高影响基础设施变更保持人工授权。
5. Actions 绿色必须按 workflow/target 命名证据，禁止笼统写“发布成功”。
6. 动态版本、HEAD、测试数量、latest release/deploy 不写进长期规则；每轮从真实仓库/Actions读取。
7. HANDOFF 不自证最终 SHA，避免为记录自己刚产生的 commit 再制造无限自引用提交。

## 验证状态

- 已实际读取实时 master 与递归仓库树；基线 HEAD `b6e7a89d33f0f6504e9ba3bad6b5fa9960b0568b`。
- `package.json` 实时版本为 `1.2.16`；测试入口为 `node scripts/run-tests.cjs`，动态发现 `test/*.cjs` 并排除两个 CDP 开发工具。
- `test.yml` 在 PR/master push 执行 `npm test`；`release-client.yml` 仅由 master release-marker 变化或显式 dispatch 进入正式客户端发布。
- `windows-real-client-regression.yml` 是 self-hosted Windows evidence collector，不是 release。
- `docs/github-control-plane.md` 明确 Worker deploy 与 client release 是独立操作；`docs/release-security.md` 明确 pack/dist:test/dist/release 的边界。
- 当前环境通过 GitHub connector 修改文档，没有本地 checkout，因此不声称运行过本地 `npm test`、`git status` 或 `git diff --check`。
- 本轮没有 runtime/Worker/workflow 行为变化，不声称真实客户端或生产行为已验证。
- 未发生 Cloudflare 生产部署。
- 未发生正式客户端发布。

## 已发现文档漂移

- master `README.md` 仍含 2026-08-20 的 `1.2.14` 静态维护基线，而实时 `package.json.version` 已是 `1.2.16`。`docs/README.md` 已明确动态版本不应硬编码；该 README 行属于已识别的文档漂移。为避免扩大本次 maintainer-rule PR 范围，暂未顺手改 README；后续应删除静态版本快照或改成实时核对说明。
- `docs/account-password-reset-operations.md` 仍写“当前自动测试入口执行 62 项 contract”，而 `scripts/run-tests.cjs` 本身是动态发现。长期规则已禁止依赖硬编码测试数量；后续文档维护应把该数字改为以实时 CI 输出为准。

## 下一步

获取 PR #225 最新 HEAD，检查最终三文件 diff、版本/release marker、与 master 的关系和 exact-head 标准 CI。若仅为预期维护文档且 CI 通过，正常合并 master。合并后重新从真实产品状态、开放 PR/Issue 和 active code 评估最高价值问题，不把“维护词升级”本身变成新的长期阶段。
