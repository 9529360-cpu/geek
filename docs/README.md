# 文档索引与来源优先级

本目录同时保留当前运维手册、历史事故交接、逆向研究和 UI 原型。它们的用途不同，不能把旧文档中的版本、供应商、测试数量、命令或安全配置直接当作当前生产事实。

## 当前来源优先级

判断当前行为时按以下顺序取证：

1. `master` 上的源码、配置、`package.json`、锁文件和 `.github/release-client-version`；
2. 当前 contract、集成测试和 `.github/workflows/`；
3. Issue #21/#23 的最新生产状态，以及对应 GitHub Actions run；
4. Issue #50、README 和下列当前运维手册；
5. 历史事故、研究、旧发布交接与 UI 原型，只用于理解当时背景。

若文档与当前源码或工作流冲突，以当前实现和测试为准，并通过独立文档 Issue/PR 修正文档漂移。

## 当前运维文档

- [`../README.md`](../README.md)：产品范围、当前运行时、WebView 安全边界、开发与验证入口。
- [`../AGENTS.md`](../AGENTS.md)：自动化代理进入仓库后的最低操作和安全要求。
- [`account-password-reset-operations.md`](account-password-reset-operations.md)：账号、忘记密码、Resend、D1 和相关生产验证。
- [`github-control-plane.md`](github-control-plane.md)：GitHub Actions、Cloudflare 部署与非敏感状态通道。
- [`release-security.md`](release-security.md)：Windows 客户端构建、签名、版本标记、发布与回滚边界。

跨会话维护恢复以 [Issue #50](https://github.com/9529360-cpu/geek/issues/50) 的最新评论为入口。Cloudflare 部署结果以 [Issue #21](https://github.com/9529360-cpu/geek/issues/21) 为准，账号注册、登录、鉴权和测试账号清理结果以 [Issue #23](https://github.com/9529360-cpu/geek/issues/23) 为准。

生产部署验证由执行 Wrangler 部署的同一个 GitHub-hosted job 完成。不要用本地临时容器能否解析域名替代 #21/#23 和对应 Actions run。

## 历史事故与交接资料

以下内容按发生时状态保留，可能包含旧版本、旧模型供应商、旧测试数量、旧手工发布命令或已经修复的故障：

- [`../ISSUES.md`](../ISSUES.md)：历史事故、逆向过程、修复和当时发布状态。
- [`release-worker-r2-mismatch-handoff.md`](release-worker-r2-mismatch-handoff.md)：2026-08-17 发布/R2/翻译网关交接记录。

这些文件不是当前发布清单或生产配置。需要处理同类问题时，应先核对现行 Worker、工作流、测试和最新生产状态，再引用其中仍适用的经验。

## 历史研究与设计资料

以下资料用于理解方案来源，不代表已经实现或仍在使用：

- [`helloworld-高级功能工具研究.md`](helloworld-%E9%AB%98%E7%BA%A7%E5%8A%9F%E8%83%BD%E5%B7%A5%E5%85%B7%E7%A0%94%E7%A9%B6.md)
- [`多平台翻译架构研究.md`](%E5%A4%9A%E5%B9%B3%E5%8F%B0%E7%BF%BB%E8%AF%91%E6%9E%B6%E6%9E%84%E7%A0%94%E7%A9%B6.md)
- [`translation-gateway-auth-design.md`](translation-gateway-auth-design.md)

研究文件中的模型名、上游端点、限流数字、部署步骤和设计结论都必须用当前实现重新验证。不要因研究文档提到某个供应商或配置，就把它加入生产代码、secret 或运维流程。

## UI 原型与视觉参考

以下 HTML/PNG 是历史设计原型或截图，不是运行时页面，也不定义当前 DOM、文案、支付流程或安全边界：

- `original-ui-reference.html`
- `极客UI-v2-设计原型.html` 与对应预览图
- `极客UI-v3-Linear质感.html`
- `极客UI-v4-Mac质感.html` 与对应预览图
- `极客UI-v5-原位置Mac质感.html` 与对应预览图
- `极客UI-v6-到位版.html` 与对应真实效果图

产品改动应以 `ui/`、相关 contract 和当前需求为准。不得直接复制原型里的旧接口、地址、凭据占位、支付文案或安全配置进入运行时。

## 维护规则

- 当前运维文档可以通过聚焦文档 PR 更新。
- 历史事故、研究和原型正文原则上保留原貌；通过本索引或文件顶部说明其历史属性，而不是把历史改写成当前状态。
- 文档不得记录 API key、JWT、Cookie、密码、重置 token、LINE auth header、聊天正文、真实账号数据或 Cloudflare 响应正文。
- 普通文档维护不得修改 `.github/release-client-version`，也不得触发或描述为正式客户端发布。
