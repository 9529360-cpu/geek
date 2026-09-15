# Windows 客户端发布与安全边界

当前正式客户端版本**不在本手册硬编码**。开始任何发布相关工作前，必须实时核对 `package.json.version`、`.github/release-client-version`、当前 `master` HEAD、公开 updater 元数据以及最近一次正式发布证据；正常新版本发布时包版本与发布标记必须完全一致。

历史版本的具体修复范围应从对应 release/tag、提交、PR、Issue #50 checkpoint 和 Actions run 追溯，不要把旧版本说明当成当前产品树事实。

正式客户端发布不是普通维护动作。正常发布新版本时，必须同步更新包版本和发布标记，并单独验证发布范围。普通源码、Worker 或文档修改不得改动 `.github/release-client-version`。已授权的发布若失败，只有在记录失败证据和恢复范围后，才可对同一版本执行显式重试；同版本重试不得再次改写版本或发布标记。

## 触发边界

`.github/workflows/release-client-production.yml` 有两个受控入口：

- `master` 上 `.github/release-client-version` 发生变更时，通过 path-filtered `push` 启动正常的新版本发布；
- 已授权发布失败后，通过显式 `workflow_dispatch` 启动同版本恢复重试。

正常发布把**本次单提交 `master` 推进本身**绑定为该版本唯一候选 SHA；若 marker 变化不是这次单提交推进的一部分，工作流会 fail closed。手动恢复只允许从 `refs/heads/master` 启动，并从完整 `master` 历史重新推导最近一次修改当前 release marker 的授权 commit；维护者不能通过输入任意 SHA 或选择其他 branch/tag 改变候选源码。

发布工作流保留当前 `master` 作为 release control plane，并用独立 Git worktree 在精确候选 SHA 上安装依赖和构建。这样后续对发布安全脚本的加固不会因为恢复旧候选源码而一起回退。构建完成后仅把候选的 `dist-release` 产物移交给当前控制面的公网校验、同版本不可变性检查、上传、回滚和完整性验证步骤。

两个入口都会在依赖安装前要求候选 SHA、发布标记、`package.json.version`、`package-lock.json` 顶层版本及根 package 版本一致，并执行相同的测试、构建、回滚基线、上传顺序和公开验证；不一致或任一安全步骤失败时都会拒绝发布。

旧 `.github/workflows/release-client.yml` 已退役。迁移到新 workflow 路径不是命名整理：GitHub 的手动 workflow 可以选择 branch/tag，并使用该 ref 上的 workflow 版本；更换入口路径可阻止历史 ref 复用旧的、尚未具备候选 SHA 绑定的手动发布逻辑。

因此：

- 未修改发布标记的普通 `master` 提交不会自动发布客户端；
- `workflow_dispatch` 不是日常构建按钮，只能用于已有独立发布授权、明确目标版本和失败证据的恢复重试；
- 手动 dispatch 只能选择 `master`，且实际构建源码仍由仓库历史推导的授权候选 SHA 决定；
- 手动 dispatch 不得绕过完整 contract、产物校验、上一稳定版本验证、`latest.yml` 最后发布或失败回滚；
- 部署 `geek-release` Worker 不等于发布或重试客户端版本；
- 仅修改 README、运维文档、网站、翻译、账号或订阅源码时，不得顺手修改发布标记或手动启动正式发布；
- 正式发布、版本回退、Secrets 变更需要独立决策和记录。

## 本地构建命令

正式发布构建脚本：

```powershell
npm run dist
```

该命令用于生成经过测试和完整性处理的 Windows 发布候选。它本身不应被理解为已经完成生产发布；生产上传与公开传播由受控 GitHub Actions 工作流完成。

本地功能测试构建：

```powershell
npm run dist:test
```

`dist:test` 仅供本机验证，不得上传 R2、修改公开 `latest.yml`、更新官网版本或创建 release tag。

目录构建：

```powershell
npm run pack
```

`pack` 用于生成 unpacked Windows 应用目录，不是正式发布流程。

## 发布顺序

正式工作流按以下安全顺序执行：

1. 解析并验证唯一授权候选 SHA，在独立 worktree 中重新核对 marker/package/lock 版本；
2. 仅在候选 worktree 中安装依赖并运行 `npm run dist`，完成 contract、完整性清单、Windows 构建和发布产物生成；
3. 检查版本化安装包、blockmap、`latest.yml` 和 `release-manifest.json` 均存在且版本一致；
4. 从公开更新源读取并验证上一稳定版本及其安装包/blockmap，建立可回滚基线；
5. 若公网已是同版本，先要求公开安装包和 blockmap 与该候选产物逐字节 SHA-256 一致，并在一致时跳过所有生产写操作；
6. 新版本推广时，先上传不可变的版本化安装包和 blockmap；
7. 保存上一稳定版 `latest.yml` 的回滚快照；
8. 最后上传新的 `latest.yml`，使客户端看到新版本；
9. 从公开更新源反复验证新 `latest.yml`、安装包和 blockmap 均可访问且 SHA-256 与候选 manifest 一致；
10. 若传播验证失败，恢复上一稳定版元数据并验证回滚结果。

不得先发布 `latest.yml` 再补传安装包，也不得覆盖旧版本化安装包来模拟回滚。上一稳定元数据和旧版本产物应保留，供自动回滚和人工处置使用。

## 产物验证

正式构建至少要求：

- `geek-setup-<version>.exe`
- `geek-setup-<version>.exe.blockmap`
- `latest.yml`
- `release-manifest.json`

构建脚本会核对 `latest.yml` 版本、要求 blockmap 存在，并生成包含 SHA-256 的发布清单。发布工作流还会从公开更新端点验证元数据与版本化产物，而不是仅相信 R2 上传命令成功。

Release Worker 只允许服务 updater 所需的 `latest.yml`、版本化 `.exe` 和 `.blockmap`。不得借客户端发布把它扩大为通用静态文件服务。

## Windows 发布者提示 / Authenticode 决策

仓库 owner 已于 2026-09-14 明确决定：**继续使用当前免费、unsigned 的 Windows 发布方式，不配置生产 Authenticode 证书。** 因此安装包可能继续显示 Windows 的“未知发布者”提示，这是当前接受的运营约束，不属于发布失败。

该决定不降低其他发布安全边界：完整 contract、Electron/打包验证、release manifest、SHA-256 公网完整性校验、immutable installer/blockmap 上传、rollback snapshot、`latest.yml`-last promotion 和失败回滚仍然必须保留。

日常维护不得：

- 为了消除“未知发布者”提示自行采购或接入付费代码签名服务；
- 新增、上传或要求签名证书、私钥、PFX、签名密码；
- 把证书材料写入仓库、Issue、PR、Actions summary、聊天或诊断日志；
- 把 Authenticode 变成当前正式发布的 required gate；
- 因为没有签名而关闭现有完整性、回滚或公开传播校验。

当前 `scripts/release-build.cjs` 中对签名环境变量的兼容检测属于既有 dormant capability；在 owner 没有重新明确改变这一决策前，不应配置对应生产 signing secrets，也不应围绕该 dormant path 扩展发布流程。

如未来 owner 明确改变这一决策，应重新建立独立 focused Issue，重新评估证书/Provider、Secret ownership、publisher identity、renewal/revocation 以及候选产物验证；不得把旧 #445 当成仍然自动授权的待办。

## 发布前检查

正式发布或同版本恢复重试前至少确认：

- 已从实时仓库核对目标版本、`master` HEAD、包版本和发布标记，而不是依赖 HANDOFF/README 中的旧快照；
- 发布版本、变更范围和用户影响已明确；
- 同版本重试具有对应失败 run、根因记录和已有发布授权；
- 手动恢复是从 `master` 启动，且工作流解析出的候选 SHA 与原 marker 授权 commit 一致；
- 候选 `package.json.version`、`package-lock.json` 顶层/根 package 版本与发布标记一致；
- 完整 contract suite 通过；
- Electron/LINE/WA/TG 等受影响平台完成必要的真实兼容回归；
- 没有真实运行数据、凭据、临时日志或测试账号进入产物；
- 更新 Worker 仍保持 updater-only allowlist；
- 上一稳定版本和公开产物可访问，回滚路径可用；
- 发布后公开传播检查通过。

没有这些证据时，不得通过修改发布标记“试运行”正式发布，也不得把 `workflow_dispatch` 当作绕过门禁的替代入口。
