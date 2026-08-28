# Geek Agent Handoff

Updated: 2026-08-29

## 当前目标

继续收口 Draft PR #166 `feat: make broadcast runtime account-scoped`。当前代码层已经从“账号级群发执行器”推进到“群发产品闭环”：联系人初始化 readiness、四段式编辑流程、收件人名单/群组集合语义、账号级任务中心、scheduled/queued 任务路径和翻译缓存回显修复均已进入候选分支。下一真实 gate 仍是 exact HEAD 的 Windows validation 客户端回归；真实客户端通过前不得把 #166 标记为完成。

## 实时仓库状态

- `master`: `c7d7290bf3e45cf2e8782bf83d5870bfd5f23157`
- `ux/broadcast-account-jobs`: 本 HANDOFF 提交前 `6ed641f6ac0a892e65777775938be133abe90d1e`
- PR #166: Draft
- `package.json.version`: `1.2.16`
- `.github/release-client-version`: `1.2.16`
- 未 force push、未历史重写、未触发正式 `release-client`。

## 当前最高优先级

| 优先级 | 状态 | 任务 | 当前证据 / 下一条件 |
|---|---|---|---|
| P1 | code_done | #231 群发编辑器产品闭环 | #232 已合入 #166。WA 入口等待 WPP chat-list ready；四步 Workbench：内容→对象→设置→检查；任务中心复用 `GeekBroadcastJobs`；旧多消息 scheduler UI 已退役。 |
| P1 | code_done | 联系人/群组保存语义 | 主入口明确为“保存收件人名单”（联系人+群组）；“保存群组集合”仅用于群组筛选，避免联系人选择后点群组标签保存失败。 |
| P1 | code_done | 定时任务主路径 | 不再扩展旧 `scheduleTasks + setTimeout + 改写编辑器` 半成品；产品入口统一到 #166 的 account-scoped `scheduled/queued BroadcastJob`、fixed targets、durable attachment ref、restart restore/cancel/recovery。 |
| P1 | code_done | #233 WhatsApp 翻译缓存切换聊天后回显 | #234 已合 master；新增独立 `translation-whatsapp-rehydrate.js`，A→B→A chat identity 变化时调用现有 `__geekRefreshTranslationView()`，继续命中主进程 partition 级 safeStorage 加密缓存；无 renderer 明文缓存、无新翻译 transport、无常驻 polling。随后 master 通过 #235 普通 merge 合回 #166。 |
| P1 | in_progress | exact HEAD CI + validation artifact | 本 HANDOFF 会产生新的 exact HEAD 并触发 test/acl-windows/validation-client-build；必须核最终 HEAD 三项结果与唯一 EXE artifact。 |
| P1 | blocked | WA/TG/LINE 真实客户端回归 | 需要新 exact validation installer：WA 联系人首次加载、收件人名单保存、立即/定时、scheduled/queued/cancel、A/B/C 并发、暂停/继续/停止、附件、重启恢复；翻译重点验证联系人 A→B→A 译文自动回显。 |
| P1 | planned | #166 Ready / merge | 仅在真实客户端 gate 通过后。 |
| P1 | planned | 正式客户端发布 | 独立人工授权动作；当前禁止。 |
| P2 | open | #230 website 账号入口不可达 | 独立处理，不阻塞当前 WA/TG/LINE gate。 |

## 最近实际验证

### 群发 Workbench

- PR #232 `feat: complete broadcast workbench flow` 已合入 #166。
- #232 最终 head `af987b8781114fb9c4e1aac832021f9b99364dce` 的 Linux `test` 已成功。
- 合入后的 #166 head `3ede82e281d696eba6646ba009643b4fefff0345`：
  - Linux `test` run `33217446527`: success。
  - Windows `acl-windows` run `33217446610`: success。
  - `validation-client-build` run `33217443826`: success。
  - artifact id `9703943172`, name `geek-validation-3ede82e281d696eba6646ba009643b4fefff0345`, ZIP digest `sha256:df5d06ff0388d49c5179b4fc0bedec9a08c57dce325237320cead20a0c1053a1`。
- 上述 artifact 在 master translation fix 合回及本 HANDOFF 更新后已不是 final exact candidate，只保留为阶段证据。

### 翻译回显

- Issue #233：真实用户现象为同账号联系人 A 已显示译文，切到 B 再回 A，旧译文不回显。
- 根因判断：主进程加密缓存本身存在且 cache hit 会在远端请求/额度逻辑前返回；缺口在 WhatsApp chat navigation 后 DOM 重建未触发 translation view rehydrate。
- PR #234 `fix: restore cached WhatsApp translations after chat switches` 已合 master，merge `c7d7290bf3e45cf2e8782bf83d5870bfd5f23157`。
- PR #234 最终 head `1f63522124ec50c8930f58b4785e666f3adf8449`，GitHub `test` run `33217680164`: success。
- #235 将 master 普通 merge 回 #166，merge commit `6ed641f6ac0a892e65777775938be133abe90d1e`。
- 尚未做真实 WhatsApp A→B→A 客户端回显验证，因此只能称 code/CI verified，不能称真实客户端完成。

## 关键产品/安全边界

- Broadcast Job 固定 `accountId / partition / platform / WebView owner / targets / message / attachments / interval`；切账号只影响显示，不改变执行 owner。
- 不同账号可并发；同账号仅一个 executing Job；定时碰撞进入 queued。
- 定时附件继续使用主进程 durable opaque ref；renderer 不获得 canonical path。
- 发送继续复用 `GeekPlatformTransports` 与 `GeekBroadcastSafety.authorizeSend`。
- WebView 安全策略不降低；LINE 的既有局部兼容例外不扩散。
- 翻译正文/译文缓存继续位于账号 partition 的 `geek-translation-cache.jsonl` 并使用 `safeStorage`；DOM 不是缓存源。
- 不记录/上传真实联系人、聊天正文、Cookie、Token、密码或其他用户数据作为诊断证据。
- validation build 继续独立 appId/product/runtime profile，`--publish never`，只允许验证版 EXE artifact。
- 普通维护禁止修改版本/release marker；正式 Windows release 仍需独立人工授权。

## 下一步

1. 以本 HANDOFF 提交后的 exact `ux/broadcast-account-jobs` HEAD 为唯一候选，核 Linux `test`、Windows `acl-windows`、`validation-client-build`。
2. 核 validation artifact 仍只包含 `geek-validation-setup-1.2.16.exe`，记录 artifact id/digest。
3. 用该安装包做真实客户端回归，优先验证用户刚报告的三项：
   - 联系人/群组能主动保存为“收件人名单”；
   - 定时任务创建、scheduled/queued、取消、到点、重启恢复；
   - WhatsApp 联系人 A→B→A 后既有译文从本地缓存重新显示。
4. 再继续附件、多账号并发、暂停/继续/停止、账号删除等 #166 全 gate。
5. 真实 gate 通过前保持 Draft；正式 Windows 发布仍需用户独立授权。
