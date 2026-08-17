# 翻译网关授权与计费边界

- 桌面端长期登录 token 只发送给订阅 Worker。
- 订阅 Worker 为已启用用户签发 5 分钟短期 JWT，固定 `aud=geek-translate`、`purpose=translate`。
- 翻译 Worker 与订阅 Worker通过 Cloudflare secret 共享 `JWT_SECRET`；secret 不进入源码或桌面包。
- 每次请求使用 UUID `X-Request-ID`。D1 `translation_usage.request_id` 唯一，阻止重复计费与并发重放。
- 调用 DeepSeek 前按原文字符数做条件原子预扣；余额不足不调用上游。
- 上游失败退回预扣并删除请求占位，允许安全重试；成功后扣译文字符并完成记录。
- 仅记录用户 ID、请求 ID、字符数和状态，不保存聊天正文或译文。
- 用户每分钟 30 次、IP 每分钟 60 次；正文最多 10,000 个 JS 字符且 UTF-8 不超过 32 KiB。
- 健康检查只验证必要绑定是否存在，不请求 DeepSeek。
- CORS 仅允许 `ALLOWED_ORIGIN` 显式列出的官网来源；Electron 主进程不依赖 CORS 作为鉴权。

部署前需分别向两个 Worker 设置相同的 `JWT_SECRET`，并向翻译 Worker 设置 `DEEPSEEK_API_KEY`。这些部署动作不由本地修复自动执行。
