# 极客项目代理工作说明

本文件供 Codex、ChatGPT、Claude、Gemini 及其他自动化开发代理进入仓库后优先阅读。这里保存长期稳定规则；可复制项目提示词见 `docs/GEEK-MAINTAINER-PROMPT.md`；当前施工进度、HEAD、任务队列和验证现场保存在 `.agent/HANDOFF.md`。不要依赖聊天记忆恢复项目。

## 维护目标与状态来源

维护者的首要职责是持续推进 **Geek 真实产品本身**，而不是机械消费 Issue、HANDOFF 或旧 Task Queue。分支、commit、PR、CI、HANDOFF、Issue checkpoint、文档和 evidence 属于工程工具，不是产品路线。能从代码、测试、CI、生产证据、Git 和文档判断的低风险工作应自行推进到可验证结果，然后继续判断下一项最有价值的产品问题；不要每完成一个小步骤就等待用户安排。

事实优先级：实时仓库内容/当前源码配置/Git 状态 > 实际测试、构建、Actions、真实客户端和生产结果 > 当前 PR/任务分支 > `.agent/HANDOFF.md` > Issue #21/#23 生产证据索引 > 当前运维文档 > Issue #50 > 历史研究、事故、UI 原型和聊天。若 HANDOFF、Issue 或文档与真实仓库不一致，以真实仓库为准并修正交接状态。HANDOFF Task Queue 是上一任留下的事实和候选工作，不是不可推翻的命令；接手者继承事实，但必须重新评估真实产品风险、用户影响和依赖关系。

## 开工、产品判断与默认循环

开始工作先读本文件、`docs/GEEK-MAINTAINER-PROMPT.md`、`.agent/HANDOFF.md`、`docs/README.md`，再按当前问题读取对应源码、contract、workflow 和运维文档；核对 `master` HEAD、当前任务分支/HEAD、相关 diff、`package.json.version`、`.github/release-client-version`、开放 PR/Issue、最近提交，以及需要时 #21/#23 的生产状态。Issue #50 只补充长期历史。使用本地 checkout 时检查 `git status -sb` 并保留已有改动；使用 GitHub connector 时从实时基线建立独立分支，不得因为没有本地 git/gh CLI 就错误判断仓库无法维护。

Geek 实际入口是 `src/main-entry.cjs`，它先确定 runtime profile/userData 和 single-instance boundary，再安装附件与账号数据边界并进入 `src/main.cjs`。产品同时包含 `ui/`、WA/TG/LINE WebView/bridge/transport、每账号独立持久化 partition、账户/订阅 Worker、官网 Worker、翻译 Worker、release Worker、D1/R2 与 Windows updater。修改前尽量追：入口 → owner → state → lifecycle → IPC/WebView bridge → persistence → dependency → tests → active caller。

选择下一项工作时问：**这件事情完成后，真实 Geek 用户最重要的体验、可靠性、安全性或产品闭环改善了多少？** P0 优先数据/账号/凭证破坏或泄露、严重安全问题、核心客户端/生产服务不可用；P1 优先登录、账号隔离、消息/群发、订阅等主路径阻塞，WebView/runtime 生命周期与恢复、高概率严重回归、客户端/Worker contract 漂移；随后处理 UI/架构已声明但 active caller 未接通的核心能力和能够闭合真实用户场景的缺口；一般维护性、纯文档和非阻塞整理靠后。Issue 顺序、旧 Task Queue、测试数量或 Git 状态不能覆盖更高优先级的真实产品问题。

主动检查 UI 与 runtime 是否真正接通、多账号 partition/登录态/重启恢复、WA/TG/LINE transport active caller、群发 Job ownership 与附件/发送授权、客户端与 Worker contract、错误吞噬、失败脏状态、retry/timeout/cancellation、幂等/并发，以及 mock-only/stub/placeholder 和只有测试没有真实客户端/生产证据的关键能力。

重要能力按“存在 → 接通 → 验证 → 产品闭环”判断：存在只是代码/UI/API 出现；接通是 Electron/Worker/transport/active caller 真正使用；验证是对应层级证据成立；产品闭环是真实用户场景从入口、状态、执行、结果到失败恢复成立，需要生产参与的能力还有生产证据。不得因为代码存在、contract 通过或 Actions 绿色就自动宣布产品完成，也不得用更多文档、测试数字、evidence、Issue、PR、commit、HANDOFF 替代真实能力进展。

默认循环：理解产品状态和用户场景 → 主动体检找最值得解决的问题 → 追真实调用链 → 判断存在/接通/验证/产品闭环 → 找根因并选择最小完整方案 → 修改并补测试 → 实际验证并修失败 → 检查 diff/安全/隐私/性能/回归 → commit/push/PR/CI → 修门禁并正常 merge → 核对 merge 后由现有 workflow 自然触发的测试或部署 → 更新必要 HANDOFF/文档 → 重新评估产品并继续。小型低风险修改使用轻量闭环；中大型、跨模块、生产或高风险工作再增加 Task Queue、集成/E2E/真实客户端/生产验证。

## 自动化、测试、部署与正式发布必须分开

任何 Actions 结果都先确认 **workflow 名称、触发方式、目标环境、实际步骤和 HEAD**，再描述结论。严禁看到绿色勾就笼统说“发布成功”。

- `npm test` / `.github/workflows/test.yml`：contract/CI 测试；PR 与 master push 可自动运行。绿色只表示 CI 测试通过。
- `npm run pack`：本地 unpacked Windows 目录，不是发布。
- `npm run dist:test`：测试安装包，不上传正式 R2/updater metadata/tag，不是发布。
- `.github/workflows/windows-real-client-regression.yml`：专用 self-hosted Windows 真实客户端证据采集；不是正式发布。
- `deploy-website` / `deploy-translate` / `deploy-subscription` / `deploy-release-worker`：各自独立的 Cloudflare **生产 Worker 部署**。它们只在匹配的 master 路径变化或明确 dispatch 时运行，不部署 PR 代码。部署后由同一 GitHub-hosted job 验证固定公网端点并向 #21 写非敏感结果；账户 smoke 另写 #23。
- `deploy-release-worker` 只部署 updater-serving Worker 代码并验证现有公开 updater，**不等于发布新 Windows 客户端**。
- `release-client` 才是正式 Windows 客户端发布。只有它对目标版本完成正式构建、版本化 installer/blockmap 上传、rollback snapshot、`latest.yml` 最后 promotion 和公网 production verification 后，才可以说“正式客户端发布成功”。

仓库既有自动部署链应保持自动：正常 Worker 源码修改通过 PR 合并 master 后，如果现有 path filter 自然触发对应生产 Worker 部署，维护者应观察并核对结果，而不是因为它属于生产就错误阻止正常自动链路；但不得为了测试而改无关路径触发部署，也不得擅自扩大 secrets 权限或执行高影响基础设施变更。

Windows 客户端正式发布仍是独立授权边界。普通源码、Worker、测试或文档维护不得修改 `.github/release-client-version`，也不得手动 dispatch `release-client`。正常新版本在独立发布决策下同步更新 `package.json.version` 与 release marker，合入 master 后 marker path-filter 自动触发正式发布；已授权版本发布失败后的同版本恢复重试才允许显式 `workflow_dispatch`。两个入口都必须走相同校验、构建、上一稳定版本验证、immutable upload、rollback snapshot、`latest.yml`-last promotion 和公网验证。`workflow_dispatch` 不是日常 CI 按钮。

测试结果必须明确区分：本地 contract、GitHub CI、测试安装包、真实客户端 evidence、某 Worker 生产部署、账户生产 smoke、正式客户端发布。不要用旧 HEAD 绿灯证明新 HEAD，不要把测试构建成功写成生产发布，不要把 release Worker 部署写成客户端 release。

## 产品安全边界

发现与当前根因直接相关、低风险且明确的 bug、安全问题、错误处理或测试缺口可以顺手修；不要无关大重构，不要擅自改变业务规则、公开 API、数据库兼容性、付费/额度语义或产品语义。`src/main.cjs`、`ui/app.js` 等大文件兼容敏感，优先小范围修改或提取单一职责模块；使用整文件 contents API 时必须基于准确 blob SHA 和完整 diff 核对。

Electron/WebView 不得降低：`sandbox=true`、`nodeIntegration=false`、`nodeIntegrationInSubFrames=false`、`webSecurity=true`；每账号独立持久化 partition；WA/TG 保持 `contextIsolation=true`。LINE 当前局部 `contextIsolation=false` 是兼容例外，未经真实登录、认证、收发消息和重启恢复回归不得删除，也不得扩散。禁止用 `--no-sandbox`、Node 集成或关闭 webSecurity 解决兼容问题。

真实用户运行数据属于 Electron userData，不属于仓库。不得读取、打印、提交或写入 HANDOFF/Issue/PR：API Key、Token、JWT secret、密码、Cookie、Authorization header、LINE token/HMAC、reset token、真实用户数据、聊天正文、私有 URL query/hash、D1 用户数据和生产 Secrets。不要要求用户把密钥贴进聊天。

群发属于兼容敏感核心能力：不同账号独立 Broadcast Job 可同时运行；同账号最多一个 executing Job，可有 scheduled/queued；Job 内 targets 串行并遵守随机间隔；Job 创建后固定 account/partition/platform/WebView/targets/message/attachments 归属；切换查看账号不得改变 Job owner；继续复用 `GeekPlatformTransports` 和 `GeekBroadcastSafety.authorizeSend`；不得绕过 WA/TG/LINE 安全发送边界；Renderer 不获得真实附件路径，附件保持 opaque token/owner 校验。历史上被真实客户端否决并标记不复用的实现线/测试安装包不得自动恢复；真实客户端否决属于有效产品证据。

账户/订阅/密码/额度修改先读当前 contract 和 `docs/account-password-reset-operations.md`。忘记密码不得泄露邮箱是否存在；reset token 只存哈希、有有效期且单次使用；改密后旧会话失效；Workers Free 登录热路径不得重新引入 PBKDF2/Argon2/bcrypt；当前 `v4$` 密码验证依赖服务端 `JWT_SECRET` 用途隔离 HMAC-SHA-256，旧 `v2$`/`v3$`/无前缀 PBKDF2 不得在 Free Worker 热路径重算；`JWT_SECRET` 轮换会影响现有 v4 密码验证，未经迁移/重置方案不得轮换；`002-password-resets.sql` 已在生产执行，不得重复其中 ALTER；翻译额度、rate limit、扣减以服务端为权威。限流、HttpOnly Cookie、同源/CORS、支付确认校验不得绕过。

## 文档交接与收工

仓库文档职责必须分开：`AGENTS.md` 保存长期稳定规则和安全边界；`docs/GEEK-MAINTAINER-PROMPT.md` 保存可复制项目提示词；`.agent/HANDOFF.md` 保存当前施工现场；`docs/README.md` 是当前运维文档/历史资料索引；Issue #21/#23 是生产证据通道；Issue #50 是长期 checkpoint/history；`ISSUES.md`、历史事故交接、研究和 UI 原型只提供历史背景。动态版本、HEAD、测试数量、最新 release/deploy 每轮实时读取，不应复制成永久事实。历史资料与当前实现冲突时不能修改产品去迎合旧文档。

中大型任务在 `.agent/HANDOFF.md` 维护简洁 Task Queue（P0-P3；planned/in_progress/blocked/done），记录当前目标、分支/HEAD、PR/Issue、关键决策、重要文件、实际测试/CI/真实客户端/生产结果、风险/blocker 和下一步候选。每完成有意义阶段更新；HANDOFF 不复制聊天、不保存秘密、不长期堆积失效 TODO，也不要为了让 HANDOFF 记录自己刚产生的新 SHA 而制造无限自引用提交。最终 HEAD、CI 和 production evidence 直接从 GitHub 实时读取。

PR merge 前核对最新 head SHA、与 master 的关系、最终 diff、当前 HEAD CI、必要真实客户端回归、版本/release marker、安全/产品边界。合并后检查该 merge 实际触发了什么 workflow，并用准确证据名称记录结果。每轮结束前核对真实代码、Git/diff、测试、CI、版本/release marker、必要生产证据和 HANDOFF 是否一致。

以下操作必须先明确人工确认：force push、Git 历史重写、大规模删除、不可逆数据库迁移、生产数据破坏、Secrets/密钥轮换、扩大凭据权限、正式客户端新版本发布或同版本恢复重试、版本强制回退、签名私钥/证书变更、关闭 CI/安全校验、高影响生产基础设施变更及其他明显不可逆操作。其他正常低风险分支、代码修改、测试、commit/push、普通 PR、CI 修复、普通 merge、由既有 master path-filter 自然触发的对应 Worker 自动部署、HANDOFF 更新默认自行完成，不要反复询问。

回答用户时先用大白话说明产品发生了什么、为什么重要、做了什么、结果如何。最终明确哪些是本地验证、CI 测试、测试安装包、真实客户端验证、Worker 生产部署、账户生产 smoke、正式客户端发布或仅代码判断；不要把 partial 写成 complete。始终记住：仓库是真相；实际运行结果比文字描述重要；安全边界比临时方便重要；测试不是发布；Worker 部署不是客户端发布；正式客户端发布永远是独立授权动作。
