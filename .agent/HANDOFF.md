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
- 当前代码 HEAD（本 HANDOFF 更新前）：`4f7d55475235127ef9f3c2cbdd6ca84e7750dd4e`
- PR：#166，Draft
- 未 force push、未历史重写、未修改正式 release marker。

## Task Queue

| 优先级 | 状态 | 任务 | 证据/下一条件 |
|---|---|---|---|
| P0 | done | validation/dev profile 与正式 1.2.16 隔离 | #187/#190 |
| P0 | done | Electron 单实例保护 | #189/#197 |
| P0 | done | broadcast timer / migration / persistence / scheduled attachment / account deletion 根因组 | #191-#209 相关 PR 已进入 #166 |
| P1 | done | 长时附件 token 滑动租约 | #210/#211 |
| P0 | done | 禁止未绑定 partition 的 legacy external CDP 群发路径 | #213/#214/#215 |
| P1 | done | current Electron `Session.partition` 兼容恢复 | #216/#218 |
| P1 | done | opaque token 显式 release 生命周期 | #212/#219，merged into #166 |
| P1 | done | committed account delete cleanup error 不再留下 stale renderer | #220/#221，merged into #166 |
| P0 | done_code_ci | post-attach WebView 导航固定到真实 account/partition | #223/#224；合并树 Linux+Windows CI 通过，真实 WA/TG/LINE 兼容回归仍未做 |
| P1 | in_progress | D1 普通认证/重置限流原子化 | #217；`fix/217-atomic-rate-limit` 基于 master。当前 connector 无安全局部 patch 能力，禁止整份重写巨大 core；需采用可审计的最小修改方式后再 PR |
| P1 | planned | 管理后台登录锁原子化 | #222；与 #217 不同状态机，单独 Issue/分支/PR |
| P1 | blocked | 最终候选真实 Windows Electron / WA / TG / LINE 回归 | 必须等主要 P0/P1 收口，从 #166 同一最终 HEAD 构建独立 validation 包 |
| P1 | planned | #166 Ready / merge | 当前 HEAD CI + 真实客户端 gate 均满足后 |
| P1 | planned | 正式客户端发布 | 独立授权动作，本轮禁止 |

## 最近完成

1. #212/#219：为 broadcast selected-file capability 增加 owner-bound、幂等显式 release；草稿丢弃、Job terminal、scheduled materialize/account cleanup 都接入回收，未扩大 registry 上限，也未暴露真实路径。#166 合并树 `5f083b...` Linux `33186501315`、Windows `33186501316` success。
2. #220/#221：账号后端删除已提交但 session 清理失败时，account-data boundary 会重新读取权威状态；确认账号已不存在则 finalize tombstone 并向 renderer 返回删除成功 + cleanupPending，避免 UI 保留幽灵账号。PR test `33186824308` success；进入 #166 后 `979fe001...` Linux `33187045948`、Windows `33187045942` success。
3. #223/#224：修复 post-attach WebView 全局 allowlist。新 boundary 不再从首个 URL 猜 owner，而是 `partition -> accounts.json account record -> fixed policy`；account 缺失/损坏/partition mismatch fail closed。WA/TG/LINE/website popup、will-navigate、will-redirect 共用同一 account-scoped policy，legacy global handler 只能继续收紧。PR head `2b1ec230...` test run `33194291263` success；merged into #166 as `4f7d55475235127ef9f3c2cbdd6ca84e7750dd4e`；post-merge Linux `33194338371`、Windows `33194338373` success。

## 当前账户 Worker 审计

- #217：`scripts/geek-subscription-entry.js` 与 `scripts/geek-subscription-worker-core.js` 的普通 `rateLimited()` 都是多语句 delete/select/insert/update，存在并发穿透。目标仍是单语句 SQLite/D1 原子状态转移，并让生产 entry/core 不再漂移。
- #222：`adminLoginBlocked()` 与失败后的 `adminLoginFail()` 分离，5 次失败 / 15 分钟锁只对串行请求可靠；需独立原子状态机。
- 修改账户 Worker 前后必须保持：忘记密码统一响应、reset token 仅存 SHA-256/30 分钟/单次使用、修改密码递增 token_version、Workers Free v4 HMAC 热路径、不引入 PBKDF2/Argon2/bcrypt。
- 任何 #217/#222 master merge 若命中 `deploy-subscription`，生产状态只能以对应 Actions + Issue #21/#23 为证据。

## 当前 CI / 验证

- #166 current code tree `4f7d554...`：Linux `test` run `33194338371` success；Windows `acl-windows` run `33194338373` success。
- 本轮没有本地 checkout / npm test；当前环境无法通过 git clone DNS 访问仓库，因此实际测试证据均来自 GitHub-hosted CI。
- 尚未进行当前最终候选真实 Electron / WA / TG / LINE 登录、收发、附件、定时、重启恢复、多账号并发、账号删除与 WebView 导航兼容回归。
- 本轮没有 Cloudflare 生产部署。
- 本轮没有正式客户端发布。

## 安全/发布边界

- `sandbox=true`、`nodeIntegration=false`、`nodeIntegrationInSubFrames=false`、`webSecurity=true` 不得降低。
- WA/TG 保持 `contextIsolation=true`；LINE 当前局部 `contextIsolation=false` 兼容例外不扩散，也不在无真实认证回归时删除。
- Broadcast 继续复用 `GeekPlatformTransports` 与 `GeekBroadcastSafety.authorizeSend`；renderer 只拿 opaque token/ref，不拿 canonical path。
- 普通维护不修改 `package.json.version` / `.github/release-client-version`。
- 不上传正式 R2 安装包、不改 updater 元数据、不建正式 tag/release、不触发正式发布。

## 已否决产物

`ux/broadcast-product-polish` 及其衍生 PR/测试安装包继续视为真实客户端否决证据，不得恢复、cherry-pick 或重新提供。

## 下一真实目标

1. 用可审计的最小修改方式完成 #217 单语句原子 rate limit，并跑独立 master PR CI；如果 merge 触发生产部署，核真实 `deploy-subscription` run 与 #21/#23。
2. 独立处理 #222 admin login lock 原子状态机并重复同样 CI/生产证据流程。
3. 继续最后一轮 P0/P1 审计；无新高优先级根因后，以 #166 同一最终 HEAD 构建隔离 Windows validation 安装包。
4. 真实客户端执行 WA/TG/LINE 登录、收发、附件、群发、scheduled/restart、多账号、账号删除与 WebView 导航回归。通过前 #166 保持 Draft。
