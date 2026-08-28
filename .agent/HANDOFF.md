# Geek Agent Handoff

Updated: 2026-08-28

## 当前目标

继续收口 Draft PR #166 `feat: make broadcast runtime account-scoped`。正式 `master` / Geek 1.2.16 继续作为稳定参照。当前阶段仍是全库审计 + P0/P1 根因修复；真实 Windows/WA/TG/LINE 验证包只在主要根因收口后从同一最终 HEAD 构建。

## 实时仓库状态

- 默认分支：`master`
- `master` HEAD：`b6e7a89d33f0f6504e9ba3bad6b5fa9960b0568b`
- `package.json.version`：`1.2.16`
- `.github/release-client-version`：`1.2.16`
- 活跃集成分支：`ux/broadcast-account-jobs`
- 本次更新前代码 HEAD：`7671583bc62b4619f2b306fb0d11c8885f1a53f7`
- PR：#166，Draft
- 未 force push、未历史重写、未修改正式 release marker。

## Task Queue

| 优先级 | 状态 | 任务 | 证据/下一条件 |
|---|---|---|---|
| P0 | done | validation/dev profile 与正式 1.2.16 隔离 | #187/#190，master 已包含独立 validation identity/userData |
| P0 | done | Electron 单实例保护 | #189/#197，master 已包含 |
| P0 | done | 长延迟 timer 分段 re-arm | #191/#193 |
| P0 | done | legacy schedule 迁移 fail-closed | #192/#194 |
| P0 | done | broadcast persistence keys 接入真实 account store | #195/#196 |
| P0 | done | restored TG/LINE 附件绑定 live guest | #198/#199 |
| P0 | done | scheduled attachment durable mutation 事务串行 | #200/#201 |
| P0 | done | scheduled Job durable create/de-arm/cancel gate | #202/#203 |
| P0 | done | 删除账号前停止该账号 Jobs + 清 durable refs | #204/#207 |
| P0 | done | schedule persistence 未 ready 时创建假定时任务 | #208/#209 |
| P1 | done | 长时附件 token 固定 6h 过期 | #210/#211；成功 owner+完整性校验后滑动续租，闲置/错 owner 仍失效 |
| P0 | done | 未绑定 partition 的 legacy external CDP 可选错账号 | #213/#214/#215；broadcast 永不走 first-platform-target 外部 CDP，宁可失败 |
| P1 | done | legacy `Session.partition` 依赖导致 guest/account bookkeeping 失效 | #216/#218；从文档化 Session storage path 恢复账号 partition，启动 fail-closed |
| P1 | planned | opaque token 缺少显式 release 可耗尽 registry | #212；需 owner-bound/idempotent release + runtime 生命周期接入，不通过扩大上限规避 |
| P1 | in_progress | D1 认证/密码重置限流非原子 | #217；独立 `fix/217-atomic-rate-limit` 基于 master，目标为单语句原子计数且 entry/core 共用实现 |
| P1 | blocked | 最终候选真实 Windows Electron / WA / TG / LINE 回归 | 必须在最终 HEAD、独立 validation profile 上执行 |
| P1 | planned | #166 Ready / merge | 主要 P0/P1 收口 + 当前 HEAD CI + 真实客户端 gate |
| P1 | planned | 正式客户端发布 | 独立授权动作，本轮禁止 |

## 本轮关键审计结论

1. #209 已把 future-schedule readiness gate 前移到任何附件持久化/Job register 之前；registry 继续第二道 fail-closed。
2. #211 把 6 小时 token TTL 改为活跃使用滑动租约，不取消 opaque token、owner 或完整性校验。
3. #213 发现 `127.0.0.1:9344` legacy external CDP 只按平台找第一个 WebView，缺账号 partition 绑定；#215 已彻底禁止 broadcast 使用该路径，包括显式 debug 启动。
4. #216 发现 current Electron 文档化 Session API 没有 `partition`，而 legacy main 有关键读取；#218 安装窄兼容 getter，基于 `storagePath/getStoragePath()` 只恢复 `persist:webview-page-*`，无法安全安装则不启动 legacy main。
5. #218 首轮 CI 失败不是新模块 contract：`session-partition-compat-contract` 已通过，旧 `single-instance-contract` 把同步 `require('./main.cjs');` 语法硬编码为安全性质；更新为验证 main bootstrap 仍处于 primary-instance/account-boundary 之后后，最终 CI 通过。
6. #212 仍未修：registry 只有 TTL prune、没有完整显式 release 生命周期，合法频繁选择/多 Job 可累积占槽。
7. #217 仍未修：生产 entry/core 的 `rateLimited()` 使用多语句 SELECT→INSERT/UPDATE，并发请求可读同一旧 count；必须用单语句原子 D1/SQLite 方案，并保持 Free Worker v4 HMAC、防枚举/reset token/token_version 语义不变。

## 当前 CI / 验证

- #209 head `7a239cbe140fbe38e7c7eb3e21a5e64cba1bb880`：`test` run `33181506563` success。
- #211 head `e818d3eddb8e958a954b999c42dee5320fe76b25`：`test` run `33182008232` success。
- #214 head `b6d14eb53686a307bc918a0c8230632412c7bbb4`：`test` run `33182538313` success。
- #215 head `17f59c0c259bfbce9d5af1049c925d236268889c`：`test` run `33182772975` success；merged tree entered #166 as `28819dbf89acb5cd65a7fc462b510ba7d3ceae01`。
- #218 first run `33183526616` failed only at stale `single-instance-contract`; new session partition contract passed in that run。
- #218 final head `6cca3192779b8b5ae012c7c4e61d1f8cf340f734`：`test` run `33185084325` success；merged into #166 as `7671583bc62b4619f2b306fb0d11c8885f1a53f7`。
- 本轮没有本地运行 Geek / npm test；以上均为 GitHub-hosted CI 实际结果。
- 尚未进行当前最终候选真实 Electron / WA / TG / LINE 登录、收发、附件、定时、重启恢复、多账号并发与账号删除回归。
- 没有 Cloudflare 生产部署。
- 没有正式客户端发布。

## 安全/发布边界

- `sandbox=true`、`nodeIntegration=false`、`nodeIntegrationInSubFrames=false`、`webSecurity=true` 不得降低。
- WA/TG 保持 `contextIsolation=true`；LINE 当前局部 `contextIsolation=false` 兼容例外不扩散，也不在无真实认证回归时删除。
- Broadcast 继续复用 `GeekPlatformTransports` 与 `GeekBroadcastSafety.authorizeSend`。
- Renderer 不获得 canonical attachment path；opaque token/ref + owner 校验保持。
- 普通维护不修改 `package.json.version` / `.github/release-client-version`。
- 不上传正式 R2 安装包、不改 updater 元数据、不建正式 tag/release、不触发正式发布。

## 已否决产物

`ux/broadcast-product-polish` 及其衍生 PR/测试安装包继续视为真实客户端否决证据，不得恢复、cherry-pick 或重新提供。

## 下一真实目标

1. 完成 #217 原子限流的独立 master PR 并核最终 CI；若合并触发生产部署，必须读真实 deploy-subscription run 与 #21/#23 后才能描述生产状态。
2. 回到 #166 处理 #212 token release 生命周期，并继续审 IPC/持久化/支付/退出恢复是否还有确定性 P0/P1。
3. 每次合入 #166 后重新核 current HEAD CI、与 master 关系、版本/release marker 与安全边界。
4. 主要根因收口后，从同一最终 HEAD 构建独立 `极客 验证版` Windows 安装包交真实客户端回归；真实客户端通过前 #166 保持 Draft。
