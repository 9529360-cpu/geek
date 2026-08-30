# Geek 双 Agent 协作交接协议

> 本文是阿豪、星尘（架构/产品/验收）与网页版 GPT（代码执行 agent）之间的唯一在线工作交接面。
>
> 产品范围定义见：`docs/account-and-app-context-menu-scope.md`

## 1. 角色分工

### 星尘：架构负责人、产品负责人、验收负责人

星尘负责：

- 把阿豪的意图翻译成明确产品边界。
- 判断哪些功能应该新增、迁移或保持不动。
- 规定允许修改的范围和禁止触碰的边界。
- 审查网页版 GPT 的审计结果、实现方案和证据。
- 根据真实证据决定下一步任务或是否允许合并。
- 不凭“代码存在”“测试通过”“应用能启动”宣布完成。

### 网页版 GPT：代码执行 agent / 码农

网页版 GPT 负责：

- 阅读在线仓库源码和本协议。
- 在独立分支或 worktree 中执行被授权的任务。
- 先审计，再测试，再实现。
- 运行真实测试并记录输出。
- 在能力允许时做 Windows 真实启动和点击验收。
- 每次工作后把实际结果写回本文“执行日志”和“当前状态”。
- 遇到范围冲突、架构不确定、真实验证缺失时停止并标记 `blocked` 或 `unknown`，不能自行扩大范围。

### 阿豪：最终产品决策者

阿豪负责：

- 确认产品取舍和体验方向。
- 决定是否接受风险、是否允许合并和发布。
- 对外部可见、不可逆或可能影响现有账号的操作做最终决定。

## 2. 唯一工作规则

网页版 GPT 每次开始工作前，必须按顺序阅读：

1. 当前 `origin/master`。
2. 本文档的“当前任务”“当前状态”“执行日志”。
3. `docs/account-and-app-context-menu-scope.md`。
4. `.agent/HANDOFF.md` 和与当前任务相关的源码、测试、文档。

如果本文“当前任务”没有明确授权，网页版 GPT 不得自行挑选新功能，不得自行重构，不得自行进入下一个阶段。

每次工作只能推进一个明确任务，并且必须写明：

```text
任务 ID
目标
允许修改的文件范围
禁止修改的文件范围
完成标准
验证方法
```

## 3. 当前任务协议

### 状态值

只允许使用以下状态：

- `queued`：已排队，尚未开始
- `auditing`：只读审计中
- `implementing`：已获授权，正在实现
- `testing`：正在测试
- `needs-review`：代码和证据已提交，等待星尘审查
- `blocked`：被明确问题阻塞，必须停下
- `unknown`：无法真实验证，不能声称完成
- `accepted`：星尘/阿豪根据证据接受
- `rejected`：实现偏离要求或证据不足

### 当前任务

```yaml
task_id: ACCOUNT-CONTEXT-001
status: implementing
owner: web-gpt
base: origin/master
base_commit: 5245a710b429cf8454682fcf437517518b77c21f
working_branch: must-be-created-from-base
scope_document: docs/account-and-app-context-menu-scope.md
objective: >-
  在不破坏 Geek 1.2.17 稳定基线的前提下，完成极客账户个人中心、
  导航栏应用实例右键菜单整理、设置页实例级账号设置迁移，
  并修复审计发现的代理协议、全局代理回落和余额 fail-open 风险。
  允许自主进行架构判断、代码实现、测试、CI 和验收，但必须持续对照本文档。
allowed_changes:
  - ui/index.html
  - ui/app.js
  - ui/settings-controller.js
  - ui/settings-controller.css
  - src/main.cjs（仅代理协议和全局代理回落相关）
  - 相关新增或现有测试文件
  - 与本任务直接相关的审计、测试和交接记录
forbidden_changes:
  - master 分支
  - 允许范围之外的产品源码
  - 主导航结构
  - 登录恢复流程
  - WebView partition
  - 账号数据存储边界
  - 全局设置行为
  - 删除或回退稳定功能
completion_evidence:
  - 导航栏应用项和实例 ID 来源
  - 右键菜单所有权调用链
  - 账号设置逐项迁移表
  - 邮箱和字符信息真实来源
  - 代理和刷新现有调用链
  - 预计修改文件及禁止触碰文件
  - observed/intended/connected/verified/unknown/absent 能力表
  - 实际读取过的文件路径和 commit
next_gate: 星尘审阅审计结果后，才允许进入测试和实现
```

> 网页版 GPT 不得自行把 `status` 改成 `accepted`。`accepted` 必须由星尘或阿豪确认。

## 4. 网页版 GPT 每次开始前要做什么

在开始任何代码修改前，先在执行日志写入一条 `START`：

```text
[START]
日期时间：
任务 ID：
基线 commit：
工作分支：
当前工作区状态：
本次允许修改：
本次明确禁止修改：
预计验证方式：
```

如果发现工作区有不属于自己的未提交或未跟踪内容，必须保留、报告，不得清理，不得覆盖。

## 5. 网页版 GPT 每次完成一轮后要写什么

在执行日志新增一条，不得覆盖历史记录：

```text
[REPORT]
日期时间：
任务 ID：
状态：auditing / implementing / testing / needs-review / blocked / unknown
工作分支：
基线 commit：
当前 commit：

本轮做了什么：
- 

实际读取的源码/文档：
- 路径：用途：关键发现：

实际修改的文件：
- 路径：修改原因：

没有修改但确认不能碰的文件：
- 

测试命令：
```text
在这里写真实命令
```

测试实际输出：
```text
在这里粘贴真实输出，不得编造
```

真实 UI/运行验收：
- 已验证：
- 未验证：
- 证据：

当前结论：
- verified / connected / unknown / blocked

发现的问题和风险：
- 

下一步建议：
- 

需要星尘或阿豪决定：
- 无 / 明确写出问题
```

如果没有真实测试输出，就必须写 `未执行`，不能写“通过”。

## 6. 决策闸门

### Gate 0：审计闸门

没有以下内容，不准写产品代码：

- 真实源码调用链。
- 现有右键菜单所有权。
- 账号设置逐项分类。
- 个人中心邮箱/字符信息来源。
- 预计改动文件和禁止触碰文件。
- 明确的最小实现方案。

### Gate 1：测试闸门

没有失败测试或契约测试，不准直接声称实现可靠。

至少覆盖：

- 实例 ID 绑定。
- 多账号、多平台不串操作。
- 代理设置实例范围和持久化。
- 刷新只影响目标实例。
- 个人中心真实数据和失败状态。
- 全局设置与实例设置边界。
- 旧账号数据不丢失。
- 敏感日志不泄漏。

### Gate 2：实现审查闸门

实现完成后，必须检查：

- renderer → preload → IPC → service/store → adapter/WebView 是否完整接通。
- 有没有旧 API 绕过新契约。
- 有没有第二套账号状态。
- 有没有重复页面或重复右键菜单。
- 有没有死监听器或悬空 DOM 事件。
- 有没有误改登录恢复、WebView partition、账号存储和全局设置。

### Gate 3：真实验收闸门

必须尽可能在 Windows 真实启动并点击：

- 登录极客账户。
- 查看邮箱和字符信息。
- 右击 WhatsApp。
- 设置代理。
- 刷新 WhatsApp。
- 右击其他应用或账号。
- 确认不会串账号。
- 重启后确认状态仍然正确。
- 确认全局设置仍然工作。

无法完成的项目必须标记 `unknown`。

## 7. 冲突和停止规则

网页版 GPT 必须立即停止并报告的情况：

- 需要修改 master。
- 需要覆盖其他 agent 或用户的未提交改动。
- 不清楚一个设置是全局级还是实例级。
- 不清楚哪个模块拥有右键菜单。
- 需要新增第二套账号状态或存储。
- 需要重写登录恢复或 WebView partition。
- 需要删除旧功能才能推进，但没有迁移证据。
- 测试与实际行为矛盾。
- 只能静态推断，无法验证真实运行结果。
- 发现现有实现与产品定义冲突。

停止时状态必须写成 `blocked` 或 `unknown`，并说明阻塞证据。

## 8. 星尘给网页版 GPT 的工作指令模板

以后每次给网页版 GPT 下达新任务，使用下面格式：

```text
你是 Geek 项目的代码执行 agent。

先阅读：
1. https://github.com/9529360-cpu/geek/blob/docs/account-context-menu-scope/docs/account-and-app-context-menu-scope.md
2. https://github.com/9529360-cpu/geek/blob/docs/account-context-menu-scope/docs/agent-collaboration-handoff.md
3. 当前 origin/master

本次任务 ID：<填写>
本次唯一目标：<填写>
允许修改文件：<填写>
明确禁止修改：<填写>
完成标准：<填写>
必须提供的验证证据：<填写>

开始前：
- 先读本文档当前任务和执行日志。
- 先在本文档写 START。
- 如果范围、所有权或调用链不确定，停止并报告，不要猜。
- 不直接修改 master。
- 不清理或覆盖已有未跟踪文件。

完成一轮后：
- 把 REPORT 写回本文档。
- 记录真实命令和完整输出。
- 区分 verified、connected、unknown、blocked。
- 只提交独立分支，不自行合并 master。
- 没有真实验证就不要声称完成。
```

## 9. 执行日志

### [REPORT-000]

日期：2026-08-30
任务：建立双 Agent 协作协议
状态：accepted-for-use
作者：星尘

已完成：

- 建立角色分工。
- 定义在线文档作为唯一交接面。
- 定义当前任务 `ACCOUNT-CONTEXT-001`。
- 定义网页版 GPT 的审计优先流程。
- 定义 START/REPORT 回写格式。
- 定义状态、停止条件和四道决策闸门。

当前要求：

- 网页版 GPT 先执行 `ACCOUNT-CONTEXT-001` 的只读审计。
- 审计结果必须回写本文档。
- 在星尘或阿豪确认前，不得修改产品代码。
- 不得把文档分支或 master 当作实现分支。

等待网页版 GPT 回写：

- 实际工作分支。
- 基线 commit。
- 导航栏和右键菜单调用链。
- 账号设置迁移表。
- 个人中心数据来源。
- 最小实现方案。

### [REPORT-001]

日期：2026-08-30
任务：ACCOUNT-CONTEXT-001 第一阶段源码审计
状态：accepted-for-next-phase
作者：网页版 GPT

审计结论摘要：

- 现有导航栏账号右键菜单已经存在，唯一 owner 是 renderer/ui/app.js。
- 右键菜单通过具体 account.id 绑定目标；刷新当前直接操作 wvMap.get(accountId)。
- 现有设置页中的账号字段全部是实例级设置；全局设置应继续留在设置页。
- 个人中心信息已有真实来源：subscription state、/api/status、/api/me；不能使用 getQuota(true) 的 MAX_SAFE_INTEGER fail-open 值作为余额。
- 审计发现 HTTP 代理协议回切缺陷，以及关闭独立代理后的全局代理即时回落缺陷。
- relogin/扫码登录当前没有平台 capability，不应本阶段伪造加入。
- 删除账号和重命名已有 canonical handler，应复用。

审计完整内容已写在此前本交接文档的审计报告中；产品定义文档与 1.2.17 基线对齐。

星尘决策：审计通过，允许进入实施阶段。网页版 GPT 可以自主完成架构判断、产品实现、测试、CI 和真实验收，但不得突破本文档边界。

### [NEXT-INSTRUCTION-001]

日期：2026-08-30
任务：ACCOUNT-CONTEXT-001 Phase 2 最小实现
发布者：星尘
执行者：网页版 GPT
基线：5245a710b429cf8454682fcf437517518b77c21f

现在开始实施，不再停留在审计。你可以自主做架构判断、拆任务、写代码、写测试、修 CI、运行验证和进行 Windows 验收；但所有判断必须以审计事实和产品定义为依据，不能把需求重新解释成一个模糊 Account Center。

第一步：从精确基线 5245a710b429cf8454682fcf437517518b77c21f 创建独立实现分支，并将分支名、创建结果、工作区状态写入 START。不要在 master 或本 docs 分支实现，不要覆盖或清理未跟踪文件。

第二步：先写失败 contract/test，再实现。测试至少覆盖：

1. 右击 A 后即使 active account 切到 B，菜单 action 仍只作用 A。
2. 多平台、多账号 proxy update 不串目标。
3. HTTP/HTTPS/SOCKS4/SOCKS5 协议保存和回切正确。
4. 关闭独立代理时即时遵守“跟随全局代理”语义，而不是错误直连。
5. refreshAccountInstance(accountId) 只 reload 目标 wvMap 实例。
6. 个人中心邮箱和字符/额度来自真实 subscription state/refresh 数据。
7. 余额网络失败、无缓存或过期时显示失败/未知，不显示 MAX_SAFE_INTEGER、假 0 或假成功。
8. 实例设置 target 固定，不允许 acc-select 造成目标漂移。
9. 全局设置仍留在设置页，实例级设置迁移到右键“账号设置/设置代理”。
10. 旧入口若保留，必须调用同一个 canonical handler。
11. 账号数据、登录 token、partition、删除语义和敏感日志不回归。

第三步：按最小垂直切片实现：

- 主界面增加或整理个人中心，复用现有 subscription getState/refresh，不创建第二套账户状态。
- 保留 ui/app.js 作为 #ctx-menu 唯一 owner。
- 将“编辑应用”明确整理为当前实例的“账号设置”，固定 accountId。
- 复用现有账号更新 handler，实现实例字段编辑。
- 将代理表单的字段、校验和保存收敛到 canonical path。
- 补齐 HTTP 协议写回和独立代理关闭后的全局代理即时回落。
- 抽出唯一 refreshAccountInstance(accountId)，不新造 WebView manager 或 main-side refresh 系统。
- 不实现当前不存在 capability 的 relogin/扫码登录。
- 删除账号继续复用现有安全删除流程。

允许修改的主要范围：

- ui/index.html
- ui/app.js
- ui/settings-controller.js
- ui/settings-controller.css
- src/main.cjs（仅代理协议与全局代理回落相关）
- 直接相关的测试文件、CI 合约或必要文档

如确实需要修改范围外的文件，先在 REPORT 说明事实依据、影响、替代方案和等待确认，不要偷偷扩大范围。

第四步：实现后必须做独立审查和真实验收。不能只运行 npm test。尽可能在 Windows 实际启动并点击验证：登录、邮箱、字符、失败态、右击 WhatsApp、代理、刷新、切换其他实例、重启恢复和全局设置。无法真实验证的必须写 unknown。

第五步：完成一轮后在本文档末尾追加 REPORT，不覆盖历史。报告必须包含分支、commit、变更文件、真实命令、真实输出、测试结果、UI 验收证据、风险、未完成项和下一步。不得把 status 写成 accepted；accepted 由星尘/阿豪决定。

当前唯一任务：按上述要求完成 ACCOUNT-CONTEXT-001 Phase 2，并把工作过程写回本交接文档。

<!-- 后续网页版 GPT 的 START/REPORT 继续追加在这里，不删除任何历史。 -->

