# Geek Agent Handoff

Updated: 2026-08-30

## 当前施工现场

- Repository: `9529360-cpu/geek`
- 正式基线：`master@27819bec7292964f88a7669f736b42b19385cdf3`
- `package.json.version`: `1.2.17`
- `.github/release-client-version`: `1.2.17`
- 本轮未修改版本号或 release marker，未触发新的正式 `release-client`，未做真实客户端回归。
- 最近一次正式客户端发布仍是 1.2.17：`release-client` run `33290618930`，发生在本轮改动之前。

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
- 第一次 PR CI 因 `session-partition-compat-contract` 过度绑定源码写法而失败；新 account type contract 本身已通过。修正 contract 为验证真实 startup 顺序后，exact-head `test` run `33292406829`: success。
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

## 当前证据等级

- 代码判断：上述三项已进入 `master`。
- 本地：R2 integrity helper 的聚焦 Node contract 在维护环境执行成功；其余以仓库 contract/CI 为准。
- GitHub CI：三个 PR exact-head 均已取得成功；三次 merge 后的 master test 也均成功，最终组合基线 run 为 `33292478411`。
- Worker 生产：#267 触发既有 path-filter `deploy-release-worker`，run `33292441476` success。该部署不等于客户端发布。
- 真实客户端：本轮未执行，也不是本轮验收边界。
- 正式客户端生产发布：本轮未执行。

## 发布边界

- R2 / Release Worker 仍是客户端 updater 的权威来源；GitHub Releases 只是 verified mirror。
- 未来正式 release 顺序现在是：测试/构建 → manifest → R2 installer/blockmap → `latest.yml` promotion → 公网完整 size/SHA-256 校验 → GitHub Release 同源/hash 校验同步。
- GitHub mirror 失败不能回滚已验证成功的 R2；R2 自身 production verification/hash 失败继续走既有 rollback。
- 不得为了验证本轮工作手动重发 1.2.17。下一正式客户端版本/同版本恢复发布仍需独立人工授权。

## 剩余风险 / 下一候选

1. 未来第一次正式客户端发布时，观察 `release-public-integrity` 的真实 R2 全文件下载/hash 验证以及 GitHub Release mirror 的生产执行；在此之前只能称代码+CI 已验证。
2. #230 保持开放：silent fallback 已修，但 custom website 产品能力仍需明确“完整接通”或“删除 dormant 分支”。
3. 不做真实客户端回归的后续工作可继续选择纯 contract、Worker/client contract、持久化/并发/权限边界或确定性错误恢复问题；涉及 WA/TG/LINE 登录、发送、WebView 生命周期的改动不要仅凭 CI 宣布产品闭环。
