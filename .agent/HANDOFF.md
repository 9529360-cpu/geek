# Geek Agent Handoff

Updated: 2026-08-28

## 当前目标

继续收口 Draft PR #166 `feat: make broadcast runtime account-scoped`，把正式 1.2.16 当稳定参照。当前阶段是全库审计 + P0/P1 根因修复，不提供旧否决测试包，不把 CI 绿灯等同于真实客户端通过。

## 实时仓库状态

- 默认分支：`master`
- `master` HEAD：`b6e7a89d33f0f6504e9ba3bad6b5fa9960b0568b`
- `package.json.version`：`1.2.16`
- `.github/release-client-version`：`1.2.16`
- 活跃集成分支：`ux/broadcast-account-jobs`
- 当前 HEAD：`1bc86653d1d254f59091bc379f6ff28f092b892f`
- PR：#166，Draft
- 当前 #166 已包含 master 当前基线以及 #193/#194/#196/#199/#201/#203/#207/#209 等审计修复；未 force push、未历史重写。

## Task Queue

| 优先级 | 状态 | 任务 | 证据/下一条件 |
|---|---|---|---|
| P0 | done | 验证/开发 profile 与正式 1.2.16 隔离 | #187 / #190；master 已包含 `geek-dev` / `geek-validation`、独立 validation appId/productName、无正式 updater publisher |
| P0 | done | Electron 单实例保护 | #189 / #197；同 profile 不允许第二进程继续初始化 |
| P0 | done | 远期定时 timer 溢出 | #191 / #193；长延迟分段 re-arm |
| P0 | done | legacy schedule 迁移 fail-closed | #192 / #194；先禁旧执行再发布新任务，避免新旧双活 |
| P0 | done | 新群发持久化 key 接入真实加密 account store | #195 / #196；不再只在 mock 层通过 |
| P0 | done | 重启恢复 TG/LINE 附件重新绑定 live WebView guest | #198 / #199 |
| P0 | done | scheduled attachment durable store 并发事务化 | #200 / #201；mutation/snapshot/write/rollback 串行 |
| P0 | done | scheduled Job 创建/到期/取消 durable 生命周期门禁 | #202 / #203；创建先确认 durable，到期先 durable de-arm 再 `starting`，pending cancel 先 de-arm 再 terminal |
| P0 | done | 删除账号前停止/取消该账号 Broadcast Jobs 并清 durable refs | #204 / #207；renderer capture barrier 先停 A jobs，再 backend delete；失败不拆 UI；main 删除 hook 清 account-scoped scheduled refs |
| P0 | done | runtime 先于 schedule persistence 加载导致未持久化定时 Job | #208 / #209；静态 capture gate 在任何 runtime mutation 前阻止 future schedule，registry 另有第二道 fail-closed gate |
| P1 | planned | 长时群发附件 token 固定 6h 过期 | #210；确认 file registry 固定 TTL，而 executor 可长时串行/暂停。修复必须保留 opaque token、owner 校验和闲置过期边界 |
| P1 | blocked | 当前最终候选真实 Windows Electron / WA / TG / LINE 回归 | 必须在最终 HEAD、独立 validation profile 上重新登录并验证 |
| P1 | planned | #166 Ready / merge | 全库审计主要根因收口 + 当前 HEAD CI + 真实客户端 gate |
| P1 | planned | 正式客户端发布 | 独立授权动作，本轮禁止 |

## 本轮关键审计结论

1. 历史 validation 安装包曾与生产 Geek 1.2.16 共用 Chromium/userData 身份；现已在 master 修复并同步进 #166。
2. 原仓库缺单实例锁；现已修复并同步进 #166。
3. #166 新 schedule/migration keys 一度未进入真实 account-data 写入 allowlist，真实 IPC/store 链会直接拒绝；已修复。
4. 超过约 24.8 天的定时任务原来直接交给单次 `setTimeout`，存在提前触发风险；已修复。
5. legacy schedule 迁移原顺序存在崩溃后新旧双执行窗口；已改为 fail-closed。
6. restored TG/LINE scheduled attachments 原来继续读取 process-local `job.guestId`；已改为运行时绑定当前固定账号 WebView。
7. scheduled attachment store 原来只排队磁盘 write，不排队 Map mutation/rollback；多账号并发失败可造成内存/磁盘分叉；已修复。
8. scheduled Job 原来创建、到期发送、取消都依赖 fire-and-forget 持久化，存在 crash/restart 自动重放或取消后复活风险；#203 已把三条路径收进 awaited durable gate。
9. 账号删除入口原来先拆 WebView/UI，再触发 backend remove；#207 现把 Broadcast stop/cancel 与 durable cleanup 放到删除前，失败 fail-closed。
10. runtime 原来在 schedule persistence subscriber 安装前就可接收 future-schedule 点击；#209 现由静态 capture gate 在附件 persist / Job register 前阻止，registry 继续作为二次防线。
11. 新发现 #210：selected-file opaque token 默认固定 6 小时到期，长时执行或长暂停后后续附件可能失败。安全边界未破坏，尚未修复。

## 当前 CI / 验证

- #203 最终 head `d1e4376687d7bc0413aa25c8da14ce99b77a4e8f`：GitHub `test` run `33177001707` completed/success。
- #206 最终 head `3e0adeccd38361a2c3bfd1f95df07a5d153fbaaa`：GitHub `test` run `33177453724` completed/success。
- #207 最终 head `68d47b020168dca658d2c3247093fbcfada56b88`：GitHub `test` run `33178509941` completed/success；此前 run `33178384181` 因旧 contract 仍断言 3 个 boundary handlers 而失败，修正 contract 后通过。
- #209 最终 head `7a239cbe140fbe38e7c7eb3e21a5e64cba1bb880`：GitHub `test` run `33181506563` completed/success。
- 当前 #166 HEAD `1bc86653d1d254f59091bc379f6ff28f092b892f`：
  - Linux `test` run `33181615039` completed/success。
  - Windows `acl-windows` run `33181615022` completed/success。
- 本轮没有本地运行 Geek / npm test；以上是 GitHub 托管 CI 实际结果。
- 尚未进行当前最终 HEAD 的真实 Electron / WA / TG / LINE 登录、收发、附件、定时、重启恢复、多账号并发回归。
- 没有 Cloudflare 生产部署。
- 没有正式客户端发布。

## 安全/发布边界

- `sandbox=true`、`nodeIntegration=false`、`nodeIntegrationInSubFrames=false`、`webSecurity=true` 不得降低。
- WA/TG 保持 `contextIsolation=true`；LINE 现有局部兼容例外不扩散、不在无真实回归时删除。
- 继续复用 `GeekPlatformTransports` 与 `GeekBroadcastSafety.authorizeSend`。
- renderer 不获得 canonical attachment path；opaque token/ref + owner 校验保持。
- 不修改 `package.json.version` / `.github/release-client-version`。
- 不上传正式 R2 安装包、不改 updater 元数据、不建正式 tag/release、不触发正式发布。

## 已否决产物

`ux/broadcast-product-polish` 及其衍生 PR/测试安装包继续视为真实客户端否决证据，不得恢复、cherry-pick、重新提供。

## 下一真实目标

1. 继续全库审计当前 #166，优先处理 #210 以及新的确定性 P0/P1 根因；一个根因一个 Issue/branch/PR/CI。
2. 每次合入后重新检查 #166 当前 HEAD、Linux/Windows CI、与 master 的关系、版本/release marker 和安全边界。
3. 全库主要根因收口后，从同一最终 HEAD 构建独立 `极客 验证版` Windows 安装包，再交给真实客户端回归。
4. 真实客户端通过前保持 #166 Draft；正式发布仍需单独授权。
