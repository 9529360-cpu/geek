# 翻译网关授权、计费与结果恢复边界

- 桌面端长期登录 token 只发送给订阅 Worker。
- 订阅 Worker 为已启用用户签发 5 分钟短期 JWT，固定 `aud=geek-translate`、`purpose=translate`。
- 翻译 Worker 与订阅 Worker 通过 Cloudflare secret 共享 `JWT_SECRET`；secret 不进入源码或桌面包。
- 每个逻辑翻译操作使用一个 UUID `X-Request-ID`，桌面端在主/备网关切换和未知传输结果重试时必须复用同一个 ID。
- D1 `translation_usage.request_id` 是唯一幂等键。启用迁移 006 后，同时保存以 `JWT_SECRET` 做用途隔离 HMAC 的 `request_hash`，绑定用户、请求 ID、原文、源/目标语言、provider、稳定 operation route 和协议版本；物理主/备端点 route 不属于业务语义，因此允许故障切换时变化。
- 调用翻译上游前按原文字符数做条件原子预扣；余额不足不调用上游。预留拥有唯一 owner，并由迁移 005 提供 2 分钟 durable lease；过期 reservation 只按 owner/request/user/字符数/过期条件做有界恢复，退款与删除保持同一 D1 batch。
- 上游失败、调用方取消或在终态提交前截止时，只允许当前 reservation owner 退款并删除占位；不得让另一并发请求替它完成或退款。
- 成功终态在同一个 D1 batch 内扣译文字符、写入 `complete`，并保存可恢复结果。D1 不保存聊天原文明文或译文明文；回放内容使用 AES-GCM 加密，密钥从 Worker-only `JWT_SECRET` 以独立用途域派生，AAD 绑定 request ID、user ID 和 request hash。
- 加密回放材料有效期为 24 小时。过期后在访问时清空，并由有界维护任务继续清理；计费/幂等记录可以保留，但过期结果不可再次解密回放。
- 相同 request ID + 相同语义在已完成状态下直接返回加密回放结果，不再次调用 provider，也不再次扣费或退款。相同 request ID 搭配不同语义必须返回 `request_conflict`。
- 相同 request ID 正由另一请求处理时返回 `request_in_progress`。桌面端必须把它当作“待协调的非终态”，在原有绝对 deadline 内做有界退避轮询；不得当作终态冲突，也不得因此污染网关健康状态。
- Worker 启用 `Request.signal`，将调用方取消显式传播到 provider 子请求；同时保留每次 provider 尝试上限和整次翻译绝对 deadline。超时/取消不等于“服务端一定没有提交”，因此任何未知结果仍必须依赖 request ID 状态恢复，而不是盲目新建请求。
- 用户每分钟 30 次、IP 每分钟 60 次；正文最多 10,000 个 JS 字符且 UTF-8 不超过 32 KiB。
- 公开健康检查不得泄露 provider 原始错误、聊天内容、request hash 或回放密文；只允许暴露安全的 provider 状态和 stale reservation 聚合信息。
- CORS 仅允许 `ALLOWED_ORIGIN` 显式列出的官网来源；Electron 主进程不依赖 CORS 作为鉴权。

## 迁移与部署顺序

生产 D1 迁移不得由 Worker 部署自动执行。上线这套恢复契约前必须：

1. 只读确认生产 `translation_usage` 当前 schema；
2. 经明确生产变更授权后应用 `005-translation-reservation-lease.sql`；
3. 确认 005 生效后再应用 `006-translation-outcome-replay.sql`；
4. 再部署包含结果恢复逻辑的 Translation Worker；
5. 用同一 request ID 验证完成回放、语义冲突、in-progress 协调、取消退款和额度 exactly-once 行为。

迁移 006 未应用时，Worker 保留旧 schema 兼容路径，避免部署先后短暂不一致直接打挂翻译；但旧 schema 无法提供“提交后响应丢失”的结果回放保证，因此不能把兼容模式视为完整上线状态。

`JWT_SECRET` 同时承担现有短期 JWT/服务端用途隔离密钥根职责，并作为回放密钥派生根。它的轮换不是透明操作：轮换会使仍在 24 小时窗口内、由旧 secret 加密的回放材料不可解密；任何轮换必须按生产密钥变更流程评估并处理这一窗口，而不是临时替换。
