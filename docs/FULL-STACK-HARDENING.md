# Full-stack Hardening 历史收敛账

> 本文件是 **Git archaeology / durable design ledger**，不是当前 Task Queue，也不是实时状态数据库。任何当前版本、HEAD、PR/Issue 状态、CI 结果和产品完成度都必须从 live GitHub、当前源码与实际验证重新确认。

## 这套编号到底是什么

仓库历史中正式使用过一轮 `FH`（Full-stack Hardening）编号，用来把主进程里分散的状态、IPC 和安全所有权逐步收敛到明确 owner。

当前可追溯的正式序列是 **FH-01 ～ FH-08**。仓库没有发现正式的 FH-09、FH-10、FH-11 或 FH-12 实施项，因此维护者不得为了“补齐编号”凭空发明后续阶段。FH-08 之后的维护继续按真实根因建立独立 Issue / branch / PR。

## 已完成的 FH 序列

| 编号 | 主 PR | 收敛目标 | 永久结果 / owner | Mutation evidence |
|---|---:|---|---|---|
| FH-01 | #343 | Account State 启动恢复与损坏 fail-closed | `src/account-state.cjs` 对真实缺失、损坏、备份恢复、加密失败与 durable commit 负责 | #344 |
| FH-02 | #345 | Global Config transaction owner | `src/config-state.cjs` 拥有 canonical config、持久化、恢复与串行 mutation；`src/config-ipc.cjs` 拥有 config IPC | #346 |
| FH-03 | #347 | Platform Catalog + Navigation single authority | 平台元数据集中到 `src/platform-catalog.cjs`；post-attach 导航边界集中到 WebView navigation owner | #348 |
| FH-04 | #349 | Translation Runtime owner | `src/translation-runtime.cjs` 拥有翻译运行时状态、gateway orchestration、IPC 生命周期与账号删除隔离 | #350 |
| FH-05 | #351 | Subscription IPC owner | `src/subscription-ipc.cjs` 统一 Subscription IPC 注册、sender gate 与 teardown | #352 |
| FH-06 | #353 | Desktop/System IPC owner | `src/desktop-ipc.cjs` 统一桌面/system invoke channels 与 trusted-sender 生命周期 | #354 / #355 / #356 |
| FH-07 | #358 | WebView IPC ingress owner | `src/webview-ipc.cjs` 拥有 `webview:register` / `webview:insert-text` ingress；`src/webview-ownership.cjs` 继续是唯一 ownership registry authority | #359 / #360 |
| FH-08 | #361 | 删除死的 LINE legacy token runtime owner | 生产 `src/**` 不再读写 `line-tokens.json`；旧敏感文件作为 legacy artifact 保留，不把删除文件误当迁移 | #362 / #363 |

## 如何使用这张账

1. 需要理解某个 owner 为什么存在时，先读当前源码和 contract，再回看对应 FH PR；不要反过来用旧 PR 文字覆盖当前实现。
2. Mutation PR 是“永久不合并”的历史回归证据，只用于说明 contract 曾经真实捕获过哪类退化；不得 cherry-pick 或恢复 mutation 代码。
3. 后续发现新的所有权问题时，按当前根因创建独立 Issue/PR。只有在仓库明确启动一轮新的、命名清晰的 hardening program 时才继续编号。
4. FH 完成只代表相应结构/所有权收敛，不自动替代真实客户端、认证后平台兼容、生产 Worker 或正式 release 证据。

## 与当前治理入口的关系

- 长期规则与安全边界：`../AGENTS.md`
- 跨会话恢复契约：`../.agent/HANDOFF.md`
- 文档权威分层：`README.md`
- 当前事实：live `master`、源码、配置、open PR/Issues、Actions、真实客户端/生产证据
- 长期 checkpoint/history：Issue #50

这份文件不记录“当前版本”“最新 master SHA”“当前测试数量”或“下一步计划”，避免再次形成会过期的治理账。