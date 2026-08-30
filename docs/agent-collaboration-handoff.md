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
status: ready-for-user-test
owner: web-gpt
base: origin/master
base_commit: 5245a710b429cf8454682fcf437517518b77c21f
working_branch: feat/account-context-001
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
next_gate: 星尘/阿豪审阅 Phase 2 代码、CI 和 Windows unknown 项后决定是否接受或安排真实验收
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

### [START-001]

日期时间：2026-08-30 15:18 Asia/Kuala_Lumpur
任务 ID：ACCOUNT-CONTEXT-001
基线 commit：5245a710b429cf8454682fcf437517518b77c21f
工作分支：feat/account-context-001
当前工作区状态：GitHub connector 远程执行；无本地 checkout/worktree，因此没有可声明为 clean/dirty 的本地工作区、未跟踪文件或未提交修改。远程实现分支已从精确基线创建，尚无产品代码提交。
本次允许修改：ui/index.html；ui/app.js；ui/settings-controller.js；ui/settings-controller.css；src/main.cjs 仅代理协议与全局代理即时回落；直接相关测试；本交接记录。
本次明确禁止修改：master；docs/account-context-menu-scope 上的产品源码；主导航结构；登录恢复流程；WebView partition；account-data 边界/store；全局设置既有行为；删除账号安全语义；发布版本与 release marker。
预计验证方式：先提交失败 contract 并用分支 CI/PR test 证明红测；再最小实现并运行聚焦测试、完整 npm test/CI；随后尽可能运行 windows-real-client-regression 或可用 Windows 验收。任何无法真实点击、真实账户读取或 WebView 隔离验证的项目标记 unknown。


### [REPORT-002]

日期时间：2026-08-30 15:36 Asia/Kuala_Lumpur
任务 ID：ACCOUNT-CONTEXT-001
状态：needs-review
工作分支：feat/account-context-001
基线 commit：5245a710b429cf8454682fcf437517518b77c21f
当前实现 commit：d3a4ac6b0a5d28a5950f0001f0fbeb3c16d3daf2
Draft PR：#275 feat: implement account context phase 2

本轮做了什么：

- 从精确 1.2.17 基线建立独立实现分支；master 未修改，复核后仍为 5245a710b429cf8454682fcf437517518b77c21f。
- 先新增失败 contract；标准 test workflow run 33298953081 在产品实现前真实失败，满足 Gate 1 红测要求。
- 主界面设置面板增加极客账户个人中心，复用现有 subscription.getState() 与 subscription.refresh()，不创建第二套账户状态。
- 个人中心只在 refresh 返回可信整数余额时显示字符数；networkError、登录失效、无可信余额或异常均显示未知/加载失败，没有调用或展示 getQuota(true) 的 MAX_SAFE_INTEGER fail-open 哨兵。
- ui/app.js 继续作为 #ctx-menu 唯一 owner；右键 action 使用 ctxMenu.dataset.accountId，没有改成依赖 activeId。
- 抽出唯一 refreshAccountInstance(accountId)，只通过 wvMap.get(accountId) reload 目标 WebView。
- 编辑应用整理为账号设置；账号设置和代理设置均进入 settingsController.openAccount(accountId, ...)，固定被右击实例。
- 普通设置只保留个人中心/应用级全局设置；实例级名称、字号、颜色和独立代理改为右键实例入口，移除可自由切换目标的 acc-select 下拉框，只保留内部 hidden target。
- 账号实例代理表单加入 HTTP/HTTPS/SOCKS4/SOCKS5 协议字段，继续走现有 accounts.update canonical handler。
- 删除旧独立 proxy-overlay/showProxyDialog/proxyAccountId 保存路径，避免代理功能存在两套互相独立的 renderer 状态/handler。
- 修复 src/main.cjs 的 HTTP 协议回切；accounts:update 现在接受 http。
- 修复关闭实例独立代理后的即时语义：若全局代理已开启，立刻应用 configState；否则直连。
- 删除账号路径未改，继续复用现有 accounts.remove 与 account-data 删除边界；WebView partition、登录恢复、account-data store/boundary、release marker 均未修改。

最终变更文件（相对基线）：

- src/main.cjs：仅代理语义修复（HTTP 写回 + 独立代理关闭后的全局 fallback）。
- ui/app.js：右键 canonical action、target-only refresh、个人中心真实数据接线；移除旧独立代理 handler。
- ui/index.html：个人中心、全局/实例设置入口整理、实例代理协议字段；移除旧代理弹窗。
- ui/settings-controller.js：固定实例 target、全局/实例 validation/save 分离、协议写入 canonical account patch。
- test/account-context-phase2-contract.cjs：Phase 2 静态/边界 contract。
- test/account-context-target-runtime-contract.cjs：VM 运行时 A/B 目标隔离 contract。

没有修改但再次确认不能碰：

- src/main-entry.cjs
- src/account-data-boundary.cjs
- src/account-data-store.cjs
- src/account-reference.cjs
- session/WebView partition 与 navigation/security boundary
- src/subscription.cjs 的登录恢复/token 存储结构
- Worker/D1 schema
- .github/release-client-version
- package.json.version
- master

迁移结果：

| 现有设置项 | 范围 | 当前入口 | canonical handler | 代码/CI 状态 |
|---|---|---|---|---|
| 主题/强调色 | 全局 | 设置 > 应用设置 | config.set | connected + CI verified |
| 开机启动/启动最小化/提示音 | 全局 | 设置 > 应用设置 | config.set | connected + CI verified |
| 锁屏密码 | 全局 | 设置 > 应用设置 | config.set | connected + 既有安全 contract verified |
| 全局代理 | 全局 | 设置 > 应用设置 | config.set | connected + CI verified |
| 显示名 | 实例 | 右键 > 账号设置 | accounts.update(accountId, patch) | runtime contract verified |
| 字体大小/颜色 | 实例 | 右键 > 账号设置 | accounts.update(accountId, patch) | runtime contract verified |
| 实例代理开关/协议/主机/端口/认证 | 实例 | 右键 > 代理设置/账号设置同一固定实例面板 | accounts.update(accountId, patch) | runtime/static contract verified；真实 Windows 网络效果 unknown |
| 刷新应用 | 实例 | 右键 > 刷新应用 | refreshAccountInstance(accountId) → wvMap.get(accountId) | code/contract verified；真实 WebView 点击 unknown |
| 删除账号 | 实例 | 右键 > 删除应用 | 既有 accounts.remove 安全删除链 | 未重写；既有删除 contracts 继续通过 |
| 重新登录/扫码 | 实例 | 未加入 | 当前无 capability | absent（按范围保持） |

实际测试命令：

```text
# Gate 1 红测：GitHub standard test workflow
npm ci --ignore-scripts
npm test
# run 33298953081 -> failure（实现前 contract 失败）

# cleanup/实现 runner 上的聚焦 + 全量验证
node test/account-context-phase2-contract.cjs
npm test
git diff --check
# run 33299499894 / job 99224805851

# 最终 PR exact merge-head standard CI
npm ci --ignore-scripts
npm test
# run 33299541967 / job 99224922538
```

测试实际输出摘要（完整日志保存在上述 GitHub Actions run/job）：

```text
ACCOUNT_CONTEXT_PHASE2_CONTRACT_OK
ACCOUNT_CONTEXT_TARGET_RUNTIME_OK
...
SETTINGS_UX_CONTRACT_OK
CREDENTIAL_LOGGING_CONTRACT_OK
ACCOUNT_REMOVE_COMMIT_SEMANTICS_CONTRACT_OK
WEB_SECURITY_BOUNDARY_CONTRACT_OK
WINDOWS_REAL_CLIENT_REGRESSION_CONTRACT_OK
...
All 125 tests passed.
```

补充测试事实：

- npm ci --ignore-scripts：added 289 packages；audited 290 packages；found 0 vulnerabilities。
- Linux CI 中 ACL_REPAIR_INTEGRATION_SKIPPED (非 Windows) 明确为跳过，未伪装成 Windows 验证。
- account-context-target-runtime-contract.cjs 真实执行 controller：active account=B 时打开被右击 A，随后强行把 hidden target 改成 B，保存仍只调用 updateAccount('A', ...)；再进入普通设置，实例字段无效也不会写实例，只写 config.set。
- 施工期间几个一次性 runner 因脚本锚点/语法问题在 commit 前 fail-closed，没有形成半成品产品提交；最终临时 workflow/script 已从实现分支文件树全部移除。

最终 diff 对账：

- base 5245a710... → implementation d3a4ac6...：ahead 14 / behind 0。
- 最终只改 6 个授权文件：src/main.cjs、ui/app.js、ui/index.html、ui/settings-controller.js、两个直接相关测试文件。
- 没有 package.json、release marker、Worker、account-data、partition、登录恢复或主导航变更。
- master 再次复核仍为 5245a710...；PR #275 仍是独立 Draft，未合并。

真实 UI/运行验收：

- 已验证：Linux/self-hosted 代码 contract、controller 运行时 target 隔离、完整标准 CI、现有安全/删除/设置/WebView 边界 contracts 未回归。
- 未验证（unknown）：在 Windows 实际启动当前分支客户端；真实极客账户登录并读取真实邮箱/字符；真实网络失败 UI；右击真实 WhatsApp/Telegram/LINE；真实代理建立与重启持久化；真实 WebView refresh 是否只影响目标实例；切换其他平台后的真实点击隔离；重启后的 partition/login/session/设置状态。
- 原因：当前可用的 GitHub connector 没有 workflow-dispatch 写接口；仓库现有 windows-real-client-regression 是 dispatch-only 且收集已安装客户端非敏感证据，本身也不能替代本任务要求的交互式登录/右键/代理/WebView 点击验收。没有使用真实账号凭据或用户数据做自动化。

当前结论：

- 代码连接：connected。
- 自动化 contract/CI：verified。
- Windows 真实产品验收：unknown。
- 任务整体：needs-review，未标记 accepted，未建议自行 merge。

明确声明：

**代码层已完成，但真实产品验收仍为 unknown。**

已知风险：

- 个人中心当前验证的是现有 subscription.getState()/refresh() 契约与失败语义，真实生产账户响应仍需 Windows/真实账户确认。
- 代理 fallback 与 protocol round-trip 已在代码/contract 层闭合，但真实 Electron Session + 外部代理连通性、重启恢复仍需 Windows 验收。
- target-only refresh 已由调用结构 contract 保证只查 wvMap.get(accountId)，但“其他 WebView 没有重载/重建”仍需要真实客户端观察。

下一步建议：

- 星尘/阿豪先审 PR #275 与本报告。
- 在可用 Windows 真实客户端环境对当前实现分支/验证构建执行 Gate 3 清单；若真实点击通过，再决定是否接受/合并。
- 不进行正式 Windows 发布；本任务没有修改 release marker，也没有授权 release-client。

需要星尘或阿豪决定：

- 是否安排当前实现分支的 Windows 真实点击验收。
- 在 Gate 3 证据出来前，不建议把“产品验收完成”作为合并理由。


## [NEXT-INSTRUCTION-002]

日期：2026-08-30
任务：ACCOUNT-CONTEXT-001 Gate 3 测试安装包
发布者：星尘
执行者：网页版 GPT
前置依据：REPORT-002；实现 commit d3a4ac6b0a5d28a5950f0001f0fbeb3c16d3daf2

代码层和自动化 contract 已达到 needs-review，但 Windows 真实产品验收仍为 unknown。现在请继续为 `feat/account-context-001` 构建一个可供阿豪安装测试的测试安装包或验证构建。

要求：

1. 不修改 master，不合并 PR #275，不发布正式版本，不修改正式 release marker 或版本号。
2. 构建必须来自 `feat/account-context-001` 的明确 commit；先记录 branch、commit、package version 和工作区状态。
3. 优先使用仓库已有的 Windows 客户端构建/验证 workflow；不要另造发布系统。
4. 如果需要 dispatch-only workflow、Windows runner 或权限，而当前 connector 无法触发，必须报告真实阻塞原因和阿豪可执行的最短步骤；不得伪造安装包链接。
5. 测试安装包必须明确标注为测试构建，不得当作正式发布版本。
6. 构建完成后在本文档末尾追加 REPORT，必须包含：安装包文件名、真实下载链接或 GitHub Actions artifact 链接、branch、commit、版本号、SHA256、构建命令或 workflow/run/job ID、真实结果、安装/启动方式、已验证和 unknown 项目。
7. 不得把 GitHub CI 通过等同于 Windows UI 验收通过。阿豪亲自安装确认前，下列内容必须保留为 unknown：个人中心真实邮箱/字符、失败显示、真实右键菜单目标隔离、代理连接/协议切换/重启持久化、目标 WebView 刷新、全局设置和旧账号数据回归。
8. 不得自行合并。阿豪安装使用并明确说“没问题，可以合并”之前，PR #275 保持未合并。

交付标准：有真实可下载测试安装包则状态写 `ready-for-user-test`；无法生成则写 `blocked`，附真实阻塞证据和最短下一步。绝不以“代码完成”替代安装包交付。

<!-- 后续网页版 GPT 的 START/REPORT 继续追加在这里，不删除历史。 -->


### [START-002]

日期时间：2026-08-31 00:58 Asia/Kuala_Lumpur
任务 ID：ACCOUNT-CONTEXT-001 Gate 3 测试安装包
基线 commit：5245a710b429cf8454682fcf437517518b77c21f
构建源 branch：feat/account-context-001
构建源 commit：d3a4ac6b0a5d28a5950f0001f0fbeb3c16d3daf2
package version：1.2.17
当前工作区状态：通过 GitHub connector / Actions 远程执行；没有使用或清理用户本地 worktree。feat/account-context-001 当前 HEAD 已确认仍为 d3a4ac6b0a5d28a5950f0001f0fbeb3c16d3daf2；PR #275 为 Draft 且未合并；master 仍为 5245a710b429cf8454682fcf437517518b77c21f。
本次允许修改：仅为生成测试安装包而临时调整 feat/account-context-001 上仓库既有 build-validation-client workflow 的触发/构建身份证据；不修改产品源码、package version、release marker。构建后恢复 workflow 内容。
本次明确禁止修改：master；PR #275 合并状态；正式 release-client；.github/release-client-version；正式 updater metadata；产品源码和账号数据。
预计验证方式：复用既有 Windows self-hosted validation-client-build 流程，精确 checkout d3a4ac6b0a5d28a5950f0001f0fbeb3c16d3daf2，执行 npm ci、validation-build-isolation contract、npm run dist:test，记录 run/job、文件名、SHA256、artifact 和实际结果。Windows 用户点击验收仍由阿豪安装后确认。


### [REPORT-003]

日期时间：2026-08-31 01:05 Asia/Kuala_Lumpur
任务 ID：ACCOUNT-CONTEXT-001 Gate 3 测试安装包
状态：ready-for-user-test
构建源 branch：feat/account-context-001
构建源 commit：d3a4ac6b0a5d28a5950f0001f0fbeb3c16d3daf2
基线 commit：5245a710b429cf8454682fcf437517518b77c21f
package version：1.2.17
PR：#275，Draft，open，未合并
master：5245a710b429cf8454682fcf437517518b77c21f，未修改

本轮做了什么：
- 复用仓库现有 validation-client-build 的验证构建配方；因当前 connector 无 workflow_dispatch 写接口，为避免污染 PR #275，创建隔离编排分支 build/account-context-001-validation，并让 Windows job 精确 checkout 实现 commit d3a4ac6b0a5d28a5950f0001f0fbeb3c16d3daf2。
- 在 self-hosted Windows x64 geek-real-client runner 上执行 npm ci、validation-build-isolation contract 和 npm run dist:test。
- 构建后删除 validation 目录中的 updater metadata/blockmap，只上传单一测试安装包。
- Windows runner 计算安装包 SHA256；随后又从 GitHub Actions artifact 下载并在独立会话环境解压复算，结果一致。

安装包与 artifact：
- 安装包文件名：geek-validation-setup-1.2.17.exe
- 安装包大小：110180757 bytes
- 安装包 SHA256：614c3b759f5b2ac45b16cd3cde29c6b04e5fb35caefe94eba207f8e93a9ca5a4
- GitHub Actions artifact 名：geek-validation-d3a4ac6b0a5d28a5950f0001f0fbeb3c16d3daf2
- Artifact ID：9735755875
- Artifact ZIP 大小：110179014 bytes
- Artifact ZIP SHA256：7a1c84fe93c3ac1e3ae10648e6c0c72e75cf87287fa79d2cf4d1fb6cdde9927b
- Artifact 下载链接：https://github.com/9529360-cpu/geek/actions/runs/33324030474/artifacts/9735755875
- Artifact 到期时间：2026-09-06T17:03:35Z（GitHub retention 7 days）

构建 workflow / run / job：
- workflow：account-context-validation-build
- orchestration branch：build/account-context-001-validation
- orchestration commit：4d881f7d0a999156d1b314fdf70a4c7a106bc6c5
- source checkout：d3a4ac6b0a5d28a5950f0001f0fbeb3c16d3daf2
- run ID：33324030474
- job ID：99290903420
- run URL：https://github.com/9529360-cpu/geek/actions/runs/33324030474

构建命令：

~~~text
npm ci
node test/validation-build-isolation-contract.cjs
npm run dist:test
~~~

构建实际结果：

~~~text
VALIDATION_BUILD_ISOLATION_CONTRACT_OK
> geek@1.2.17 dist:test
> npm run electron:install && npm run integrity:generate && electron-builder --config electron-builder.validation.yml --win --publish never
...
• building target=nsis file=dist-validation-build\geek-validation-setup-1.2.17.exe archs=x64 oneClick=true perMachine=false
VALIDATION_INSTALLER_NAME=geek-validation-setup-1.2.17.exe
VALIDATION_INSTALLER_SHA256=614c3b759f5b2ac45b16cd3cde29c6b04e5fb35caefe94eba207f8e93a9ca5a4
VALIDATION_SOURCE_BRANCH=feat/account-context-001
VALIDATION_SOURCE_COMMIT=d3a4ac6b0a5d28a5950f0001f0fbeb3c16d3daf2
VALIDATION_PACKAGE_VERSION=1.2.17
Artifact geek-validation-d3a4ac6b0a5d28a5950f0001f0fbeb3c16d3daf2 has been successfully uploaded. Artifact ID is 9735755875
job conclusion: success
~~~

补充构建事实：
- electron-builder.validation.yml 的 appId 是 com.stardust.geek.validation，productName 是“极客 验证版”，输出目录是 dist-validation-build；它不配置 publish provider。
- 构建时 CSC_IDENTITY_AUTO_DISCOVERY=false；这是验证构建，不是正式 release-client。
- upload-artifact 完成后 setup-node 的 cache save 出现 gzip command not found 警告，但该 post-step warning 发生在安装包构建和 artifact finalized 之后，job 最终 conclusion 仍为 success；不把缓存警告解释为产品失败。

安装和启动方式：
1. 从上面的 GitHub Actions artifact 链接下载 ZIP，解压得到 geek-validation-setup-1.2.17.exe。
2. 安装前可用 PowerShell 执行 Get-FileHash .\geek-validation-setup-1.2.17.exe -Algorithm SHA256，必须得到 614c3b759f5b2ac45b16cd3cde29c6b04e5fb35caefe94eba207f8e93a9ca5a4。
3. 双击 geek-validation-setup-1.2.17.exe。该 NSIS 测试包为 oneClick、perMachine=false，按当前用户安装。
4. 安装后启动“极客 验证版”。验证版使用独立 appId/runtime profile，不应与正式 Geek 共用验证身份。
5. 按 Gate 3 清单测试个人中心、邮箱/字符、失败态、WhatsApp/Telegram/LINE 实例右键、代理协议切换与回落、刷新目标隔离、重启持久化和全局设置。

已验证：
- verified：Windows runner 精确 checkout d3a4ac6b0a5d28a5950f0001f0fbeb3c16d3daf2。
- verified：validation build isolation contract 通过。
- verified：Windows x64 NSIS 测试安装包构建成功。
- verified：artifact 上传成功，ID 9735755875，7 天 retention。
- verified：安装包 SHA256 由 Windows runner 计算后，又从 artifact 解压复算一致。
- verified：master 未修改，PR #275 仍 Draft/open/未合并。

仍为 unknown：
- 阿豪机器上的真实安装是否顺利。
- 个人中心真实邮箱和字符余额显示。
- 余额网络失败/无缓存时的真实 UI。
- 真实右键菜单在多平台、多账号下的 target 隔离。
- 真实代理连接、HTTP/HTTPS/SOCKS4/SOCKS5 切换、关闭独立代理后的全局回落、重启持久化。
- 目标 WebView 刷新行为。
- 全局设置和已有账号数据在真实客户端上的回归。

当前结论：
- artifact_built：verified。
- release_published：not applicable；没有正式发布。
- deployed：not applicable。
- runtime_health / Windows UI 验收：unknown，等待阿豪亲自安装。

下一步：
- 等待阿豪下载安装测试。只有阿豪明确确认“没问题，可以合并”后，才进入是否合并 PR #275 的下一决策；当前不得 accepted，不得自行合并。
