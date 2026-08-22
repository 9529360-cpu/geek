# Geek Agent Handoff

> 这是当前施工现场的结构化镜像，不是聊天记录，也不是永久规范。永久规则见 `AGENTS.md`。每轮维护开始和结束时都要用真实仓库状态对齐本文件。

## 当前目标

建立稳定的跨电脑、跨会话、跨 Agent 维护入口，避免新维护者必须从 Issue #50 的大量历史评论中猜测当前状态。

## 当前仓库状态

- 基线分支：`master`
- 建立本轮工作时的 `master` HEAD：`ddbc0d387b4ac061b44f94759aad6da3917f5019`
- 基线提交：`release: Geek 1.2.16`
- `package.json.version`：`1.2.16`
- `.github/release-client-version`：`1.2.16`
- 当前工作分支：`docs/agent-handoff-system`
- 本轮范围：仅维护文档与 Agent 交接体系；不修改运行时代码、Worker、依赖、数据库、Secrets 或客户端发布标记。

## 已完成

- [x] 读取并核对完整仓库树、主要运行时区域、测试、脚本、工作流和运维文档。
- [x] 核对实时 `master` HEAD 与 1.2.16 发布标记。
- [x] 确认 Issue #50 已承担长期历史 checkpoint，但正文/旧评论不是实时状态唯一来源。
- [x] 确认部分当前运维文档仍含 1.2.14 等易漂移版本描述，需要改成“动态核对真实来源”。
- [x] 建立本文件作为仓库内当前状态入口。

## Task Queue

| 优先级 | 状态 | 任务 | 依赖 | 完成条件 |
|---|---|---|---|---|
| P1 | in_progress | 建立跨 Agent 维护体系 | 无 | `AGENTS.md`、本 HANDOFF、维护提示词和文档索引职责清楚且互相链接 |
| P1 | planned | 消除当前运维文档中的静态版本漂移 | 上一项 | 当前文档不再把易变化版本号当永久事实；发布规则保持不变 |
| P2 | planned | 完成本轮 diff/状态复核 | 前两项 | 仅文档发生预期变化，发布标记保持 1.2.16 |

## 关键技术决策

1. **真实仓库优先。** 真相层级：当前源码/Git 状态 > 实际测试与 Actions > 本文件 > Issue #50 历史 checkpoint > 对话描述。
2. **稳定规则和临时进度分离。** `AGENTS.md` 保存长期规则；`.agent/HANDOFF.md` 保存当前现场；Issue #50 保存长期历史 checkpoint。
3. **不在永久文档复制易漂移状态。** 当前版本、HEAD、测试数量等必须从实时仓库/CI读取；只有当前 HANDOFF 可以记录一个明确的核对快照。
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

本轮目前只做文档体系调整，没有运行时代码变化。

- 已核对 `master` HEAD：`ddbc0d387b4ac061b44f94759aad6da3917f5019`
- 已核对 `package.json.version`：`1.2.16`
- 已核对 `.github/release-client-version`：`1.2.16`
- 尚未宣称本轮 PR CI 通过；需要在最终变更形成后以实际 CI 为准。

## 已知风险

- Issue #50 历史很长，旧 checkpoint 中包含旧版本号；新维护者若跳过实时核对可能误判。
- `docs/release-security.md`、`docs/github-control-plane.md` 当前仍有静态 1.2.14 描述，正在本轮处理。
- GitHub connector 不提供本地 working tree，因此“工作区未提交修改”应理解为当前分支上的 GitHub 提交状态；本轮所有写入均通过独立分支完成。

## 下一步

1. 更新 `AGENTS.md`，把 HANDOFF 设为第一恢复入口并规定开工/收工对齐。
2. 新增 `docs/GEEK-MAINTAINER-PROMPT.md`。
3. 更新 `docs/README.md` 与两份当前运维文档，去除静态版本漂移。
4. 最终核对分支 diff、版本标记和 CI 状态，再更新本文件为收工状态。
