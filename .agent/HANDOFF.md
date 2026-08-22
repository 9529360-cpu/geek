# Geek Agent Handoff

> 这是当前施工现场的结构化镜像，不是聊天记录，也不是永久规范。永久规则见 `AGENTS.md`。每轮维护开始和结束时都要用真实仓库状态对齐本文件。

## 当前目标

建立稳定的跨电脑、跨会话、跨 Agent 维护入口，避免新维护者必须从 Issue #50 的大量历史评论中猜测当前状态。

## 当前仓库状态

- 基线分支：`master`
- 本轮基线 `master` HEAD：`ddbc0d387b4ac061b44f94759aad6da3917f5019`
- 基线提交：`release: Geek 1.2.16`
- `package.json.version`：`1.2.16`
- `.github/release-client-version`：`1.2.16`
- 当前工作分支：`docs/agent-handoff-system`
- 本轮范围：仅维护文档与 Agent 交接体系；未修改运行时代码、Worker、依赖、数据库、Secrets 或客户端发布标记。
- 分支相对基线：仅 6 个文档文件发生预期变化（新增 2、修改 4）；无运行时文件变化。

## 已完成

- [x] 读取并核对完整仓库树、主要运行时区域、测试、脚本、工作流和运维文档。
- [x] 核对实时 `master` HEAD 与 1.2.16 发布标记。
- [x] 建立 `.agent/HANDOFF.md` 作为仓库内当前施工现场。
- [x] 更新 `AGENTS.md`：明确真相层级、开工前核对、工作中同步、收工后对齐和 Task Queue 规则。
- [x] 新增 `docs/GEEK-MAINTAINER-PROMPT.md`：提供换电脑/换会话/换模型时可直接复制的启动提示词。
- [x] 更新 `docs/README.md`：把 HANDOFF 纳入恢复入口，并区分动态事实与历史资料。
- [x] 更新 `docs/release-security.md` 和 `docs/github-control-plane.md`：移除易漂移的静态当前版本号，改为实时核对版本/HEAD/Actions。
- [x] 复核分支 diff：只包含上述文档体系变化，发布标记未改。

## Task Queue

| 优先级 | 状态 | 任务 | 依赖 | 完成条件 |
|---|---|---|---|---|
| P1 | done | 建立跨 Agent 维护体系 | 无 | `AGENTS.md`、HANDOFF、维护提示词和文档索引职责清楚且互相链接 |
| P1 | done | 消除当前运维文档中的静态版本漂移 | 上一项 | 两份当前运维文档改为动态核对版本；发布规则保持不变 |
| P2 | done | 完成本轮 diff/状态复核 | 前两项 | 仅 6 个文档文件变化，release marker 保持 1.2.16 |
| P2 | planned | 通过 PR CI 验证并合并文档分支 | 当前分支 | PR 标准 CI 通过，review/diff 无异常后合并；合并后再以新 master HEAD 对齐 HANDOFF/Issue #50 |

## 关键技术决策

1. **真实仓库优先。** 真相层级：当前源码/Git 状态 > 实际测试与 Actions > 本文件 > Issue #50 历史 checkpoint > 对话描述。
2. **稳定规则和临时进度分离。** `AGENTS.md` 保存长期规则；`.agent/HANDOFF.md` 保存当前现场；Issue #50 保存长期历史 checkpoint。
3. **不在永久文档复制易漂移状态。** 当前版本、HEAD、测试数量等必须从实时仓库/CI读取；HANDOFF 可以记录一个明确、带语境的核对快照。
4. **生产证据继续独立。** Cloudflare 部署以对应 Actions + Issue #21 为准；账户生产 smoke 以对应 Actions + Issue #23 为准。
5. **发布边界不变。** 普通维护不得改 `.github/release-client-version`，不得把文档维护描述成客户端发布。

## 重要文件

- `AGENTS.md`：长期 Agent 规则和安全边界。
- `.agent/HANDOFF.md`：当前施工现场（本文件）。
- `docs/GEEK-MAINTAINER-PROMPT.md`：给新 Agent/GPT 的可复制启动提示词。
- `docs/README.md`：文档分类、来源优先级和恢复入口。
- `docs/github-control-plane.md`：GitHub/Cloudflare 控制面。
- `docs/release-security.md`：Windows 客户端发布与回滚边界。
- Issue #50：长期维护 checkpoint/history。
- Issue #21：Cloudflare 生产部署状态。
- Issue #23：账户注册/登录/鉴权 smoke 状态。

## 验证记录

- 已实际核对本轮基线 `master` HEAD：`ddbc0d387b4ac061b44f94759aad6da3917f5019`
- 已实际核对 `package.json.version`：`1.2.16`
- 已实际核对 `.github/release-client-version`：`1.2.16`
- 已实际比较 `ddbc0d3...` → `docs/agent-handoff-system`：分支 ahead 6 / behind 0；变化文件仅 `.agent/HANDOFF.md`、`AGENTS.md`、`docs/GEEK-MAINTAINER-PROMPT.md`、`docs/README.md`、`docs/github-control-plane.md`、`docs/release-security.md`。
- 本轮没有运行时代码变化，因此没有在当前 connector 环境伪称本地 `npm test` 已执行。
- PR CI 尚未运行/核对；在合并前必须以实际 PR CI 结果为准。

## 已知风险

- Issue #50 历史很长，旧 checkpoint 中包含旧版本号；新维护者若跳过实时核对仍可能误判，因此 `AGENTS.md` 已明确真相层级。
- 当前工作只存在于 `docs/agent-handoff-system` 分支；在 PR 合并前，`master` 尚未获得新的 HANDOFF 体系。
- GitHub connector 不提供本地 working tree，因此无法声称执行了本地 `git status`/`git diff --check`；已使用 GitHub commit compare 核对变更范围。

## 下一步

1. 为 `docs/agent-handoff-system` 创建聚焦 PR。
2. 等待并核对标准 PR CI；若失败，区分本次变化与仓库原有失败并修复相关问题。
3. review 通过后合并；普通文档合并不得触发或描述为客户端发布。
4. 合并后重新读取真实 `master` HEAD，更新 HANDOFF checkpoint，并在 Issue #50 留一条简洁的历史记录。
