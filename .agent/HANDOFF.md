# Geek Agent Handoff

Updated: 2026-08-28

## 当前目标

继续收口 Draft PR #166 `feat: make broadcast runtime account-scoped`。正式 `master` / Geek 1.2.16 继续作为稳定参照。最新 master 已以普通双父 merge 合回候选分支，最后一轮 P0/P1 代码审计未发现新的已证实阻塞根因；隔离 Windows validation 构建链也已接通并验证只导出验证版 EXE。下一真实 gate 是 exact final HEAD 的真实 WA/TG/LINE 客户端回归，因此 #166 继续保持 Draft。

## 实时仓库状态

- 默认分支：`master`
- 当前 master：`cf0dd175f6ef8fa0b080231a77ab46f3b31d36bc`
- `package.json.version`：`1.2.16`
- `.github/release-client-version`：`1.2.16`
- 活跃集成分支：`ux/broadcast-account-jobs`
- master 同步 merge commit：`f32d2e46150839b5dccdb47623c48171276966df`
- validation workflow sanitization commit：`ae097581bcb107cad51fb5d3fc1727cfa8da6daa`
- master 同步后 compare：`behind=0`；merge base 为当前 master `cf0dd175...`
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
| P1 | done | 合入最新 master 并核 #166 当前合并树 | `f32d2e4...` 普通双父 merge；behind=0 |
| P1 | done | 最后一轮 P0/P1 代码审计 | active caller、Broadcast owner/runtime、定时恢复、附件 live guest、WebView/account partition 启动顺序均已追到真实接线；未发现新的已证实阻塞根因 |
| P1 | done | 建立隔离 Windows validation 构建链 | `validation-client-build` 仅构建 `electron-builder.validation.yml`，`--publish never`；本地 updater metadata/blockmap 在上传前强制清理，只上传唯一验证 EXE |
| P1 | in_progress | exact final HEAD validation artifact | 本 HANDOFF 提交也在 validation workflow path filter 中；提交后必须以新的最终 HEAD 自动构建结果为准 |
| P1 | blocked | WA/TG/LINE 真实客户端回归 | 需要安装 exact final HEAD 的 `极客 验证版` 后执行真实 UI/账号/发送/恢复 gate；尚未执行 |
| P1 | planned | #166 Ready / merge | final HEAD CI + validation build + 真实客户端 gate 通过后再转 Ready/merge |
| P1 | planned | 正式客户端发布 | 独立人工授权动作；本轮禁止 |
| P2 | open | #230 自定义 website 账号类型入口不可达 | APP_TYPES 缺失 website，accounts:add 会静默回退 WhatsApp；不阻塞当前 WA/TG/LINE #166 gate，后续独立处理 |

## 当前 CI / 构建 / 生产验证

- #166 master 同步 merge HEAD `f32d2e46150839b5dccdb47623c48171276966df`：Linux `test` run `33211237700` completed/success；Windows `acl-windows` run `33211237744` completed/success。
- HANDOFF refresh HEAD `af7479d4ac17149f8b576ffb9d8c12e3dfccce67`：Linux `test` run `33211475959` success；Windows `acl-windows` run `33211476015` success。
- validation workflow 初版 HEAD `1dc6719b2f14a05c5877adb39bab1bfd27686b05`：Linux `test` run `33211564207` success；Windows `acl-windows` run `33211564202` success；validation run `33211560436` 中 `npm run dist:test` 成功产出 `geek-validation-setup-1.2.16.exe`，但初版 artifact boundary 因 electron-builder 本地生成 `latest.yml` 而 fail closed，未上传 artifact。该失败属于验证自动化边界，不是产品打包失败。
- validation sanitization HEAD `ae097581bcb107cad51fb5d3fc1727cfa8da6daa`：Linux `test` run `33211860375` success；Windows `acl-windows` run `33211860369` success（含 `Run real Windows ACL integration` success）；`validation-client-build` run `33211856283` completed/success，build / sanitize / upload 均 success。
- run `33211856283` artifact：`geek-validation-ae097581bcb107cad51fb5d3fc1727cfa8da6daa`，artifact id `9701961625`，SHA-256 digest `319b80edf1eac378d7ed93a6ebc84dce8f93d2ebaa2923ea1fa2fcc10984df9d`。下载 ZIP 实际检查仅包含 `geek-validation-setup-1.2.16.exe` 一个文件，无 `latest.yml`、blockmap 或其他发布产物。
- validation workflow 的 `.agent/HANDOFF.md` 已纳入 push path filter，因此本文件提交后会自动为新的 exact final HEAD 再构建一次；后续证据必须使用该新 HEAD，不复用 `ae09758...` artifact 作为 final HEAD。
- #217 PR 最终 `test` run `33208881151` success；master `06ae000adc5493ac7685a5a31b5e2beac9ab4aba` 的 `deploy-subscription` run `33208942235` completed/success，Wrangler deploy、HTTP 200、production account smoke 均成功。
- #222 PR 最终 `test` run `33209358830` success。其合 master 后未自动部署，暴露 #228 path-filter 缺口。
- #228/#229 PR `test` run `33209583847` success；合 master 后由 `push` 自动触发 `deploy-subscription` run `33209640872` completed/success，Wrangler deploy、HTTP 200、production account smoke 均成功；#23 同 run 注册/登录/鉴权/清理 OK。因此 #222 也已实际进入生产 Worker。
- 本轮没有本地运行 Geek / `npm test`；上述客户端测试/构建均为 GitHub-hosted CI/Windows builder，不等于真实 Geek GUI 客户端回归。
- 尚未对当前最终候选进行真实 Electron / WhatsApp / Telegram / LINE 登录、收发、附件、定时、重启恢复、多账号并发与账号删除回归。
- 本轮生产变更仅为 subscription Worker 的既有自动部署；没有正式 Windows 客户端发布。

## 最后一轮 P0/P1 审计结论

- Broadcast 新 runtime 以 capture-phase 接管 `#broadcast-send` 并 `stopImmediatePropagation()`，旧 window-global sender 不再决定 Job 归属。
- Job 执行通过 `contextForAccount(job.accountId)` 重新解析固定 owner；附件发送使用 live WebView guest id，不使用持久化 stale guest id。
- 定时任务在同账号 collision、due recovery、queued drain 上均复用 bounded schedule persistence recovery；terminal cleanup 只 drain 同账号。
- WebView account navigation boundary 在 legacy main 之前注册；`session-partition-compat` 于 `app.whenReady()` 安装 partition getter 成功后才加载 `main.cjs`，兼容层失败直接退出，因此当前 Electron 的 Session.partition 缺失不会让 boundary 静默失效。
- 发现 #230：website/customUrl 主进程/UI 死分支未真正接通，属于独立 P2 能力缺口，不属于当前 WA/TG/LINE #166 阻塞项。

## 关键安全/产品边界

- WebView 继续保持 `sandbox=true`、`nodeIntegration=false`、`nodeIntegrationInSubFrames=false`、`webSecurity=true`。
- WA/TG 保持 `contextIsolation=true`；LINE 当前局部 `contextIsolation=false` 兼容例外不扩散，也不在无真实认证回归时删除。
- Broadcast Job 继续固定 account / partition / platform / WebView owner；切换当前查看账号不能重定向 Job。
- Broadcast 继续复用 `GeekPlatformTransports` 与 `GeekBroadcastSafety.authorizeSend`；renderer 只持 opaque attachment token/ref，不获得 canonical path。
- validation build 使用独立 appId / productName / runtime profile，不共享生产 userData；`npm run dist:test` 固定 `--publish never`；workflow 只上传验证版 EXE，不导出 updater metadata/blockmap。
- 忘记密码防枚举、reset token SHA-256/TTL/one-use、`token_version` 会话撤销、Free Worker v4 HMAC 边界保持。
- 生产 auth/reset 与 admin login 并发门禁已改为单语句 D1/SQLite 原子状态转移；不得重新引入 check-then-write 竞争。
- 普通维护不修改 `package.json.version` / `.github/release-client-version`；不上传正式 R2 客户端、不改生产 updater metadata、不建正式 tag/release。

## 下一真实目标

1. 本 HANDOFF commit 后不再修改 #166 分支；等待并核对这个 exact final HEAD 的 Linux `test`、Windows `acl-windows` 与 `validation-client-build` 三项结果。
2. 核 final validation artifact ZIP 仍只有一个 `geek-validation-setup-1.2.16.exe`，记录 artifact id/digest；该 artifact 才是后续真实客户端回归的唯一候选。
3. 从同一 exact final HEAD 的 `极客 验证版` 做真实客户端 WA / Telegram / LINE 回归：登录认证、文本、附件、群发/定时、多账号切换、暂停/继续/停止、重启恢复、账号删除及失败恢复。
4. 真实客户端通过前 #166 保持 Draft；通过后才转 Ready/merge。正式 Windows 客户端发布仍需独立人工授权。
