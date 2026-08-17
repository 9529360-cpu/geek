# 复刻过程关键问题记录

## Windows 正式版升级兼容：老版本 ACL 损坏迁移（2026-08-17 修复，v1.2.4 待发布）

### 症状
- 老版本（v1.2.1 曾用 `icacls <userData> /inheritance:r`）升级到 v1.2.3 后，
  `%APPDATA%\geek\diagnostics` 等子目录仍无有效 ACE（Access count=0），连 Owner 都写不了。
- v1.2.3 已让 diagnostics 写日志容错并停止使用 /inheritance:r，但**已经损坏的目录**没有被主动修复，
  老用户升级后 diagnostics 等子目录仍不可访问；启动早期写日志仍会失败（虽不致命但日志缺失）。

### 根因
- `icacls /inheritance:r` 会清空已存在子目录的 ACL（实验确认：子目录 Access count=0，连 Owner 都写不了）。
- `fs.mkdir({recursive:true})` 对**已存在**目录不会修复 ACL。
- 只给父目录 `/grant:r` 不会自动传播到已损坏的子目录。

### 修复（src/acl-repair.cjs，一次性、幂等；吸收 Issue #2 评审意见）
- 新增 `repairUserDataAcl({ userDataDir, expectedUserDataDir, username })`：
  - 路径安全：目标必须与调用方（Electron app.getPath('userData')）可信基准完全一致（防自证），
    另有 `isRejectedWideDir` 拒绝磁盘根/用户目录/AppData 根；username 空值安全失败
  - 修复范围：只修 userDataDir 本身 + REQUIRED_SUBDIRS（diagnostics），**不做全树 /T 递归**，
    避免改写 Cookies/IndexedDB/Partitions 等文件 ACL；每目标单独 `icacls <target> /inheritance:e /grant:r <user>:(OI)(CI)F /T /C`
    （恢复继承 + 当前用户文件夹/子文件夹/文件可继承的完全控制，只改权限不删数据）
  - mkdir 单独容错，失败不阻断 icacls
  - 版本化标记 `.acl-repair-v1.json`：成功才写；每次启动仍探测 diagnostics 可写，不可写则重跑
  - execFile 参数数组（空格/中文/特殊字符路径安全）；失败返回 ok:false 不抛出
- `runStartupAclRepair()` 启动前置编排：shouldRun（打包+win32）→ 修复 → 返回结构化结果，从不抛出；
  whenReady 顺序保证修复失败也继续 createWindow。
- main.cjs：whenReady 第一行先 `await runStartupAclRepair(...)` 再 `diagnostics.log('app-ready')`；
  移除旧 `hardenUserDataDir()`。
- diagnostics.cjs：log() 每次写入前 `ensureDir()` 自动重试 mkdir——ACL 修复后无需重新初始化对象即恢复日志。
- 测试：`acl-repair-contract`（单元：路径/参数/marker/幂等/空用户/可信基准/mkdir容错）、
  `acl-repair-integration-contract`（真实 icacls 修复损坏目录+数据保留+幂等+基准拒绝）、
  `acl-repair-main-integration-contract`（main.cjs 顺序契约）、
  `acl-repair-startup-behavior-contract`（修复失败/成功/非打包均继续 createWindow 的行为测试）。
- 端到端：模拟 /inheritance:r 损坏现场 → 打包版启动 → 日志 `[security] userData ACL 已修复`、
  diagnostics 可写并落盘日志、标记 v1、账号数据完整保留、主窗口正常创建。

### 坑速查
| 症状 | 原因 | 解法 |
|---|---|---|
| 升级后 diagnostics 等子目录不可写 | v1.2.1 /inheritance:r 清空子目录 ACL | 一次性 ACL 修复迁移（acl-repair.cjs） |
| fs.mkdir recursive 不修复 ACL | 已存在目录 mkdir 幂等 | 用 icacls /inheritance:e + /grant:r (OI)(CI)F /T |
| 修复只给父目录不够 | 损坏在子目录 | 递归 /T + 启动时探测可写性重跑 |

## 发布事故：正式安装包读到开发测试账号（2026-08-17 修复，v1.2.2）

### 症状
- 官网下载 1.2.0/1.2.1 安装包，装完打开主界面，出现开发期测试账号（"阿豪测试"/"测试"/"测试啊"），且默认打开对应 webview。
- 登录/注册显示"网络连接失败"（另一问题，见下）。

### 根因（两个独立问题）
1. **测试数据泄漏**：`src/runtime-paths.cjs` 的 `USER_DATA_SUBDIR` 硬编码为 `whatsapp-multi`（开发期目录名）。
   正式版启动后 userData 固定到 `%APPDATA%\whatsapp-multi`，而该目录在开发机上是 8/13-16 测试时创建的
   （含 3 个测试账号的 accounts.json）。正式安装直接读到开发残留数据。
   - 安装包本身是干净的：electron-builder.yml 已排除 `data/**`，asar 内无 accounts.json/data。
2. **订阅 API 全挂**：客户端默认 API `https://geek-subscription.9529360.workers.dev`（workers.dev 子域）
   返回 `error code: 1042`（404 + Cloudflare 脚本异常），所有注册/登录请求失败。
   同一 Worker 在自定义域 `admin.bbnba.com` 完全正常 → 是 workers.dev 子域路由未启用，
   不是 Worker 本体故障。`wrangler-subscription.toml` 缺 `workers_dev = true`。

### 修复
- `USER_DATA_SUBDIR = 'geek'`（正式版与开发目录彻底分离）；契约测试同步更新。
- `wrangler-subscription.toml` 加 `workers_dev = true` 重新部署 → workers.dev 子域恢复。
- 官网 `geek-website-worker.js` VERSION 从 1.2.0 → 1.2.2（之前官网还挂着 1.2.0 旧包）。
- 重新打包 v1.2.2 并上传 R2（latest.yml + exe + blockmap），官网部署验证通过。

### 坑速查
| 症状 | 原因 | 解法 |
|---|---|---|
| 正式版出现测试账号 | USER_DATA_SUBDIR 沿用开发目录名 | 正式版用独立目录名（geek），开发目录不动 |
| workers.dev 子域 1042 | wrangler.toml 缺 workers_dev=true | 加配置重新部署；自定义域不受影响 |
| 官网下载到旧版本 | geek-website-worker.js VERSION 没同步 | 发版时同步更新官网 VERSION 并部署 |

## LINE 扫码登录 + 重启自动恢复（2026-08-13 最终解决）

### 最终方案（照原版 line.json 机制）
原版 Hello-GPT 把 LINE 的 accessToken（JWT）**明文保存**到 `AppData/Roaming/Hello-GPT/line.json`
（`partition名 → base64(JWT)`，JWT payload 含 aud=LINE/scp=LINE_CORE/lsid 等），重启后注入页面。
复刻版等价实现（patch 扩展 main.js，3 处）：
1. **setTokenV3IssueResult**：登录成功后把 tokenV3IssueResult **明文存 localStorage**（`__stardust_line_token`）
2. **getAccessToken**：内存 token 为空时**读 localStorage 明文**（绕过解密死循环：
   getEncryptedIdentityV3 需要 token 认证、token 解密又需要它——Electron 不支持扩展 SW 导致密钥无法持久化）
3. **createSession 前不能清明文**（会把重启恢复要读的明文清掉）——登录时内存新 token 自然覆盖旧值，无需清

### 扫码成功关键（早前）
- **白色背景**：深色面板会让手机扫码器识别不了二维码（webview 强制 `background-color: rgb(255,255,255)` 对齐原版）
- **不要放大二维码**（原始尺寸即可扫，放大后扫不上）
- 原版 s3loYR.js preload + 补全：`_pluginKD`（输入框按键包装，不补聊天崩空白）、
  `_PluginT`（接收消息处理，返回原样）、`_PluginVT`（消息渲染后 no-op）、`hS()`（初始化配置）
- webRequest 监听器**必须调 callback()**（不调阻塞全部请求→页面 blank）

### 登录环境
- MV3 原版扩展 + Electron 35.5.1（原生 chrome.storage.local 支持 Promise 式）
- chrome.storage 不要 mock（Electron 原生 LevelDB 持久化更可靠）

### 验收结果（2026-08-13 用户实测）
- ✅ 双 LINE 账号（line头测试 + line2）扫码登录
- ✅ 聊天 / 发消息
- ✅ **重启后两个账号全部自动恢复**（直接进聊天页面，不用再扫码）
- ✅ WhatsApp 重启恢复（基础架构验证）
- 当前复刻进程：CDP 9344（`proc_fdbaa6d920bf`）

## 跨平台翻译回归（2026-08-16）

### 已修复
- Telegram 历史消息文本节点延迟出现时，500ms 重试原先调用 `process(row)`，会丢失 `isHistory` 并把旧历史误当实时消息；现改为 `process(row, isHistory)`。
- Telegram K 虽在账号类型与主进程白名单内，但翻译平台映射和 renderer 注入条件漏了 `telegram-k`；现与 Telegram Z 共用适配器。
- LINE Business 的扩展页面白名单、WebView 翻译桥登记、renderer 注入和 IPC 账号校验原先只接受 `line`；现普通版与商业版共用完整 LINE 加载与翻译链路。
- 新增 `test/translation-platform-contract.cjs`，锁定 Telegram K、LINE Business 和历史消息重试契约。
- LINE 重启后虽然 token 未过期、普通 API 为 200，但实时流 `/api/operation/receive` 返回 401 `REQUEST_NEED_LOGIN`。根因不是 token 失效：原生 `EventSource` 无法携带 `X-Line-Access/X-Hmac`。现增加 `GeekAuthenticatedEventSource`，复用 LINE 官方 token manager 与 HMAC sandbox，通过 Fetch SSE 携带认证头；单测与真实 `OPEN` 验证通过。
- LINE token manager 初始化现在会在安全存储为空时先恢复 `__stardust_line_token`；getter 也把空字符串视为未恢复状态，不再被 nullish 分支提前截断。

### 本轮非破坏性实测
- 极客主页面加载完成，5 个账号 WebView 全部恢复；页面源码与 UI 均无快捷话术功能入口。
- 两路 WhatsApp 页面加载完成，其中一路可见 6 个已有译文框；未执行发消息或群发。
- Telegram 登录页恢复，翻译配置、请求桥和适配器均已注入；当前没有选中聊天，所以本轮未产生新译文。
- 两路 LINE 均恢复到 `#/chats` 且本地 token 有效；认证实时流进入 `OPEN`，“网络不稳定”已消失，当前在线状态通过。
- 本地翻译网关 `/health` 返回 200，实际 POST `Hello` → `你好` 成功。

## 付费订阅体系（2026-08-16）

### 产品逻辑（用户纠正，重要）
- **Freemium，绝不强制付费**：注册即用 + 赠送 2 万字符翻译额度；额度用完翻译静默停止（不弹提示、不锁客户端），用户自行决定充值；订阅生效期翻译不限量。
- 登录门禁保留（未登录弹登录窗，登录后才能进主应用——对齐原版），但**已登录无论是否有订阅都直接进主应用**，不用订阅锁定客户端。
- 用户原话："不购买也可以正常使用，就是没有翻译能力而已；注册了账户之后就可以使用，送两万字符；购买在个人中心续费开通，不能强制客户。"

### 架构（全 Cloudflare 零成本）
- D1 数据库 `geek-subscriptions`（users 含 quota_chars 默认 20000 / subs / orders）
- Worker `geek-subscription`：`https://geek-subscription.9529360.workers.dev`
- 管理后台 `/admin`（管理员密码在桌面 服务器.txt）
- API：register/login(JWT)/me/status/quota/usage(原子扣减)/orders + admin 系列
- 套餐常量 `PLANS`（worker 顶部）：月 €9 / 季 €24 / 年 €79

### 客户端接入
- `src/subscription.cjs`：状态/额度/扣减 store（token 存 userData/subscription.json）
- `ui/subscription.html`：登录/注册/个人中心（额度/订阅/购买）/订单视图
- 翻译链路：翻译前 `getQuota`（30s 缓存）→ 不足抛 `QUOTA_EXHAUSTED`；成功翻译后 `reportUsage` fire-and-forget；UI 遇额度错误静默移除译文框
- 门禁：未登录→订阅窗口；已登录→主窗口 + 后台 refresh

### 坑
- `wrangler deploy` 不支持 `--d1` 命令行参数，必须用 wrangler.toml 配置 `[[d1_databases]]` 绑定
- D1 加列：`ALTER TABLE users ADD COLUMN quota_chars INTEGER NOT NULL DEFAULT 20000`（已有行默认值不会自动填，需 UPDATE）
- 管理接口路径取 ID 用 `split('/').filter(Boolean)` 后取 `[len-2]`，`pop()` 会拿到 `confirm`/`disable` 而非 ID
- 开发调试用 `GEEK_USER_DATA_DIR` 隔离 userData；杀 electron 测试实例要 taskkill 进程树（kill wrapper 会残留主进程）
- 额度扣减必须原子：`UPDATE ... SET quota_chars = MAX(0, quota_chars - ?)` 防并发超扣

## 正式版"窗口消失"事故（2026-08-17 修复，v1.2.3）

### 症状
- 正式安装版（1.2.2）登录成功后，主窗口不出现；任务管理器能看到进程但没有窗口、没有托盘图标。
- 用户描述"桌面上没有进程了"，实际是进程活着、窗口从未创建。

### 根因（hardenUserDataDir 弄坏子目录 ACL → 日志写入失败 → whenReady 中断）
1. `hardenUserDataDir()` 用 `icacls <dir> /inheritance:r /grant:r USER:F` 收紧权限。
   **实验证实：/inheritance:r 会把子目录 ACL 清空（Access count=0，连 Owner 都无法写入）**。
2. diagnostics 目录在模块加载时由 createDiagnostics 的 mkdirSync 创建（早于 app.setPath('userData')），
   ACL 继承链被 icacls 破坏后，`diagnostics.log('app-ready')` 写日志抛 EPERM。
3. whenReady 回调是 async 函数，第 2169 行 `diagnostics.log(...)` 抛异常 → 整个回调 reject →
   后面 `createMainWindow()`（2188 行）**从未执行** → 无窗口、无托盘，但 app 进程活着。

### 修复
- `src/diagnostics.cjs`：log() 包 try/catch，日志写入失败静默降级（绝不影响主流程）。
- `src/main.cjs` hardenUserDataDir()：去掉 `/inheritance:r`，仅 `icacls <dir> /grant:r USER:F`
  （保留继承链，子目录仍可写）；收紧前先 mkdir diagnostics 子目录。
- 用户已损坏的目录用 `icacls ... /grant:r USER:F /T /C` 递归修复。

### 坑速查
| 症状 | 原因 | 解法 |
|---|---|---|
| 进程活着但无窗口/托盘 | diagnostics 日志 EPERM → whenReady reject → createMainWindow 未执行 | log() 容错；ACL 收紧不用 /inheritance:r |
| diagnostics 目录 Access count=0 | icacls /inheritance:r 清空子目录 ACL | 用 /grant:r（不带 /inheritance:r）+ 递归修复 |
| 复现（副本目录）正常但正式版挂 | 副本用 icacls 递归修过权限 | 用真实目录/复刻用户 ACL 状态复现 |
