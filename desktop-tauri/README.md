# 极客 Windows / Rust / Tauri 独立开发入口

Windows 专用独立开发版。Tauri 是桌面框架，Rust 负责本地后端；HTML/CSS/JavaScript 界面通过窄接口调用 Rust，不引入 Node sidecar 或本地 HTTP 服务。现有 Electron `src/`、`ui/`、正式版本标记、Worker 和发布流程保持不变。

## 开发与验证

需要 Windows、Microsoft C++ Build Tools（桌面 C++ 工作负载及 Windows SDK）、Rust MSVC stable、Node.js 22+ 和 WebView2 Evergreen Runtime。前端没有 npm 依赖或打包步骤，Node 在构建时导出仓库的平台元数据。

在仓库根目录运行：

```powershell
node desktop-tauri/scripts/run-tests.cjs
cargo test --manifest-path desktop-tauri/src-tauri/Cargo.toml
cargo run --manifest-path desktop-tauri/src-tauri/Cargo.toml
# 只构建开发验证 EXE，不签名、不上传生产、不发布更新：
cargo build --release --manifest-path desktop-tauri/src-tauri/Cargo.toml
```

EXE 位于 `desktop-tauri/src-tauri/target/release/geek-tauri.exe`。`tauri-windows-prototype` 在 GitHub-hosted Windows 上运行前端行为/边界测试、Rust 单元测试及 EXE 构建。源码快照、EXE 和解析得到的 Cargo.lock 分别保存在带 SHA 的短期 artifact 中。测试 EXE 不是安装包或正式发行。Cargo.lock 尚未提交；当前 release 构建使用本次测试阶段生成的锁文件，不能据此宣称跨运行可复现构建。

## 可操作的代码路径

- 添加账号、打开、切换、刷新、关闭；WhatsApp/纯净版、Telegram Z/K、Messenger、Instagram 和自定义 Website 入口。普通网页入口不等于认证后功能已经验收。
- 按账号备注或平台搜索；“管理”中改名、归档和恢复。管理对象与当前活动账号分开，不能用焦点替换操作归属。
- 归档由一个 Rust 用例完成：校验归属、关闭对应页面、提交归档状态。前端不再自行串联关闭和归档命令。关闭失败不写入；保存失败不更新元数据，账号仍可重开。归档不删除浏览器数据，仍计入 20 个账号上限。
- “仅看已归档账号”中可恢复。恢复只改变归档状态，不自动打开页面，不更换 UUID 或 profile 路径。没有永久删除功能。
- Windows 系统托盘：左键恢复主窗口，右键可打开窗口或完全退出。关闭到托盘默认关闭，可在“桌面设置”中显式启用并持久保存。托盘创建失败时不隐藏窗口；菜单退出仍关闭所有账号。
- 独立 native 子 WebView 布局和高 DPI 尺寸换算；管理界面禁用网页缩放快捷键，避免 CSS 外壳与 native 页面区域错位。账号页面的网页缩放不改变外壳布局。

LINE / LINE Business 按维护者要求暂不处理，前端和 Rust 均保持禁用。新增平台元数据继续由 `src/platform-catalog.cjs` 构建时导出，不维护第二份默认平台 URL 表。

## Website 账号约束

创建时填写 HTTPS 域名入口，可含路径，但不接受用户名密码、IP、本地 localhost 域、非 443 端口、query/hash 临时链接。入口保存在加密账号文档中，创建后不可修改；换站点应新建账号，不能重绑旧 profile。

每个 Website 账号只允许入口的精确 HTTPS 主机，不把其他账号的网站或所有平台域名并成全局 allowlist；后续同站正常导航允许 query/hash。跨域登录、外部弹窗和子域跳转可能被阻止，这是当前明确限制。URL 检查不是 DNS 重绑定防火墙，也不宣称拦截浏览器的所有网络请求。

## 存储与生命周期

identifier 为 `com.geek.desktop.tauri.prototype`。数据位于独立的 local app data；release 进入 `prototype/`，debug 进入 `development/<编译工作区路径 SHA-256>/`。不扫描、导入、修改 Electron userData，不打印真实路径。

`accounts.dpapi` 使用当前 Windows 用户 DPAPI 加密账号元数据和桌面设置；同目录原子替换成功后才更新权威内存。独占进程锁阻止同目录双写。损坏文件、解密失败、未知 schema 均阻止启动，不清空或明文回退。

schema 2 新增归档、Website 入口和桌面设置。读取 schema 1 时使用安全默认值并保留原账号 ID，不在启动时重写文件；下一次成功修改才写 schema 2。旧开发版遇到 schema 2 会拒绝启动，不应要求它忽略版本或重置文件。

浏览器会话由各账号 WebView2 profile 管理。DPAPI 只保护本应用的账号文档，不表示整个浏览器目录统一加密，也不防同 Windows 用户下的恶意进程。关闭页面/归档后该页面不再收消息；仅隐藏页面或主窗口是否能稳定后台收消息，留待维护者真机验收。

## 权限与模块边界

- `main.rs` / `bootstrap.rs`: 仅负责组装；`domain/` 负责纯业务规则；`application/` 负责账号事务与窗口用例；`infrastructure/` 负责加密、文件、路径适配；`desktop/` 负责 Tauri IPC、WebView2 与托盘。
- 仅本地 `shell` 获得九个显式账号/布局/设置命令，所有命令再次验证 sender label、父窗口和本地 origin。父窗口不能获得通配授权；第三方页面无这些权限、通用文件/Shell/eval API 或 privileged preload。
- 远程弹窗、下载和网页权限默认拒绝，不关闭沙箱或 web security。
- 窗口关闭回调不获取 Desktop 的阻塞锁，避免与等待 UI 线程的 WebView 创建命令相互等待。关闭到托盘偏好在成功落盘后才发布到运行时。
- 管理和编辑在侧栏完成，不用会被 native 子 WebView 遮挡的网页模态层；账号名称使用 textContent，不拼接 HTML。

## 测试证据范围与后续工作

前端测试包含实际 app.mjs 的 DOM 替身事件测试（搜索、管理非活动账号、改名、归档失败与恢复、托盘设置失败反馈），以及命令授权/配置边界检查。Rust 测试包含 DPAPI、损坏与未知版本 fail closed、旧 schema 兼容、落盘失败不发布状态、归档保留 profile、精确 Website 导航和托盘策略。它们不替代真实 WebView2 或真实平台账号验收。

真机验收由维护者单独安排，不作为继续开发其他功能的前置等待项。仍未迁移：账号代理、翻译/订阅/群发/附件桥、消息通知、崩溃恢复、Electron 数据迁移、安装器及自动更新。托盘存在不等于已经实现新消息通知。不自动发送真实消息，不读取已有真实 profile，不发布正式客户端。

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
cargo clippy --manifest-path desktop-tauri/src-tauri/Cargo.toml --all-targets -- -D warnings
```

The Node entrypoint checks line limits, architecture boundaries and the canonical
`contracts/commands.json` against native commands, registration, permissions and the
frontend gateway before discovering all tests. Windows Rust tests also exercise lifecycle
and persistence failures with fake ports; they do not claim real account acceptance.
