# Geek Agent Handoff

> 当前施工现场的结构化镜像，不是聊天记录或永久规范。永久规则见 `AGENTS.md`，可复制项目提示词见 `docs/GEEK-MAINTAINER-PROMPT.md`。真实仓库、实际测试/CI/生产结果始终优先。

## 当前目标

让 Geek 的跨 Agent 维护体系从“安全恢复上一任任务”升级为“安全恢复真实现场 + 自主判断并持续推进最重要的产品问题”，同时保留已经形成的生产、账户、Electron/WebView、群发和正式发布安全边界。

## 当前仓库状态

- Repository: `9529360-cpu/geek`
- 正式基线：`master`
- 本轮基线 `master` HEAD：`b6e7a89d33f0f6504e9ba3bad6b5fa9960b0568b`，`fix: prevent concurrent Electron instances per runtime profile (#197)`。
- 当前维护分支：`docs/maintainer-product-agency`
- 本轮只修改维护规则/提示词/HANDOFF，不修改 runtime、Worker、依赖、数据库、版本或 release marker。
- `master` 当前未启用 branch protection required checks；这不改变维护者必须真实检查 PR CI 的纪律。

## 已完成

- [x] 读取并核对 `AGENTS.md`、`docs/GEEK-MAINTAINER-PROMPT.md`、旧 HANDOFF 与实时 master。
- [x] 将维护目标改为 product-first：Issue/HANDOFF/Task Queue 是现场信息，不是不可推翻的任务剧本。
- [x] 增加 Geek 专属主动产品体检：Electron/WebView、多账号 partition、登录态/重启恢复、WA/TG/LINE transport、群发 ownership/附件/发送授权、客户端与 Worker contract、错误恢复/并发/幂等等。
- [x] 增加“存在 → 接通 → 验证 → 产品闭环”成熟度判断，防止代码存在或测试数量增长被误写成产品完成。
- [x] 明确正常低风险 branch/commit/push/PR/CI/merge 属于工程卫生，完成后应继续产品开发。
- [x] 保留 Electron/WebView、LINE 兼容例外、真实用户数据、账户密码、Workers Free CPU、JWT_SECRET、D1 migration、群发和正式客户端发布边界。
- [x] 把仓库完整 URL `https://github.com/9529360-cpu/geek.git` 写入可复制项目提示词。

## Task Queue

| Priority | Status | Task | Completion condition |
|---|---|---|---|
| P1 | in_progress | Review maintainer-agency diff | 仅维护文档变化；无安全边界、版本或 release marker 意外弱化 |
| P1 | planned | Run/observe standard PR CI | 最新 PR head 对应标准 CI 真实通过 |
| P1 | planned | Merge maintenance change normally | PR 可追踪合并到 master，无正式客户端发布/生产部署 |
| P1 | planned | Resume autonomous Geek product development | 新维护者重新读取真实产品/PR/Issue/active code，自主选择最高价值未阻塞问题，而不是机械执行旧 Task Queue |

## 关键决策

1. Geek 维护者首先是产品工程负责人，其次才是流程执行者。
2. Task Queue、Issue 和历史 checkpoint 不能覆盖更高优先级的真实用户问题、安全问题或可靠性问题。
3. 重要能力使用“存在/接通/验证/产品闭环”四层判断。
4. 正常 Git/CI/merge 后台化；正式客户端发布、生产高影响变更和不可逆操作仍保持独立人工授权。
5. 不删除 Geek 已经通过生产经验形成的具体安全约束；自主性不能以降低生产安全为代价。

## 验证状态

- 已实际读取实时 `master` 分支；本轮基线 HEAD 为 `b6e7a89d33f0f6504e9ba3bad6b5fa9960b0568b`。
- GitHub 当前报告 `master` branch protection disabled / required status checks 为空。
- 当前环境通过 GitHub connector 修改文档，没有本地 checkout，因此不声称运行过本地 `npm test`、`git status` 或 `git diff --check`。
- 本轮没有真实客户端行为变化，不需要把文档修改误写成真实客户端验证。
- 未发生 Cloudflare 生产部署。
- 未发生正式客户端发布。

## 下一步

检查本分支最终 diff 和 PR/CI。若仅为预期维护文档且标准 CI 通过，正常合并到 `master`。合并后重新从真实产品状态、开放 PR/Issue 和 active code 评估最高价值问题并继续开发，不把“维护词升级”本身变成新的长期阶段。
