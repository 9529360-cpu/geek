# WhatsApp 翻译发送真实客户端证据矩阵

本文件定义 Issue #526 的真实 Windows 产品证据边界。它补充 GitHub-hosted contract/Electron E2E，但**不替代 CI，也不把真实用户 profile 变成自动化 runner**。

## 目的

极客的普通 WhatsApp composer 发送与 Broadcast 走不同业务链路。Broadcast 成功只能证明对应 transport 能力可用，不能证明：

- composer -> 翻译桥 -> Translation Runtime -> Worker -> composer 回填 -> native send 的链路正常；
- translation OFF 仍是纯 native pass-through；
- 背景消息翻译不会饿死交互发送；
- WebView reload / app cold start 后发送 hook 能恢复；
- quota/auth/deadline/quality 错误能被正确分类且保持 fail-closed。

因此，任何“真实 WhatsApp 翻译发送已验证”的结论都必须来自本矩阵的 authenticated real-client 结果；synthetic test 绿色只能证明代码机制。

## 安全边界

只在维护者控制的 Windows 机器、专用测试账号/测试会话中执行。不得注册 self-hosted GitHub Actions runner，不得上传 `%APPDATA%/geek`，不得复制真实 profile 到 CI。

证据记录器：

```powershell
scripts\windows-translation-real-client-evidence.ps1
```

记录器**不会自动发送消息，也不会读取聊天正文**。操作者完成一个测试动作后，只提交枚举/布尔类别结果。

严禁记录或提交：

- 原文或译文；
- chat/contact/conversation ID；
- 电话号码、账号编号；
- Cookie、JWT、Authorization、bridge token；
- provider API key/secret；
- Windows 用户名、计算机名、原始 profile 路径；
- DevTools network dump、HAR、完整 console dump。

允许记录：

- Git revision、安装版本、仓库声明的 WA-JS 版本；
- bridge marker `present/missing`；
- send-hook `ready/waiting`；
- admission 类别；
- elapsed bucket；
- native send `none/once/multiple`；
- exactly-once / draft-recovered 的 yes/no；
- pass/fail/blocked/not-applicable。

## 前置条件

1. 使用待验证 revision 构建/安装候选版本；记录器的 revision 必须与候选一致。
2. 使用维护者控制的 WhatsApp 测试账号和测试会话；不要使用真实客户会话。
3. 测试账号应能覆盖：普通 direct chat；如当前账号支持，再覆盖 LID-backed direct chat。
4. 若测试 zero-quota / logged-out 等状态，应使用专门测试订阅状态，不修改真实用户订阅。
5. 如果需要 upgraded-profile 场景，只使用维护者持有的测试 profile 副本；不得提交 profile 文件。

## 记录命令

每完成一个 case，执行一次记录器。例如：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-translation-real-client-evidence.ps1 `
  -Case translation-off-enter `
  -Result pass `
  -BridgeMarker present `
  -SendHook ready `
  -Admission not-applicable `
  -NativeSend once `
  -ExactlyOnce yes `
  -ElapsedBucket lt-1s
```

失败时不要写自由文本。用分类字段描述，例如：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\windows-translation-real-client-evidence.ps1 `
  -Case translation-on-send `
  -Result fail `
  -BridgeMarker present `
  -SendHook ready `
  -Admission deadline `
  -NativeSend none `
  -ExactlyOnce no `
  -ElapsedBucket ge-35s `
  -FailureDomain deadline
```

默认输出目录：

```text
real-client-evidence/translation/
```

该目录只应包含脚本生成的脱敏 JSON。即使如此，也不要自动上传；由维护者先人工检查，再决定是否只摘录分类结果到 Issue/PR。

## 必测矩阵

### RC-01 Translation OFF / Enter

操作：关闭当前测试会话的发送前自动翻译，在 composer 输入无敏感测试文本后按 Enter。

通过条件：

- native send 恰好一次；
- 不等待 Geek translation queue；
- 无翻译错误提示；
- 发送行为与 WhatsApp native path 一致。

建议字段：`Case=translation-off-enter`, `Admission=not-applicable`, `NativeSend=once`, `ExactlyOnce=yes`。

### RC-02 Translation OFF / Send button

与 RC-01 相同，但使用发送按钮。用于避免只验证键盘事件路径。

### RC-03 Translation ON / exactly once

操作：启用发送前自动翻译并发送一条测试消息。

通过条件：

- 翻译成功后只提交一次 native send；
- 不出现原文和译文双发；
- 不出现重复 Enter/click 导致的第二次提交；
- elapsed 不触发 35s orphan timeout。

### RC-04 Translation failure / source recovery

使用可控的失败状态，例如测试网关故障、质量拒绝或无效测试条件；不要修改生产密钥。

通过条件：

- raw source 不被自动发送；
- composer 原始草稿可恢复；
- `NativeSend=none`；
- `DraftRecovered=yes`；
- failure domain 与实际失败类别一致。

### RC-05 Busy chat / background pressure

启用自动接收消息翻译，进入有足够可见测试消息的专用会话，让页面产生明显 background translation work，然后立即发一条 translated outgoing message。

通过条件：

- outgoing send 不应被 background work 拖到 35s orphan timeout；
- native submit exactly once；
- 若 admission 被保护性拒绝，应得到终止类别，而不是无响应等待。

注意：该 case 目前也是 #518/#520/#525 的产品级证据。未修复相应问题前允许记录 `fail/blocked`，但不得把 Broadcast 成功当作本 case 成功。

### RC-06 WebView reload

在保持登录态的测试账号上 reload WhatsApp WebView 后重新执行 translated send。

通过条件：bridge marker 与 send hook 恢复，提交 exactly once。

### RC-07 App cold start

完全退出 Geek，重新启动，在同一测试 profile 下执行 translated send。

通过条件：持久登录态正常、桥接恢复、发送 exactly once。

### RC-08 Valid quota

在有效订阅/可用额度测试状态下验证 translated send 成功。记录 `UserReadiness=valid`。

### RC-09 Zero quota

在专用测试订阅的 zero-quota 状态执行 translated send。

通过条件：

- 原文不发送；
- 分类为 quota；
- UI 给出可操作的额度提示，而不是 WhatsApp native transport 错误。

### RC-10 Logged out / expired

在测试订阅 logged-out 或 expired 状态执行 translated send。

通过条件：

- 原文不发送；
- 分类为 auth；
- 不把失败解释成 WhatsApp send failure。

### RC-11 Upgraded profile / stale config

使用维护者控制的历史测试 profile 副本，包含旧 provider/route 配置。

通过条件：当前 Translation Runtime 规范化旧配置，普通 translated send 不因 stale provider/route 直接 400 失败。

### RC-12 Direct chat

普通 direct chat translated send exactly once。记录 `Addressing=direct`。

### RC-13 LID-backed direct chat

仅当测试账号当前可获得 LID-backed 会话时执行。记录 `Addressing=lid`。不可用则 `Result=not-applicable`，不得伪造覆盖。

### RC-14 Broadcast positive control

在同一测试账号执行一条最小文本 Broadcast，确认 platform transport 正常。

这只是**正对照**：即使 RC-14 pass，也不能替代 RC-01~RC-13 的 composer 结果。

## Admission / failure 分类

记录器使用固定枚举，禁止自由文本：

- `accepted`：请求正常进入 transform；
- `bridge-capacity`：WebView bridge 保护性容量拒绝；
- `auth`：登录/会话/授权问题；
- `quota`：额度不足；
- `deadline`：端到端预算耗尽；
- `gateway`：网关/网络/上游 transport；
- `quality`：翻译输出安全/质量拒绝；
- `cancelled`：chat/composer generation 变化导致主动取消；
- `unknown`：证据不足，不能猜。

`unknown` 应触发进一步诊断，不应被改写成更“好看”的类别。

## 判定规则

一个 candidate 可以说“repository validated”，只需要相应 exact-head CI 通过。

一个 candidate 只有在本矩阵相关 case 由真实 authenticated Windows client 记录为 pass 后，才可以说“real-client proven”。

以下结论禁止混用：

- Electron E2E pass != authenticated WhatsApp pass；
- Broadcast pass != composer pass；
- gateway health pass != current-user auth/quota ready；
- structural profile evidence != message send evidence；
- LID `not-applicable` != LID pass。

## 与历史证据脚本的关系

`scripts/windows-real-client-evidence.ps1` 保留 Issue #95 的历史 1.2.8 -> 1.2.9 升级结构证据语义，不应为了当前翻译测试而修改。

本 Issue 使用独立的 `windows-translation-real-client-evidence.ps1`，避免把不同年代、不同证据等级揉成一个脚本。
