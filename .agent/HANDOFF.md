# Geek Agent Handoff

Updated: 2026-08-30

## 当前施工现场

- Repository: `9529360-cpu/geek`
- 正式基线：`master@34ecd10bf6aec8244eb99eb59a1f0ea7e4e7ecf8`
- `package.json.version`: `1.2.17`
- `.github/release-client-version`: `1.2.17`
- 本轮未修改版本号或 release marker，未触发新的正式 `release-client`，未做真实客户端回归。
- 最近一次正式客户端发布仍是 1.2.17：`release-client` run `33290618930`。

## 本轮完成

### PR #267 — R2 正式产物完整 hash 验证

- merge: `bc758a76831d72ffb0772a93be0a89a4a90a6f49`
- 正式 `release-client` 在 R2 promotion 后，不再只检查 `latest.yml` 和安装包/blockmap 是否可访问。
- 新增 `scripts/release-public-integrity.cjs`：完整 GET 公网 installer、blockmap、`latest.yml`，逐字节计算 SHA-256，并与本次 `dist-release/release-manifest.json` 的 size/hash 对比。
- 任一文件大小或 SHA-256 不一致即 fail closed，并进入既有 release rollback 路径；GitHub Release mirror 只有在该校验通过后才执行。
- exact-head PR `test` run `33292316980`: success。
- merge 后 `master` test run `33292441508`: success。
- path-filter `deploy-release-worker` run `33292441476`: success；这是 updater Worker 自动部署，不是客户端发布。
- 新完整 hash 校验尚未经过下一次正式客户端发布的生产执行；第一次未来正式 release 才能提供这一级生产证据。

### PR #268 — accounts:add 未知 type fail closed

- merge: `516d53622954379c0c1d3c5ebc01665d3c083e88`
- 旧逻辑对显式未知 `type` 会静默回退成 WhatsApp。现在只有调用方完全省略 `type` 时保留历史 WhatsApp 默认；显式未知/空类型直接拒绝。
- 当前未接通的 `website` 不再被误创建为 WhatsApp；是否正式支持 website 或删除 dormant 分支仍由 #230 单独决定。
- 不修改 WA/TG/LINE transport、WebView 登录态或发送逻辑。
- 第一次 PR CI 因 `session-partition-compat-contract` 过度绑定源码写法而失败；修正 contract 后 exact-head `test` run `33292406829`: success。
- merge 后 `master` test run `33292471333`: success。
- 该修复属于客户端代码；已安装用户要真正获得修复，需要未来另一次经人工授权的正式客户端发布。

### PR #269 — GitHub Release mirror fail-closed hardening

- merge: `27819bec7292964f88a7669f736b42b19385cdf3`
- 同版本已有 GitHub tag 时，必须解析到本次正式 release 的精确 `GITHUB_SHA`；wrong-tag provenance 直接失败。
- 发布前/发布后都拒绝重复或额外 asset；已发布 Release 缺少预期 asset 时不偷偷修改；hash/size 不一致失败。
- draft 上传失败或 GitHub API 失败时不会 publish 半成品 Release。
- workflow 既有语义不变：GitHub mirror 是 R2 成功后的非权威镜像，mirror-only failure 不回滚已验证成功的 R2 production release。
- exact-head PR `test` run `33292391460`: success。
- final `master` push test run `33292478411`: success。

### PR #271 — Geek 个人中心与登录闭环整理

- merge: `34ecd10bf6aec8244eb99eb59a1f0ea7e4e7ecf8`
- 不改主导航布局；现有设置面板整理为 `个人中心 / 应用设置`。
- 原平台 `账号设置` 不再作为普通设置 tab 展示；左侧具体 WA/TG/LINE 账号右键的 `编辑应用` 改为 `账号设置`，继续复用原显示名、字体和独立代理表单；右键里重复的独立 `代理设置` 入口移除。
- 新个人中心显示 Geek 邮箱、账号号、翻译字符余额、字符包购买、最近订单、密码重置、退出 Geek 登录。
- 字符余额文案明确仅影响翻译；0 字符不锁 WhatsApp / Telegram / LINE。
- 主窗口新增受限 account-center IPC：可读取当前登录用户自己的订单；密码重置只能打开固定官方 `https://geek.bbnba.com/forgot-password`，没有向 renderer 暴露任意外链打开能力或订阅 token。
- 登录页新增 `忘记密码？`；登录/注册成功后的旧页面 reload 会检测本地 Geek 登录态并直接进入主客户端，不再停留在“剩余字符 / 购买字符 / 进入极客”的中间页。
- 第一次 exact-head CI run `33293557766` 因旧 `ui-runtime-version-contract` 的极简 fake DOM 不支持 `document.querySelector` 而失败；没有弱化旧测试，改为让版本标签逻辑与可选浏览器 UI 增强隔离。
- 修正后 exact-head PR `test` run `33293588718`: success。
- merge 后 `master` test run `33293619644`: success。
- merge 命中既有账户路径过滤后自动运行 `deploy-subscription` run `33293619636`: success；Worker 部署、live account smoke、公开状态验证均成功。这是订阅 Worker 生产部署，不是客户端发布。
- 本 PR 未修改 WA/TG/LINE WebView、transport、消息发送、群发、数据库 schema、套餐价格或 updater。
- 尚未做真实 Windows 客户端 UI/交互验证，因此只能称代码 + GitHub CI + 订阅 Worker 生产链验证完成，不能称个人中心真实客户端产品闭环已验证。

## 当前证据等级

- 代码判断：#267/#268/#269/#271 均已进入 `master`。
- GitHub CI：#271 exact-head `test` run `33293588718` success；merge 后 `master` test run `33293619644` success。
- Worker 生产：#271 自动触发 `deploy-subscription` run `33293619636` success，包含 Worker 部署、live account smoke 和公开状态验证；不等于客户端发布。
- 真实客户端：本轮未执行。个人中心视觉、右键入口、登录直达和忘记密码交互仍需未来测试安装包/正式版本实际观察。
- 正式客户端生产发布：本轮未执行；正式客户端仍为 1.2.17。

## 发布边界

- R2 / Release Worker 仍是客户端 updater 的权威来源；GitHub Releases 只是 verified mirror。
- 未来正式 release 顺序现在是：测试/构建 → manifest → R2 installer/blockmap → `latest.yml` promotion → 公网完整 size/SHA-256 校验 → GitHub Release 同源/hash 校验同步。
- GitHub mirror 失败不能回滚已验证成功的 R2；R2 自身 production verification/hash 失败继续走既有 rollback。
- 不得为了验证当前 UI 工作手动重发 1.2.17。下一正式客户端版本/同版本恢复发布仍需独立人工授权。

## 剩余风险 / 下一候选

1. 在下一次正式客户端发布前，继续完善不依赖 WA/TG/LINE WebView 行为的确定性 UI/账户体验；正式发布前至少用测试安装包观察个人中心布局、设置切换、账号右键入口、登录直达和忘记密码外链。
2. 个人中心当前复用既有字符包/订单业务规则；若后续要新增订单详情、客服入口或低余额阈值提示，应继续以服务端实际 contract 为准，不在 UI 伪造状态。
3. 未来第一次正式客户端发布时，观察 `release-public-integrity` 的真实 R2 全文件下载/hash 验证以及 GitHub Release mirror 的生产执行。
4. #230 保持开放：silent fallback 已修，但 custom website 产品能力仍需明确“完整接通”或“删除 dormant 分支”。
