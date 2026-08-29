# 文档索引与来源优先级

本目录同时保留当前运维手册、历史事故交接、逆向研究和 UI 原型。它们的用途不同，不能把旧文档中的版本、供应商、测试数量、命令或安全配置直接当作当前生产事实。

## 当前来源优先级

判断当前行为时按以下顺序取证：

1. 实时仓库内容与 Git 状态：默认/当前分支、HEAD、相关 diff、源码、配置、`package.json`、锁文件和 `.github/release-client-version`；
2. 实际 contract、集成测试、构建结果、`.github/workflows/` 与对应 GitHub Actions run；
3. `.agent/HANDOFF.md` 当前施工现场；生产状态另以 Issue #21/#23 及对应 Actions 为准；
4. Issue #50 的长期 checkpoint/history、README 和下列当前运维手册；
5. 历史事故、研究、旧发布交接与 UI 原型，只用于理解当时背景。

若 HANDOFF、Issue 或文档与当前源码/工作流冲突，以真实仓库和实际验证为准，并先修正交接/文档漂移。不要反过来修改代码去迎合旧文档。

## 跨会话恢复入口

- [`../AGENTS.md`](../AGENTS.md)：长期稳定的 Agent 操作规则、安全边界和关键位置。
- [`../.agent/HANDOFF.md`](../.agent/HANDOFF.md)：当前目标、HEAD 快照、Task Queue、测试结果、风险和下一步；新 Agent 应在开工和收工时与真实仓库对齐。
- [`GEEK-MAINTAINER-PROMPT.md`](GEEK-MAINTAINER-PROMPT.md)：换电脑/换会话/换模型时可直接复制的启动提示词。
- [Issue #50](https://github.com/9529360-cpu/geek/issues/50)：长期在线 checkpoint/history，用于追溯历史和提供仓库外恢复保险，不再作为唯一实时状态入口。

新会话推荐顺序：`AGENTS.md` → `.agent/HANDOFF.md` → 实时 Git/版本/测试核对 → 当前任务文档 → 必要时 Issue #21/#23/#50。

## 当前运维文档

- [`../README.md`](../README.md)：产品范围、当前运行时、WebView 安全边界、开发与验证入口。
- [`account-password-reset-operations.md`](account-password-reset-operations.md)：账号、忘记密码、Resend、D1 和相关生产验证。
- [`github-control-plane.md`](github-control-plane.md)：GitHub Actions、Cloudflare 部署与非敏感状态通道。
- [`release-security.md`](release-security.md)：Windows 客户端构建、签名、版本标记、发布与回滚边界。
- [`群发附件回归修复契约-20260828.md`](群发附件回归修复契约-20260828.md)：Issue #165 / PR #166 的附件、名片、重试与账号草稿隔离验收契约。
- [`群发UI保存与标签修复契约-20260828.md`](群发UI保存与标签修复契约-20260828.md)：Issue #165 / PR #166 的编辑器受众、常用消息、群组集合、反馈与失败导出契约。

Cloudflare 部署结果以 [Issue #21](https://github.com/9529360-cpu/geek/issues/21) 和对应 Actions run 为准，账号注册、登录、鉴权和测试账号清理结果以 [Issue #23](https://github.com/9529360-cpu/geek/issues/23) 和对应 Actions run 为准。

生产部署验证由执行 Wrangler 部署的同一个 GitHub-hosted job 完成。不要用本地临时容器能否解析域名替代 #21/#23 和对应 Actions run。

## 动态事实不要硬编码

以下信息变化频繁，不应在长期运维规则中复制成“当前永远如此”的事实：

- 客户端版本和 release marker；
- `master` HEAD；
- contract/test 数量；
- 最新 release/tag；
- 最近一次生产部署或 smoke 结果。

这些内容每轮从真实仓库、Actions、Issue #21/#23 和 `.agent/HANDOFF.md` 重新核对。运维文档可以解释“如何验证”，但应尽量避免复制一个很快过期的版本快照。

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
