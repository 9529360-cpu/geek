# Geek Agent Handoff

> 这是当前施工现场的结构化镜像，不是聊天记录，也不是永久规范。永久规则见 `AGENTS.md`；可复制项目提示词见 `docs/GEEK-MAINTAINER-PROMPT.md`。每轮维护开始和结束时都要用真实仓库状态对齐本文件。

## 当前目标

建立稳定的跨电脑、跨会话、跨 Agent 维护入口，让任何模型或人类维护者进入仓库后都能直接恢复真实现场，而不是依赖聊天记忆或 Issue #50 的长历史。

## 当前仓库状态

- 基线分支：`master`
- 基线 `master` HEAD：`ddbc0d387b4ac061b44f94759aad6da3917f5019`
- 基线提交：`release: Geek 1.2.16`
- `package.json.version`：`1.2.16`
- `.github/release-client-version`：`1.2.16`
- 当前工作分支：`docs/agent-handoff-system`
- 当前 PR：#164 `docs: establish durable cross-agent handoff`
- 当前分支相对 `master`：ahead 9 / behind 0。
- 当前 diff 仅 6 个维护文档/元数据文件：`.agent/HANDOFF.md`、`AGENTS.md`、`docs/GEEK-MAINTAINER-PROMPT.md`、`docs/README.md`、`docs/github-control-plane.md`、`docs/release-security.md`。
- 无运行时代码、Worker、依赖、数据库、Secrets、package version 或 release marker 变化。

## 已完成

- [x] 建立 `.agent/HANDOFF.md` 作为仓库内当前施工现场。
- [x] 更新 `AGENTS.md`：明确真相层级、启动恢复、工作中同步、收工对齐和危险操作边界。
- [x] 将 `docs/GEEK-MAINTAINER-PROMPT.md` 更新为 Geek 专属长期项目提示词，不硬编码易漂移的当前 HEAD/版本/任务。
- [x] `AGENTS.md` 已把 `docs/GEEK-MAINTAINER-PROMPT.md` 列为任何维护者开始工作时的必读入口。
- [x] 更新 `docs/README.md`：把 AGENTS / HANDOFF / maintainer prompt / Issue #50 的职责分层写清楚。
- [x] 更新当前运维文档，避免把会变化的版本号作为永久事实。
- [x] 核对当前分支 package version 与 release marker 均仍为 `1.2.16`。
- [x] 核对当前 diff：只包含上述 6 个文档/维护文件。

## Task Queue

| 优先级 | 状态 | 任务 | 完成条件 |
|---|---|---|---|
| P1 | done | 建立跨 Agent 维护体系 | AGENTS / HANDOFF / 项目提示词 / 文档索引职责清楚且互相链接 |
| P1 | done | 将 Geek 项目提示词纳入仓库启动路径 | `docs/GEEK-MAINTAINER-PROMPT.md` 保存长期提示词，`AGENTS.md` 明确要求读取 |
| P1 | done | 消除当前运维文档中的静态版本漂移 | 当前运维文档改为要求实时核对版本/HEAD/Actions |
| P2 | in_progress | 验证 PR #164 最新 HEAD | 最新 head 的标准 PR CI 通过，最终 diff 无异常 |
| P2 | planned | 合并 PR #164 | 当前 HEAD CI 通过且无新的阻塞后合并；合并后以新 master HEAD 更新长期 checkpoint |

## 关键决策

1. **实时事实优先。** 当前 Git/源码 > 实际测试/CI/生产结果 > 当前 PR/任务分支 > HANDOFF > 生产状态 Issue > 运维文档 > Issue #50 > 历史资料/聊天。
2. **长期规则与现场分离。** `AGENTS.md` 保存长期规则；`docs/GEEK-MAINTAINER-PROMPT.md` 保存可复制项目提示词；`.agent/HANDOFF.md` 保存当前施工现场；Issue #50 保存长期历史。
3. **不在长期提示词硬编码动态状态。** 当前版本、HEAD、PR、测试数量和部署状态必须每轮实时读取。
4. **生产证据独立。** Cloudflare 部署看实际 Actions + Issue #21；账户生产 smoke 看实际 Actions + Issue #23。
5. **发布边界不变。** 普通维护不得修改 `.github/release-client-version`，不得把文档维护描述成客户端发布。

## 验证记录

- GitHub compare：`master` → `docs/agent-handoff-system` 为 ahead 9 / behind 0，6 个文件变化，均为维护文档/元数据。
- 分支 `package.json.version` 实际核对：`1.2.16`。
- 分支 `.github/release-client-version` 实际核对：`1.2.16`。
- 旧 PR head `a5ce9aec3e743a60c34ed148d4d842063f3386cf` 的标准 `test` Actions run `32605817864` 已实际 success。
- 当前最新 HEAD 在本次文档更新后需要重新核对对应 PR CI；旧 HEAD 的绿灯不能替代最新 HEAD。
- 当前 connector 环境没有本地 checkout，因此不声称执行过本地 `npm test`、`git status` 或 `git diff --check`。
- 未进行真实客户端回归：本 PR 只有维护文档变化，不涉及客户端行为。
- 未发生 Cloudflare 生产部署。
- 未发生正式客户端发布。

## 风险与阻塞

- PR #164 尚未合并，所以 `master` 当前还没有完整 HANDOFF / maintainer-prompt 启动体系。
- 必须以本次更新后的最新 PR HEAD 对应 Actions 结果作为最终 CI 证据，不能复用旧 HEAD CI 作为合并依据。

## 下一步

1. 获取 PR #164 最新 HEAD 并核对对应标准 CI。
2. 再次检查最终 diff、版本/release marker 和与 `master` 的关系。
3. 若最新 CI 通过且无新阻塞，合并 #164。
4. 合并后重新读取真实 `master` HEAD，并在 Issue #50 留一条简洁历史 checkpoint。
