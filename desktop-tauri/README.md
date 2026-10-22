# 极客 Windows / Rust / Tauri 独立开发入口

这是 Windows 专用迁移原型，不是 Electron 替代发行版。现有 `src/`、`ui/`、根 package/version、正式 release marker 和生产发布流程不变。Tauri 是桌面框架，Rust 负责本地后端；界面使用 HTML/CSS/JavaScript，通过窄接口调用 Rust。不引入 Node sidecar 或本地 HTTP 服务。

## 开发与验证

需要 Windows、Microsoft C++ Build Tools（桌面 C++ 工作负载和 Windows SDK）、Rust MSVC stable、Node.js 22+ 和 WebView2 Evergreen Runtime。前端没有 npm 依赖或构建步骤，Node 仅用于构建时导出仓库已有平台元数据。

在仓库根目录运行：

```powershell
node --test desktop-tauri/test/frontend.test.mjs
cargo test --manifest-path desktop-tauri/src-tauri/Cargo.toml
cargo run --manifest-path desktop-tauri/src-tauri/Cargo.toml
# 只构建开发验证 EXE，不签名、不上传生产、不发布更新：
cargo build --release --manifest-path desktop-tauri/src-tauri/Cargo.toml
```

EXE 位于 `desktop-tauri/src-tauri/target/release/geek-tauri.exe`。`tauri-windows-prototype` CI 在 GitHub-hosted Windows 上运行前端边界测试、Rust 单元测试和 EXE 构建；artifact 中的 EXE 不是安装包，也不是正式客户端发布。第一轮依赖解析会生成 Cargo.lock；该锁文件必须经过构建验证后提交，随后使用 `--locked`。在锁文件纳入分支之前，不宣称可复现构建。

## 已接入的代码路径

- Rust 创建账号、校验平台和账号 ID；JSON 状态经过当前 Windows 用户 DPAPI 加密，同目录原子替换成功后才更新内存。
- 同一运行目录有进程锁；损坏文件、DPAPI 解密失败和未知 schema 均阻止启动，不静默清空或明文回退。
- 每个账号独立 WebView2 data directory；按需打开、切换、刷新、关闭。切换仅改变可见性，不改变账号与数据目录绑定；关闭页面保留持久数据。启动恢复账号列表，不自动连接全部远程账号。
- 侧栏账号管理、页面标题、原生子 WebView 布局和高 DPI 尺寸换算。平台地址由 `src/platform-catalog.cjs` 在构建时导出，避免维护第二份 URL 表。
- WhatsApp/纯净版、Telegram Z/K、Messenger、Instagram 的普通网页入口。入口存在不等于真实账号登录、收发、附件、重启恢复或后台收消息已经验证。

## 安全与数据边界

Tauri identifier 为 `com.geek.desktop.tauri.prototype`。运行数据位于该应用独立的 local app data 中；release 模式进入 `prototype/`，debug 模式进入 `development/<编译工作区路径的 SHA-256>/`。不扫描、不导入、不修改 Electron userData。不同 debug checkout 的目录不同，不保存或打印工作区路径。

`accounts.dpapi` 只存账号 ID、备注和平台，不存 Cookie、聊天正文、翻译供应商密钥或浏览器认证 token。浏览器会话由各账号 WebView2 profile 管理；DPAPI 保护账号元数据，不表示整个浏览器目录由本应用统一加密。DPAPI 也不防同一个 Windows 用户下的恶意进程。

仅本地 `shell` WebView 获得六个显式命令权限，不能用父窗口 `main` 的通配授权代替。所有命令还验证原生 sender label、父窗口和本地精确 origin。远程页面无文件/Shell/eval API，无 privileged preload。导航仅允许对应账号平台的 HTTPS 主机，拒绝跨平台、凭据 URL、自定义端口和本地页面。网页弹窗、下载和权限请求一律拒绝；不关闭沙箱或 web security。

本阶段没有删除账号功能，避免未经验证就删除浏览器数据；“关闭页面”不是退出登录。页面关闭后不会继续接收该账号消息。隐藏页面能否持续接收消息仍须真实 Windows 验证。

## 明确尚未完成的部分

LINE/LINE Business 扩展适配、自定义 Website、账号级代理、Electron 数据迁移、翻译/订阅/群发/附件桥、通知/托盘、崩溃恢复、安装器、签名和自动更新均未接入。LINE 在 UI 与 Rust 两侧拒绝启用；不得把扩展能加载等同于认证后收发可用。远程下载、网页权限和弹窗禁用会影响部分平台功能，这是当前原型的明确限制，不应通过关闭安全边界绕过。

后续优先验证：两个同平台账号的 Cookie/IndexedDB/service worker 隔离；关闭和重启后的独立恢复；缩放/切换/失败回滚；真实后台收消息；LINE MV3 完整认证链；随后接入翻译与发送 owner。首次普通网页登录仅由维护者手动进行，不自动发送消息，不读取已有真实 profile。

## 官方接口参考

- https://v2.tauri.app/start/prerequisites/
- https://v2.tauri.app/security/capabilities/
- https://docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html
- https://docs.rs/tauri-build/latest/tauri_build/struct.AppManifest.html
- https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata

子 WebView API 使用 Tauri `unstable` feature，因此 Tauri 与 tauri-build 使用精确版本；升级必须重新验证生命周期、权限和真实平台兼容性。测试与构建结果以当前提交的 CI 为准，不以本说明宣称通过。
