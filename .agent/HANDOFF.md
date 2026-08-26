# Geek Agent Handoff

> 当前施工现场只记录实时任务状态；长期规则见 `AGENTS.md`，可复制维护提示词见 `docs/GEEK-MAINTAINER-PROMPT.md`。任何旧 PR、Issue、测试安装包或本文件快照与实时 Git/CI 冲突时，以实时证据为准。

Updated: 2026-08-26

## 当前目标

重新审视并收口 Draft PR #166 `feat: make broadcast runtime account-scoped`。只把 `ux/broadcast-account-jobs` 当作当前候选集成线；不得恢复、cherry-pick 或重新提供已被真实客户端否决的 `ux/broadcast-product-polish` 实现与测试安装包。

## 当前仓库状态

- 默认/基线分支：`master`。
- 当前已验证 `master` HEAD：`4f6612dd30b00f0710cf0c51e2cee665948e2c80`（PR #164 跨 Agent HANDOFF 体系已合并）。
- `package.json.version`：`1.2.16`。
- `.github/release-client-version`：`1.2.16`。
- 当前任务分支：`ux/broadcast-account-jobs`。
- 当前 PR：#166，Draft。
- 本轮对账前 PR head：`0899b1ed41a6f8dc9b33120c65f1413e0b2cb649`。
- 本轮对账前相对最新 `master`：ahead 114 / behind 1；落后的唯一 `master` 变化是 PR #164 的维护文档/元数据体系。
- #168 `feat: persist scheduled broadcast attachment refs` 已经合并进 `ux/broadcast-account-jobs`，因此当前 #166 代码已包含 durable scheduled attachment refs；旧 PR 描述中“未来定时+附件继续 fail-closed”已失效。
- 本轮会用普通 merge commit 把最新 `master` 的 #164 文档体系并入当前任务分支，不做 force push 或历史重写。

## Task Queue

| 优先级 | 状态 | 任务 | 完成条件 |
|---|---|---|---|
| P0 | done | 放弃被真实客户端否决的 `ux/broadcast-product-polish` 线 | 不合并、不 cherry-pick、不复用其实现和安装包 |
| P0 | blocked | 删除已废弃远程 refs | 仅在存在正常 branch-delete 能力时删除；禁止 force-move 代替 |
| P1 | done | 重新核对 #166 当前代码与 PR 描述 | 确认当前 runtime/contract、#168 合入事实、真实 CI 状态与剩余实机门禁 |
| P1 | in_progress | 将 #166 与最新 `master` 对账 | 合入 PR #164 的维护文档体系，解决 `.agent/HANDOFF.md` 冲突；新 HEAD 标准 CI 通过 |
| P1 | blocked | #166 真实 Electron 客户端回归 | 必须在当前 #166 基线上验证多账号并发/切换/暂停继续停止/排队 drain/WebView 生命周期及 WA/TG/LINE 附件路径；当前环境无法代替真实客户端 |
| P1 | planned | #166 Ready / merge | 只有最新 HEAD CI 绿灯、分支与 `master` 对齐且真实客户端门禁满足后才能执行 |
| P1 | planned | 正式客户端发布 | 独立授权动作；本轮不发布 |

## 已核对的实现事实

- `BroadcastJobManager` 支持不同账号 executing Job 并发，同账号最多一个 executing，同时允许 scheduled / queued。
- Job 固定 `accountId / partition / platform / WebView / targets / message / attachments / vcards / tagAll / interval` 等归属；账号切换不改变 owner。
- Runtime 使用显式 `job.accountId` 找账号与 WebView，`sendHistory` 写回 `job.accountId`。
- 单 Job targets 仍串行发送并遵守随机间隔。
- 继续使用 `GeekPlatformTransports.forAccount(...)` 与 `GeekBroadcastSafety.authorizeSend`，没有新增绕过 WA/TG/LINE 发送安全边界的旁路。
- #168 已把定时附件改为主进程 durable opaque refs：renderer 不获得 canonical path；ref 绑定 accountId + task/job；发送前重新 realpath/stat；materialize 后回到现有 short token/transport；terminal 后 cleanup。
- 最终约束以 `docs/群发最终实现约束-20260824.md` 和当前代码/contracts 为准。

## 实际验证记录

- #166 对账前 head `0899b1ed41a6f8dc9b33120c65f1413e0b2cb649` 的标准 Linux `test` run `32781409935`：completed / success；其中 `Run tests` step 实际 success。
- 同一 head 的 `acl-windows` run `32781409939`：completed / success。
- 这些 CI 结果证明当前代码/contract 在该 head 上通过自动化，但不能替代本轮合并 `master` 后的新 HEAD CI，也不能替代真实客户端回归。
- 当前 connector 环境没有本地 checkout，因此不声称执行过本地 `npm test`、`git status` 或 `git diff --check`。
- 本轮没有执行真实客户端验证。
- 本轮没有 Cloudflare 生产部署。
- 本轮没有正式客户端发布。

## 已否决实现与产物

`ux/broadcast-product-polish` 和其验证/产品化衍生线已被真实客户端否决。以下测试安装包均不得恢复、复用或再次提供：

- artifact `9530876594` / `geek-1.2.16-broadcast-validation-2c5ae792.exe`
- artifact `9532121198` / `geek-1.2.16-broadcast-validation-738ff851.exe`
- artifact `9534323810` / `geek-1.2.16-broadcast-final-candidate-da649219.exe`
- artifact `9535717311` / `geek-1.2.16-broadcast-polish-final-08fa79c4.exe`
- artifact `9538030486` / `geek-1.2.16-broadcast-product-fixed-1a35bbbc.exe`
- artifact `9538979997` / `geek-1.2.16-broadcast-formal-ux-7f10234a.exe`

PR #175 与 validation PR #186 已关闭且不得合并。产品衍生 Issues #174/#178/#179/#182/#184 已按 `not_planned` 收口。以后若再次出现相似问题，必须从当时实时 #166/master 基线重新复现，不能把旧产品线自动复活。

## 安全与发布边界

- `sandbox=true`、`nodeIntegration=false`、`nodeIntegrationInSubFrames=false`、`webSecurity=true` 不得降低。
- WA/TG 保持 `contextIsolation=true`；LINE 局部兼容例外不在本任务调整。
- renderer 不获得真实附件路径；opaque token/ref 与 owner 校验保持。
- 不修改 `package.json.version` 或 `.github/release-client-version`。
- 不上传 R2 正式产物、不改 updater `latest.yml`、不建正式 tag/release、不执行正式客户端发布。

## 风险与阻塞

- #166 仍是 Draft；自动 CI 绿灯不能覆盖真实客户端历史否决证据。
- 本轮对账前分支落后最新 `master` 1 个提交且 `.agent/HANDOFF.md` 双方独立新增，必须先显式合并解决冲突。
- 真实客户端门禁只能在真实 Electron/WA/TG/LINE 环境验证；当前 GitHub connector 无法代替。

## 下一步

1. 完成最新 `master` → `ux/broadcast-account-jobs` 的普通 merge，对齐 #164 文档体系并保留本任务 HANDOFF。
2. 以合并后的最新 #166 HEAD 重新核对 compare、版本/release marker、标准 `test` 与 Windows CI。
3. 更新 #166 PR 描述，删除失效 CI/附件状态，明确只剩真实客户端门禁和任何新 HEAD CI 门禁。
4. 不生成或复用旧否决安装包；只有在明确需要新的当前基线测试包时，才走独立的非正式验证构建路径。
5. 真实客户端验收满足前保持 Draft，不合并到 `master`。
