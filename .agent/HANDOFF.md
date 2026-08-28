# Geek Agent Handoff

> 当前施工现场只记录实时任务状态；长期规则见 `AGENTS.md`，可复制维护提示词见 `docs/GEEK-MAINTAINER-PROMPT.md`。任何旧 PR、Issue、测试安装包或本文件快照与实时 Git/CI 冲突时，以实时证据为准。HANDOFF 更新本身会产生新 HEAD，因此最终 CI 必须直接读取 GitHub Actions，不能由本文件自证。

Updated: 2026-08-28

## 当前目标

收口 Draft PR #166 `feat: make broadcast runtime account-scoped`。当前优先恢复原群发附件/电子名片成熟行为，并封住新 Job Runtime 引入的整包重复发送、即时任务初始化卡死、跨账号草稿串用和重复 target 风险。只把 `ux/broadcast-account-jobs` 当作当前候选集成线；不得恢复、cherry-pick 或重新提供已被真实客户端否决的 `ux/broadcast-product-polish` 实现与测试安装包。

## 当前仓库状态

- 默认/基线分支：`master`。
- 已验证 `master` HEAD：`4f6612dd30b00f0710cf0c51e2cee665948e2c80`。
- `package.json.version`：`1.2.16`。
- `.github/release-client-version`：`1.2.16`。
- 当前任务分支：`ux/broadcast-account-jobs`。
- 当前 PR：#166，Draft。
- 已完成普通双父 merge `9c81a68059fd5a7219a54e17d34dddffaaa3573d`，把 `master@4f6612dd...` 的 PR #164 跨 Agent HANDOFF/运维文档体系并入本分支；未 force push、未历史重写。
- merge 后 compare：ahead 115 / behind 0，merge base 已是最新 `master`；长期维护文档已与 `master` 对齐，业务 diff 仍是群发 runtime/contracts/docs，HANDOFF 保留当前任务现场。
- #168 `feat: persist scheduled broadcast attachment refs` 已合并进本分支；当前 #166 已包含 durable scheduled attachment refs。

## Task Queue

| 优先级 | 状态 | 任务 | 完成条件 |
|---|---|---|---|
| P0 | in_progress | 修复 #166 附件回归与高风险发送状态 | WA 已成功附件不因后续失败重发；附件+名片/仅名片语义可用；即时初始化异常终态失败；target 去重；GitHub 托管 CI 通过 |
| P0 | done | 建立本轮修复契约 | `docs/群发附件回归修复契约-20260828.md` 记录稳定需求 ID、验收 oracle、回滚和本机 CI 隔离边界 |
| P1 | planned | 客户备注产品与数据设计 | 账号+平台+canonical chatId 隔离、仅本地加密、不会默认进入外发正文；独立于附件回归提交 |
| P0 | done | 放弃被真实客户端否决的 `ux/broadcast-product-polish` 线 | 不合并、不 cherry-pick、不复用其实现和安装包 |
| P0 | blocked | 删除已废弃远程 refs | 仅在存在正常 branch-delete 能力时删除；禁止 force-move 代替 |
| P1 | done | 重新核对 #166 当前代码与 PR 描述 | runtime/contract、#168 合入事实、CI 和剩余实机门禁已对账 |
| P1 | done | 将 #166 与最新 `master` 对账 | behind 0，冲突解决；`9c81a680...` 的 Linux/Windows CI 实际通过 |
| P1 | blocked | #166 真实 Electron 客户端回归 | 当前 #166 基线完成多账号并发/切换/暂停继续停止/排队 drain/WebView 生命周期及 WA/TG/LINE 即时与定时附件路径验证 |
| P1 | planned | #166 Ready / merge | 最终 HEAD CI 绿灯、仍与最新 `master` 对齐且真实客户端门禁满足 |
| P1 | planned | 正式客户端发布 | 独立授权动作；本轮不发布 |

## 已核对的实现事实

- 2026-08-28 修复线新增 `ui/broadcast-delivery.js`：WA direct 附件按单文件重试，已确认成功文件不重放；正文只绑定最后一个附件；附件全成功后名片只发送一次；仅名片是有效内容。
- TG 原生附件批次和 LINE/其他非 direct 文件注入退出目标级整体重试循环，避免不明确结果导致整批重复发送。
- 群发编辑器绑定打开时账号；新会话/成功创建 Job 后消费附件、Excel 和名片草稿；所有 target 在排除规则前统一按 chatId 稳定去重。
- 即时 `running` Job 在账号/WebView/transport 初始化失败时转 `failed`；`scheduled/queued` 仍保留既有 20 次有界恢复语义。
- `BroadcastJobManager` 支持不同账号 executing Job 并发；同账号最多一个 executing，同时允许 scheduled / queued。
- Job 固定 `accountId / partition / platform / WebView / targets / message / files / attachmentRefs / vcards / tagAll / interval`；账号切换不改变 owner。
- Runtime 使用显式 `job.accountId` 找账号与 WebView，`sendHistory` 写回 `job.accountId`。
- 单 Job targets 串行发送并遵守随机间隔。
- 继续使用 `GeekPlatformTransports.forAccount(...)` 与 `GeekBroadcastSafety.authorizeSend`，没有新增绕过 WA/TG/LINE 安全发送边界的旁路。
- #168 的定时附件使用主进程 durable opaque refs：renderer 不获得 canonical path；ref 绑定 accountId + task/job；发送前重新 realpath/stat；materialize 后回到现有 short token/transport；terminal 后 cleanup。
- 最终约束以 `docs/群发最终实现约束-20260824.md` 和当前代码/contracts 为准。

## 实际验证记录

- 本轮按用户要求不在本机运行 Geek 测试/CI，也没有启动本机 Geek self-hosted runner；新增可执行 contract 将在推送后由 GitHub 托管 CI 验证。
- 本轮只执行了只读源码核对、远程分支快进核对和 `git diff --check`；`git diff --check` 通过。
- 对账前 head `0899b1ed41a6f8dc9b33120c65f1413e0b2cb649`：标准 Linux `test` run `32781409935` success；Windows `acl-windows` run `32781409939` success。
- master 同步 head `9c81a68059fd5a7219a54e17d34dddffaaa3573d`：
  - Linux `test` run `32973592803`：job `test` completed/success，`Run tests` step completed/success。
  - Windows `acl-windows` run `32973592564`：job `acl-integration` completed/success，`Run ACL contract` 与 `Run real Windows ACL integration` 均 completed/success。
- 本次 HANDOFF 记录会产生新的最终 PR HEAD；该 HEAD 仍须读取实时 Actions 结果，上一 HEAD 的绿灯不能替代。
- 当前存在本地 checkout，但不把静态 diff 核对声称为测试或真实客户端验证。
- 本轮没有执行真实 Electron/WA/TG/LINE 客户端回归。
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
- 当前唯一实质性产品门禁是当前 #166 基线的真实客户端回归；GitHub connector 无法替代真实 Electron/WA/TG/LINE 环境。
- 已废弃远程 refs 仍存在，但当前 connector 没有正常 branch-delete 动作；不使用 force-move 或历史重写规避。

## 下一步

1. 核对本次 HANDOFF-only 最新 HEAD 的标准 Linux/Windows CI、compare、版本和 release marker。
2. 把最终 CI 结果更新到 PR #166 / Issue #165 的在线 checkpoint，不再为记录最终 SHA 制造自引用 HANDOFF commit。
3. 保持 #166 Draft，等待当前基线真实客户端验收；不复用旧否决安装包。
4. 实机门禁满足后，再检查最新 `master`、最终 diff 与 CI，才讨论 Ready/merge。
5. 正式客户端发布始终是后续独立授权动作。
