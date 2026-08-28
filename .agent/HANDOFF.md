# Geek Agent Handoff

Updated: 2026-08-28

## 当前目标

继续收口 Draft PR #166 `feat: make broadcast runtime account-scoped`。正式 `master` / Geek 1.2.16 继续作为稳定参照。当前主要 P0/P1 根因已基本收口，正在把最新 master 合回候选分支并做最后一轮 P0/P1 审计；候选仍会变化，因此暂不构建 Windows 验证安装包。

## 实时仓库状态

- 默认分支：`master`
- 本次同步目标 master：`cf0dd175f6ef8fa0b080231a77ab46f3b31d36bc`（更新分支前必须再次实时核对）
- `package.json.version`：`1.2.16`
- `.github/release-client-version`：`1.2.16`
- 活跃集成分支：`ux/broadcast-account-jobs`
- 本次同步前 #166 HEAD：`02f2c6d89b3d4c7f33d1f1fa134164d3d266cf3b`
- PR：#166，Draft
- 未 force push、未历史重写、未触发正式客户端发布。

## Task Queue

| 优先级 | 状态 | 任务 | 证据/下一条件 |
|---|---|---|---|
| P0 | done | #223 WebView attach 后导航绑定具体 account/partition | #224 已合入 #166；代码/CI 已验证，真实 WA/TG/LINE 兼容性留最终客户端回归 |
| P1 | done | #212 opaque attachment token 显式释放生命周期 | 已合入 #166；owner-bound/idempotent release + runtime/terminal cleanup |
| P1 | done | #217 普通认证/重置 D1 限流原子化 | #226 已合 master；`deploy-subscription` run `33208942235` + #21/#23 生产验证成功 |
| P1 | done | #222 管理后台登录锁并发硬门禁 | #227 已合 master；生产最终随 #228 修复后的自动部署进入线上 |
| P1 | done | #228 subscription 自动部署覆盖真实原子认证入口依赖 | #229 已合 master；push 自动触发 `deploy-subscription` run `33209640872`，#21/#23 成功 |
| P1 | in_progress | 合入最新 master 并核 #166 当前合并树 | 普通双父 merge；behind=0 后跑当前 HEAD Linux/Windows CI |
| P1 | planned | 最后一轮 P0/P1 全库审计 | 重点检查真实 active caller、WebView/account runtime、恢复/错误路径，确认候选不再移动 |
| P1 | blocked | 最终 Windows validation + WA/TG/LINE 回归 | 仅从停止变化的 exact final #166 HEAD 构建独立 validation profile |
| P1 | planned | #166 Ready / merge | 主要 P0/P1 收口 + 当前 HEAD CI + 真实客户端 gate |
| P1 | planned | 正式客户端发布 | 独立人工授权动作；本轮禁止 |

## 当前 CI / 生产验证

- #166 `02f2c6d89b3d4c7f33d1f1fa134164d3d266cf3b`：Linux `test` run `33194463159` success；Windows `acl-windows` run `33194463186` success。
- #217 PR 最终 `test` run `33208881151` success；master `06ae000adc5493ac7685a5a31b5e2beac9ab4aba` 的 `deploy-subscription` run `33208942235` completed/success，Wrangler deploy、HTTP 200、production account smoke 均成功。
- #222 PR 最终 `test` run `33209358830` success。其合 master 后未自动部署，暴露 #228 path-filter 缺口。
- #228/#229 PR `test` run `33209583847` success；合 master 后由 `push` 自动触发 `deploy-subscription` run `33209640872` completed/success，Wrangler deploy、HTTP 200、production account smoke 均成功；#23 同 run 注册/登录/鉴权/清理 OK。因此 #222 也已实际进入生产 Worker。
- 本轮没有本地运行 Geek / `npm test`；以上测试均为 GitHub-hosted CI。
- 尚未对当前最终候选进行真实 Electron / WhatsApp / Telegram / LINE 登录、收发、附件、定时、重启恢复、多账号并发与账号删除回归。
- 本轮生产变更仅为 subscription Worker 的既有自动部署；没有正式 Windows 客户端发布。

## 关键安全/产品边界

- WebView 继续保持 `sandbox=true`、`nodeIntegration=false`、`nodeIntegrationInSubFrames=false`、`webSecurity=true`。
- WA/TG 保持 `contextIsolation=true`；LINE 当前局部 `contextIsolation=false` 兼容例外不扩散，也不在无真实认证回归时删除。
- Broadcast Job 继续固定 account / partition / platform / WebView owner；切换当前查看账号不能重定向 Job。
- Broadcast 继续复用 `GeekPlatformTransports` 与 `GeekBroadcastSafety.authorizeSend`；renderer 只持 opaque attachment token/ref，不获得 canonical path。
- 忘记密码防枚举、reset token SHA-256/TTL/one-use、`token_version` 会话撤销、Free Worker v4 HMAC 边界保持。
- 生产 auth/reset 与 admin login 并发门禁已改为单语句 D1/SQLite 原子状态转移；不得重新引入 check-then-write 竞争。
- 普通维护不修改 `package.json.version` / `.github/release-client-version`；不上传正式 R2 客户端、不改 updater metadata、不建正式 tag/release。

## 下一真实目标

1. 完成当前 master → #166 普通双父 merge；确认 #166 对 master `behind=0`，再核合并 HEAD 的 Linux `test` 与 Windows `acl-windows`。
2. 做最后一轮 P0/P1 审计，优先查“代码存在但 active caller 没接”“测试绿但 runtime 语义仍漂移”“新增安全边界造成真实兼容性断裂”等半成品。
3. 只有在主要根因停止变化后，才从同一 exact #166 final HEAD 构建独立 `极客 验证版` Windows 安装包。
4. 真实客户端回归 WA / Telegram / LINE：登录认证、文本、附件、群发/定时、多账号切换、重启恢复、账号删除及失败恢复。真实客户端通过前 #166 保持 Draft。
