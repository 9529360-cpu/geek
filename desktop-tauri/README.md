# 极客 Windows / Rust / Tauri 独立开发入口

Windows 专用独立开发版。Tauri 是桌面框架，Rust 负责本地后端；HTML/CSS/JavaScript 界面通过窄接口调用 Rust，不引入 Node sidecar 或本地 HTTP 服务。现有 Electron `src/`、`ui/`、正式版本标记、Worker 和发布流程保持不变。

## 开发与验证

需要 Windows、Microsoft C++ Build Tools（桌面 C++ 工作负载及 Windows SDK）、Rust MSVC stable、Node.js 22+ 和 WebView2 Evergreen Runtime。管理界面不运行 Node。构建需要通过根 package-lock 安装锁定的 WA-JS 平台资源；Node 组装原版 UI、平台元数据和固定 guest 适配器。

The original Geek layout is the baseline, not the previous sidebar-form prototype.
The build reuses `ui/index.html`, original CSS/fonts and platform icon data, then loads
only Tauri-specific controller modules. Original Electron files remain unchanged.
`target/ui` is rebuilt automatically by Cargo's build script; do not edit the bundle.

在仓库根目录运行：

```powershell
npm ci --ignore-scripts --omit=dev --no-audit --no-fund
node desktop-tauri/scripts/run-tests.cjs
cargo test --locked --manifest-path desktop-tauri/src-tauri/Cargo.toml
cargo run --locked --manifest-path desktop-tauri/src-tauri/Cargo.toml
# 只构建开发验证 EXE，不签名、不上传生产、不发布更新：
cargo build --release --locked --manifest-path desktop-tauri/src-tauri/Cargo.toml
```

EXE 位于 `desktop-tauri/src-tauri/target/release/geek-tauri.exe`。`tauri-windows-prototype` 在 GitHub-hosted Windows 上运行前端行为/边界测试、Rust 单元测试及 EXE 构建。源码快照、EXE 和解析得到的 Cargo.lock 分别保存在带 SHA 的短期 artifact 中。测试 EXE 不是安装包或正式发行。Cargo.lock 来自实际成功的 Windows 构建，已纳入源码。测试、Clippy 和 release 构建统一使用 `--locked`，CI 也会检查锁文件没有被重写。这锁定的是依赖解析结果，不代表编译器、SDK、WebView2 版本或二进制字节完全可复现。

## 可操作的代码路径

- 添加账号、打开、切换、刷新、关闭；WhatsApp/纯净版、Telegram Z/K、Messenger、Instagram 和自定义 Website 入口。普通网页入口不等于认证后功能已经验收。
- 按账号备注或平台搜索；右键“账号设置”中保存名称、字号和颜色，也可归档，设置内搜索和恢复。管理对象与当前活动账号分开，不能用焦点替换操作归属。
- 同一平台分组内拖拽账号排序，成功保存后更新列表，重启后保留。WhatsApp 两种入口、Telegram Z/K 分别在各自分组内排序；排序不切换、打开或关闭任何账号。
- 归档由一个 Rust 用例完成：校验归属、关闭对应页面、提交归档状态。前端不再自行串联关闭和归档命令。关闭失败不写入；保存失败不更新元数据，账号仍可重开。归档不删除浏览器数据，仍计入 20 个账号上限。
- “仅看已归档账号”中可恢复。恢复只改变归档状态，不自动打开页面，不更换 UUID 或 profile 路径。没有永久删除功能。
- Windows 系统托盘：左键恢复主窗口，右键可打开窗口或完全退出。关闭到托盘默认关闭，可在原版“设置”的桌面选项中显式启用并持久保存。托盘创建失败时不隐藏窗口；菜单退出仍关闭所有账号。
- 独立 native 子 WebView 布局和高 DPI 尺寸换算；管理界面禁用网页缩放快捷键，避免 CSS 外壳与 native 页面区域错位。账号页面的网页缩放不改变外壳布局。

LINE / LINE Business 按维护者要求暂不处理，前端和 Rust 均保持禁用。新增平台元数据继续由 `src/platform-catalog.cjs` 构建时导出，不维护第二份默认平台 URL 表。

## 账号级浏览器代理

创建账号时即可设置网络，首次打开网页前生效。已有账号在右键“代理设置”中选择跟随系统、HTTP 或 SOCKS5 后保存。“跟随系统”使用 Windows 网络设置，不承诺一定直连。HTTP/SOCKS5 支持 ASCII 主机名、规范 IP 地址（IPv6 需方括号）和 1–65535 端口；暂不支持账号密码认证、PAC、绕过列表或任意浏览器参数。

Rust 先验证固定账号和配置，再关闭该账号的页面。只有页面已从原生视图列表移除，才保存加密账号文档；不会自动重连。相同配置不关闭页面、不重复写入。关闭失败或尚未关闭时保留旧配置；保存失败则保留旧配置和可重新打开的账号。其他账号、Cookie 和 profile 归属不变。保存成功后，由用户主动点击账号重新打开。

代理在创建 WebView2 页面前传入。创建失败时不会移除代理再尝试连接。代理不通可能表现为网页网络错误；“已打开”不表示网络连通或已登录。WebView2 可能在页面关闭后仍保留原 profile 的浏览器环境；修改代理后重新打开失败时，应退出并重启开发版，不应清空 profile 或改为系统网络来掩盖失败。

这不是 VPN 或网络防火墙，不承诺覆盖 WebRTC、UDP、DNS 或浏览器的全部流量，也不修改 Windows 全局代理。已迁移的 Rust 翻译请求独立读取同一账号的代理设置；极客账户登录与主动刷新余额使用系统路由。单元和界面测试验证规则、归属、持久化和创建参数接线；实际代理连通性及平台兼容性仍属于单独的 Windows 运行验证。

## Website 账号约束

创建时填写 HTTPS 域名入口，可含路径，但不接受用户名密码、IP、本地 localhost 域、非 443 端口、query/hash 临时链接。入口保存在加密账号文档中，创建后不可修改；换站点应新建账号，不能重绑旧 profile。

每个 Website 账号只允许入口的精确 HTTPS 主机，不把其他账号的网站或所有平台域名并成全局 allowlist；后续同站正常导航允许 query/hash。跨域登录、外部弹窗和子域跳转可能被阻止，这是当前明确限制。URL 检查不是 DNS 重绑定防火墙，也不宣称拦截浏览器的所有网络请求。

## 存储与生命周期

identifier 为 `com.geek.desktop.tauri.prototype`。数据位于独立的 local app data；release 进入 `prototype/`，debug 进入 `development/<编译工作区路径 SHA-256>/`。不扫描、导入、修改 Electron userData，不打印真实路径。

`accounts.dpapi` 使用当前 Windows 用户 DPAPI 加密账号元数据和桌面设置；同目录原子替换成功后才更新权威内存。独占进程锁阻止同目录双写。损坏文件、解密失败、未知 schema 均阻止启动，不清空或明文回退。

schema 5 新增各账号的翻译策略与聊天覆盖，保留 schema 4 的字号/颜色及 schema 3 的代理设置。schema 1/2/3/4 可继续读取，缺失代理时默认跟随系统，缺失显示设置时默认 16 像素与 `#18A058`，缺失翻译策略时默认点击翻译、自动翻译关闭，账号 ID 不变；启动不会主动重写旧数据。下一次成功修改才写入 schema 5。旧开发版会拒绝更高版本，不能通过清空数据来降级。

浏览器会话由各账号 WebView2 profile 管理。DPAPI 只保护本应用的账号文档，不表示整个浏览器目录统一加密，也不防同 Windows 用户下的恶意进程。关闭页面/归档后该页面不再收消息；仅隐藏页面或主窗口是否能稳定后台收消息，留待维护者真机验收。

## 权限与模块边界

- `main.rs` / `bootstrap.rs`: 仅负责组装；`domain/` 负责纯业务规则；`application/` 负责账号事务与窗口用例；`infrastructure/` 负责加密、文件、路径适配；`desktop/` 负责 Tauri IPC、WebView2 与托盘。
- 仅本地 `shell` 获得显式账号/布局/设置命令，所有命令再次验证 sender label、父窗口和本地 origin。父窗口不能获得通配授权；第三方页面无这些权限、通用文件/Shell/eval API 或 privileged preload。
- 远程弹窗、下载和网页权限默认拒绝，不关闭沙箱或 web security。
- 窗口关闭回调不获取 Desktop 的阻塞锁，避免与等待 UI 线程的 WebView 创建命令相互等待。关闭到托盘偏好在成功落盘后才发布到运行时。
- Original dialogs first suspend native guests and resume them after closing. A failed hide blocks the dialog. Account names use textContent, never HTML interpolation.

## 测试证据范围与后续工作

前端测试包含实际 app.mjs 的 DOM 替身事件测试（搜索、管理非活动账号、改名、归档失败与恢复、托盘设置失败反馈），以及命令授权/配置边界检查。Rust 测试包含 DPAPI、损坏与未知版本 fail closed、旧 schema 兼容、落盘失败不发布状态、归档保留 profile、精确 Website 导航和托盘策略。它们不替代真实 WebView2 或真实平台账号验收。

真机验收由维护者单独安排，不作为继续开发其他功能的前置等待项。仍未迁移：Telegram 翻译/群发、回复/提及/附件的发送翻译、附件桥、注册/购买字符包、消息通知、应用整体崩溃恢复、Electron 数据迁移、安装器及自动更新。WhatsApp 群发、极客登录、接收翻译与普通文字发送翻译的实现范围见下节。托盘存在不等于已经实现新消息通知。不自动发送真实消息，不读取已有真实 profile，不发布正式客户端。

## 官方接口参考

- https://v2.tauri.app/start/prerequisites/
- https://v2.tauri.app/security/capabilities/
- https://v2.tauri.app/learn/system-tray/
- https://docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html
- https://docs.rs/tauri-build/latest/tauri_build/struct.AppManifest.html
- https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata

子 WebView 使用 `unstable` feature，Tauri 与 tauri-build 固定精确版本；升级需重新检查生命周期、权限和平台兼容性。实际编译/测试状态以对应提交的 CI 为准。

## Foundation architecture and contribution rules

Read [ARCHITECTURE.md](ARCHITECTURE.md) for state ownership, dependency direction,
IPC/thread/storage boundaries and future feature integration. The local [AGENTS.md](AGENTS.md)
contains mandatory engineering rules. Every handwritten file is limited to 3000 physical
lines (comments/blanks included); review splitting at 500. Generated Cargo.lock is not source.

The frontend is split into app/controller/view/model and one narrow API gateway. Rust uses
domain/application/infrastructure/desktop layers; main/bootstrap only compose them.
Archive is now a single Rust-owned use case, not a frontend multi-command transaction.

```powershell
node desktop-tauri/scripts/run-tests.cjs
cargo fmt --manifest-path desktop-tauri/src-tauri/Cargo.toml -- --check
cargo clippy --locked --manifest-path desktop-tauri/src-tauri/Cargo.toml --all-targets -- -D warnings
```

The Node entrypoint checks line limits, architecture boundaries and the canonical
`contracts/commands.json` against native commands, registration, permissions and the
frontend gateway before discovering all tests. Windows Rust tests also exercise lifecycle
and persistence failures with fake ports; they do not claim real account acceptance.

## UI parity and current adaptation boundaries

The original sidebar, platform-family tabs, toolbar, app-center account dialog,
account context menu, name/proxy dialogs and settings remain the UI baseline.
Window minimize/maximize/close/drag use typed Rust commands; native guest geometry
tracks the actual chat container and is suspended while a modal/menu is open.

Wired paths: create 1-10 accounts with proxy, switch accounts/families, save account
name/font/color, drag reorder within a family, reload, close, archive, search/restore,
tray preference, native window controls, WhatsApp broadcast, Geek login/quota,
WhatsApp incoming-message translation and plain-text outgoing translation with
account/chat settings and an independent SendIntent owner.
Not yet wired: restart/lock, registration/purchase, theme/startup options, notes,
Telegram translation/broadcast, rich-context outgoing translation and attachments.
Those original controls are disabled with unavailable guidance, not removed or
pretended to work. LINE remains disabled. Visual parity is not full feature parity.

`test/ui-parity.test.mjs` checks original main markup and byte-identical styles,
removal of Electron scripts/inline handlers and the measured viewport contract.
Other shell tests exercise actual migrated controllers against synthetic native
responses. These do not replace original-vs-migrated screenshots or real WebView2
runtime checks. See UI-PARITY.md for the durable migration requirement.

## Application center batch creation

The original quantity field accepts 1-10 accounts per operation. Rust generates names
using the original rule (custom base plus a suffix for multiple accounts, or platform
name plus its existing count), validates every final name, and saves one candidate.
Invalid count/name/URL/proxy, exceeding the 20-account limit including archives, or
failed persistence leaves the whole batch uncommitted. No profiles are opened while
saving; each created account has a distinct UUID and profile path.

The response identifies the created IDs explicitly. Only the first is opened after
save, as in the original desktop; the others stay closed until selected. Failed native
activation does not roll back saved accounts or retry creation, and the UI reports
that the accounts are saved so users can reopen them instead of adding duplicates.
The older single-create command remains compatible and uses the same transaction owner.
No Electron profiles are imported. This is not proof of real platform login/reception.

## Account display and order

The original account settings dialog saves name, integer font size (10-28), and
`#RRGGBB` color as one transaction. New and older accounts default to 16 and
`#18A058`; colors are normalized to uppercase on save. Invalid input or a failed
save leaves every prior field intact, and the dialog retains the user's draft.
The account being edited remains fixed even when another account is active.
The older rename command remains compatible and preserves display preferences.

Drag an account onto another in the same visible family to reorder: downward moves
after the target, upward moves before it. Rust resolves both IDs against the current
document rather than accepting an index or an entire renderer-owned account array.
Archived, unknown, and cross-family targets are rejected. External drag payloads
are ignored. A successful save is required before the UI changes order; failure
does not retry the move automatically. UUIDs, profiles, active selection, proxy
settings, and open/closed guest state are preserved. No extra ordering store is used.

## WhatsApp 群发

原入口与四步工作台已接通 WhatsApp / 纯净版的文本、联系人和群选择、变量及随机版本、电子名片、文本消息中的 @全体、即时与定时任务。随机间隔在界面及原生入口均限定为 5–60 秒。联系人目录来自该账号的已登录页面，名字与目标在 Rust 创建任务时冻结；切换当前账号不会改变发送归属。只支持普通用户 Wid（`@c.us` / `@lid`）与普通群（`@g.us`），不把频道、状态广播或社区父群当作联系人。缺失姓名不能用聊天 ID 冒充变量值，成员数据不完整时不降级成部分 @全体。

一个账号只能执行一个任务，其他任务排队；不同账号最多四个 worker 并发，每个 worker 每次只处理一个目标。当前账号任务条和全部账号任务中心可暂停、继续、停止并查看结果。任务条显示前先依据实际高度缩小原生聊天区域，避免 native WebView 覆盖操作按钮。关闭、刷新、修改代理或归档账号会撤销该 guest 的代次，并停止其未结束任务，包括定时任务。

发送前把目标与展开后的文本写入 `broadcast.dpapi` 检查点，再通过单次提交闸门调用该账号的固定平台适配器。仅真实平台消息 ID 和 ACK≥1 计入确认；超时、回执缺失、部分发送或提交后异常均进入“结果不确定”并暂停，不能因重启或继续自动重发。暂停发生在提交前则保留当前目标与文本。平台未就绪时整任务暂停，避免把剩余对象依次算作失败。停止只阻止后续操作，不能撤回已提交消息。

任务存储由独立 Rust owner 管理，沿用现有 DPAPI、原子替换和应用进程锁；不在账号 Workspace 锁内等待网页、回执或间隔。创建请求 UUID 去重，迟到创建响应或重试不会生成第二个任务。未确认的发送检查点在恢复后记录为 uncertain 并跳过；曾执行任务需要人工核对后继续，未开始的即时队列也不自动发送。未开始的定时任务恢复后可到点准备，但应用必须运行且对应账号页面需要就绪；不会后台自动打开所有账号。到点账号未就绪最多准备 20 次，之后显示明确失败。

每个任务最多 2000 个对象，最多保留 100 条完整任务，整个明文任务文档小于 2 MiB。达到记录数上限后只回收已明确关闭的终态记录，同时持久保留其 UUID（最多 10000 条），防止旧创建请求重新发送。未关闭的历史或达到存储上限会明确拒绝创建。附件、Telegram 原生输入、失败 CSV 导出、外部导入及未接通的高级选项仍保留原位置并标明不可用。

平台桥只执行打包的命名语义调用，未向页面开放脚本、路径、密钥或 native IPC。构建复用原版 capability/adapter/safety 纯合同及锁定的 WA-JS，附带依赖许可和输入哈希。异步结果经有界 mailbox 返回；原生使用单调时钟期限，取消或导航会使旧 mailbox 和准备结果失效。每个 document 的 attempt ID 单次使用，达到有界容量则拒绝继续，不丢弃旧凭据来允许重放。

离线 VM、真实控制器、并发 Rust 替身和 Windows DPAPI 测试覆盖上述边界；浏览器截图与严格 CSP 测试只证明外壳联动，不能代替真实 WhatsApp / WebView2 发送验收。开发验证不登录客户账号、不发送真实消息。

## 极客登录与 WhatsApp 接收翻译

个人中心复用原登录界面，已接通邮箱/密码登录、账户号、余额查询与退出。登录响应必须与 `/api/me` 返回的身份一致，凭据成功写入独立 `session.dpapi` 后才发布会话。登录 token 和翻译短 token 均仅由 Rust 持有，不回传 shell 或远程页面；密码在命令入口和服务入口使用清零包装，界面提交后立即清空密码字段。注册、购买字符包等入口仍标明尚未迁移。

余额与扣费以既有订阅/翻译 Worker 为准，不本地扣减、不额外调用 usage 接口。余额授权有 30 秒单调时钟有效期，重启后的磁盘余额只作显示；缓存译文仍需有效会话与新鲜正余额。翻译成功返回 `remaining_chars: null` 时保留成功译文，同时撤销余额授权并显示待确认。成功后的余额镜像保存失败不会把已计费译文变成可重复执行的失败。退出保存失败不假称已经退出；服务端明确拒绝当前身份时，即使本地清除保存失败，也立即阻止后续授权并取消旧工作。

原工具栏翻译设置支持账号独立的接收模式、源/目标语言、群聊自动翻译、点击/右键入口、译文显示、线路、字号颜色及当前聊天覆盖。整个账号的设置共用 revision，旧面板不能覆盖新修改；写盘失败保留原配置和界面草稿，重试须由用户发起。保存不改变账号 UUID、代理或浏览器 profile。

WhatsApp / 纯净版支持“点击翻译”和右键翻译当前可见消息，以及新收到消息的自动翻译。进入聊天、开启自动模式或重新显示账号时，已在页面上的消息按历史处理，只提供手动入口。自动请求只接收 WA-JS 元数据确认的入站消息，检查当前激活时间和群聊许可；目标中文时，已有汉字的消息按原规则跳过自动翻译。方向/时间未知、自己的消息和旧历史不会自动提交。译文只能写回同一账号、文档、会话、策略 revision、聊天、消息 ID、正文及当前 DOM 节点；聊天虚拟列表复用节点时不能挂入旧译文。

执行层最多两个并发 worker、八条等待任务，手动请求优先，排队/取 token/HTTP/409 查询共用 35 秒期限。账号关闭、重载、导航、切聊天、隐藏、修改策略或退出会话均撤销对应工作；取消不能撤回服务端已收到的请求。每个逻辑请求冻结 UUID、文本、语言、线路和账号代理。只有 `request_in_progress` 可在原期限内查询同一请求；短 token 失效最多更新一次并保持原 ID。不确定网络错误不自动新建请求，点击重试查询同一次结果。显式“重新翻译”才创建新请求并跳过本地缓存，可能重新计费。

同一登录会话内，只改字号、颜色、开关或其他聊天设置时，取消旧 revision 的等待，但仍保留当前消息的请求编号和已完成译文，普通点击继续查询原请求。只有源/目标语言、供应商或线路等翻译语义改变，才为受影响的聊天建立新意图。

复用原 `src/translation-output-safety.cjs` 校验译文，保留数字、链接和问句等保护，使用 `textContent` 挂载。已成功但未通过质量校验的结果不会形成普通点击重试循环，右键提供明确重新计费的重译入口。完成缓存仅在内存中保存，最多 256 项/1 MiB/15 分钟，按会话、账号、聊天、消息和翻译参数隔离；不宣称重启后保留译文或请求去重记录。

翻译 HTTP 请求使用账号保存的 HTTP/SOCKS5/系统路由。系统模式通过 Windows `GetProxyConfigurationAsync` 对固定服务 URL 解析 PAC/WPAD/系统设置，使用返回的首个代理；仅无代理且系统明确允许时直连。解析或连接失败不会偷偷换代理或直连。独立 HTTP 客户端禁用环境代理覆盖、重定向和底层自动重试，SOCKS5 的目标 DNS 在代理侧解析。这里没有客户代理实连或 Windows PAC 真机验证的声明。

接收翻译 owner 没有发送或修改输入框的能力。Telegram 翻译仍未迁移。测试使用合成账户和响应，不访问真实订阅或计费服务；实际 Windows/WebView2、WhatsApp 登录与服务联调由维护者另行验收。

接口来源：仓库的 `scripts/geek-subscription-worker*.js`、`scripts/geek-translate-worker.js`；系统代理参考 [Windows ProxyConfiguration](https://learn.microsoft.com/en-us/uwp/api/windows.networking.connectivity.proxyconfiguration) 与 [GetProxyConfigurationAsync](https://learn.microsoft.com/en-us/uwp/api/windows.networking.connectivity.networkinformation.getproxyconfigurationasync)；HTTP 行为参考 [reqwest 0.13.5 ClientBuilder](https://docs.rs/reqwest/0.13.5/reqwest/struct.ClientBuilder.html)。

## WhatsApp 普通文字发送翻译与 SendIntent

原翻译面板的发送开关、源/目标语言、包含中文和当前聊天覆盖已接通。开启后，由真实 Enter 或原发送按钮发起一次翻译并发送，不增加二次确认模式；关闭后使用 WhatsApp 原生发送行为。包含中文关闭且正文含汉字时，沿用原规则发送原文，这条 identity 路径不要求极客登录或翻译余额。

`application/send_intent` 独立拥有请求 UUID、账号/文档/会话、聊天、输入内容和 composer revision；`send_runner` 最多一个实际 worker 和一条等待任务，与接收翻译的队列分离。总期限为 50 秒，翻译子步骤最多 35 秒且不能延长总期限。隐藏账号、打开覆盖弹窗或切换账号会撤销原生 presentation lease；重新显示不会恢复旧任务，也不改变账号/文档 identity 或后台群发归属。关闭、重载、导航、退出会话和策略变更也会阻止旧任务继续提交。

这一批只接普通文字。翻译前及提交前都核对 WhatsApp 模型、输入框节点、文本、聊天、策略和 revision；回复/引用、提及、附件/说明、编辑/转发、预览或无法识别的富内容会明确拦住，保留草稿。翻译是独立 transform，使用固定 `outgoing-send` 服务意图和原请求 UUID；翻译错误或质量不合格不会降级发送原文。显式重试可恢复同一请求和已成功取得的译文，旧 attempt 不能提交或覆盖新 attempt。改变正文、登录会话或实际翻译参数才建立新请求；仅改外观或其他聊天设置不会创建新计费编号。

提交使用锁定 WA-JS 的显式聊天目标和单次许可，不写入译文再模拟 Enter。禁用隐式提及和链接预览，只接受真实消息 ID 与 ACK≥1。原草稿保留至确认；清空前再次比较聊天、模型、输入框、正文和 revision，用户已输入新内容则保留。清空失败仍显示已发送，不把消息变成可重试失败。回执丢失、提交后取消或结果不明进入 uncertain，不自动重发；原草稿未修改时，即使关掉翻译开关，也继续阻止重复发送，需先核对聊天记录。

请求历史和已完成译文只在内存中保留，不宣称重启后恰好一次发送。原生最多 20000 条请求记录，待用译文与预留合计最多 2 MiB；每个页面最多 128 条意图，正文/译文及预留限制为 2 MiB。已确认清空或经用户编辑释放的终态会释放正文和 DOM 引用，保留提交凭据；达到页面记录上限会提示手动重新打开该账号页面，不驱逐旧凭据后允许重放。测试覆盖合成浏览器输入、同源 Rust 状态机和取消竞态；真实 WhatsApp 服务回执、Windows 输入法与付费服务联调仍需维护者真机验收。
