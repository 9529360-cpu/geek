# Geek Agent Handoff

Updated: 2026-08-29

## 2026-08-30 Telegram 标签群发语义纠偏

- 用户确认产品语义：保存标签只是批量恢复普通收件人选择，不是新的发送类型。Job、runtime 和 transport 都不得知道 target 是否来自标签。
- 已撤销 `2ef88be` 的 saved-tag 专用路由方案；验证 artifact `9722230157` / `geek-validation-2ef88be...` 作废，不得用于验收。
- 新边界：`app.js` 是 `broadcastSelected` 的唯一 owner，并提供统一 canonical target snapshot；手动勾选与标签恢复进入完全相同的 custom audience。
- TG 的直接 `switchChat + chat identity` 成功路径保持不变。仅当通用 `platform.openChat` 找不到/无法确认目标时，才使用 provenance-free 的虚拟聊天列表滚动恢复；恢复仍要求真实选中行与 current chat identity 同时一致，否则 fail-closed。
- 禁止重新引入 `telegramSavedTarget`、标签专用 Job 字段、全局 transport wrapper 或 `location.hash` 自证导航。
- 下一门禁：完整本地 contract（已知本机 ACL 代码页问题单列）、exact-head CI/validation build；真实客户端必须分别验证普通 TG 群发和标签快捷恢复后群发，两者从 Job 创建起应没有行为差异。

## 当前目标

继续收口 Draft PR #166 `feat: make broadcast runtime account-scoped`。群发执行层已账号级 Job 化；当前重点是用真实 Windows validation 客户端把编辑器、联系人加载、收件人名单、定时任务、附件和多账号恢复闭环验证。正式 `master` / Geek 1.2.16 继续作为稳定参照，真实客户端通过前 #166 保持 Draft。

## 实时仓库状态

- `master`: `c7d7290bf3e45cf2e8782bf83d5870bfd5f23157`
- `ux/broadcast-account-jobs`: 本 HANDOFF 提交前 `6ca645ae1233d0e9dd2fb71d60b4c99fc74caf4c`
- PR #166: Draft
- `package.json.version`: `1.2.16`
- `.github/release-client-version`: `1.2.16`
- 未 force push、未历史重写、未触发正式 `release-client`。

## 当前最高优先级

| 优先级 | 状态 | 任务 | 当前证据 / 下一条件 |
|---|---|---|---|
| P1 | real_client_fix | #231 群发编辑器产品闭环 | 用户在 exact validation `4ee50766...` 发现点击群发后“正在准备 WhatsApp 群发联系人”会把原入口拦住，页面表现为卡死。根因为 Workbench capture-phase `preventDefault + stopImmediatePropagation` 后异步等待 WPP。PR #236 已删除该错误边界：Workbench 不再探测 WPP/拦入口，只增强已打开弹窗；联系人状态仅 inline、非阻塞。PR CI `33219720307` success；已合 #166 为 `6ca645ae...`。需新 exact validation 实机确认。 |
| P1 | code_done | 群发四步 Workbench | 内容→对象→设置→检查；保留高级收件方式、附件、名片、随机间隔和账号级任务中心。Workbench 现在仅负责 presentation，不再重复 transport/readiness。 |
| P1 | code_done | 联系人/群组保存语义 | 主入口“保存收件人名单”支持联系人+群组；“保存群组集合”只表示群组筛选。需实机验证实际保存/恢复。 |
| P1 | code_done | 定时任务主路径 | 旧 `scheduleTasks + setTimeout + 改写编辑器` UI 已退役；入口统一到 account-scoped `scheduled/queued BroadcastJob`、fixed targets、durable attachment ref、restart restore/cancel/recovery。需真实到点/重启验证。 |
| P1 | real_client_pass | #233 WhatsApp 翻译缓存 A→B→A 回显 | #234 已合 master 并同步 #166。用户已在 `4ee50766...` 实机确认“翻译的那个倒是修好了”。继续保留主进程 partition safeStorage 缓存和独立 `translation-whatsapp-rehydrate.js`。 |
| P1 | in_progress | exact HEAD CI + validation artifact | 本 HANDOFF 提交会产生最终 exact HEAD 并触发 test/acl-windows/validation-client-build；只使用该 HEAD 的新验证包。 |
| P1 | blocked | #166 其余真实客户端回归 | WA/TG/LINE 登录/文本/附件；A/B/C 并发；pause/resume/stop；scheduled/queued；重启恢复；账号删除；附件源变更 fail-closed。 |
| P1 | planned | #166 Ready / merge | 真实客户端 gate 通过后。 |
| P1 | planned | 正式客户端发布 | 独立人工授权动作；当前禁止。 |
| P2 | open | #230 website 账号入口不可达 | 独立处理，不阻塞当前 WA/TG/LINE gate。 |

## 最近实际验证

### 群发入口回归与修复

- 用户安装 exact validation HEAD `4ee507660cef021b07cc54bb4f8d259edd9be569` 后，点击群发出现“正在准备 WhatsApp 群发联系人”，随后整个页面看起来不动。
- 代码根因已追到 `ui/broadcast-workbench.js`：capture-phase 拦截 `#bc-menu-send`，同步阻止原 handler，再异步 `awaitBroadcastReadiness()`；readiness 未按预期完成时原群发弹窗永远不会打开。
- PR #236 `fix: keep broadcast contact loading non-blocking` 删除 `bypassNextOpen / probeWhatsAppReadiness / awaitBroadcastReadiness / prepareAndReopen` 及入口 capture 拦截。
- Workbench 现在只观察已打开的 `broadcast-overlay` / `broadcast-meta`，联系人同步中提示“可继续编辑消息”；失败只提示“不影响编辑”，不会冻结主界面。
- 新 contract 明确禁止 Workbench 再出现 `#bc-menu-send` 拦截、`preventDefault()`、`stopImmediatePropagation()`、WPP 直接 probe 或重复 readiness orchestration。
- PR #236 head `69eb6525cd7377940908abe1def80471c531c239`，GitHub `test` run `33219720307`: success；merge `6ca645ae1233d0e9dd2fb71d60b4c99fc74caf4c` 已进入 #166。
- 这只证明代码/CI 修复，尚需新 validation 客户端确认点击群发立即打开且联系人加载只局部异步。

### 翻译回显

- Issue #233 / PR #234 已修 WhatsApp A→B→A 后 DOM 重建不重新挂载缓存译文的问题。
- 主进程加密翻译缓存未改；新增独立 `translation-whatsapp-rehydrate.js` 只在 chat identity 变化时调用既有 `__geekRefreshTranslationView()`。
- PR #234 CI success，已合 master `c7d7290bf3e45cf2e8782bf83d5870bfd5f23157` 并同步 #166。
- 用户已在 validation `4ee50766...` 真实客户端确认翻译修复有效。

## 关键产品/安全边界

- Broadcast Job 固定 `accountId / partition / platform / WebView owner / targets / message / attachments / interval`；切换查看账号不能重定向 Job。
- 不同账号可并发，同账号 executing Job 串行；定时碰撞进入 queued。
- 定时附件使用主进程 durable opaque ref；renderer 不获得 canonical path。
- 发送继续复用 `GeekPlatformTransports` 与 `GeekBroadcastSafety.authorizeSend`。
- Workbench 只负责 UI/presentation，不直接访问 WPP readiness，不阻断原群发入口。
- WebView 安全策略不降低；LINE 既有局部兼容例外不扩散。
- 翻译正文/译文缓存继续位于账号 partition 并使用 `safeStorage`；DOM 不是缓存源。
- 不记录/上传真实联系人、聊天正文、Cookie、Token、密码或用户数据作为诊断证据。
- validation build 使用独立 appId/product/runtime profile，`--publish never`，只允许验证版 EXE artifact。
- 普通维护禁止修改版本/release marker；正式 Windows release 仍需独立人工授权。

## 下一步

1. 以本 HANDOFF 提交后的 exact #166 HEAD 为唯一候选，核 Linux `test`、Windows `acl-windows`、`validation-client-build`。
2. 核 validation artifact 只包含 `geek-validation-setup-1.2.16.exe`，记录 artifact id/digest/EXE SHA-256，并交用户安装。
3. 第一优先实机验证：点击群发必须立即打开编辑器；联系人加载只能局部显示同步状态，页面和消息编辑始终可操作；联系人最终出现。
4. 继续验证“保存收件人名单”和定时任务 scheduled/queued/cancel/到点/重启恢复。
5. 再做附件、多账号并发、暂停/继续/停止、账号删除等 #166 全 gate。
6. 真实 gate 通过前保持 Draft；正式 Windows 发布仍需用户独立授权。
