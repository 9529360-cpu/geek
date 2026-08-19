# Windows 客户端发布与安全边界

当前正式客户端版本为 `1.2.12`，`package.json.version` 与 `.github/release-client-version` 均为 `1.2.12`。

正式客户端发布不是普通维护动作。正常发布新版本时，必须同步更新包版本和发布标记，并单独验证发布范围。普通源码、Worker 或文档修改不得改动 `.github/release-client-version`。已授权的发布若失败，只有在记录失败证据和恢复范围后，才可对同一版本执行显式重试；同版本重试不得再次改写版本或发布标记。

## 触发边界

`.github/workflows/release-client.yml` 有两个受控入口：

- `master` 上 `.github/release-client-version` 发生变更时，通过 path-filtered `push` 启动正常的新版本发布；
- 已授权发布失败后，通过显式 `workflow_dispatch` 启动同版本恢复重试。

两个入口都会要求发布标记与 `package.json.version` 完全一致，并执行相同的测试、构建、回滚基线、上传顺序和公开验证；不一致或任一安全步骤失败时都会拒绝发布。

因此：

- 未修改发布标记的普通 `master` 提交不会自动发布客户端；
- `workflow_dispatch` 不是日常构建按钮，只能用于已有独立发布授权、明确目标版本和失败证据的恢复重试；
- 手动 dispatch 不得绕过完整 contract、产物校验、上一稳定版本验证、`latest.yml` 最后发布或失败回滚；
- 部署 `geek-release` Worker 不等于发布或重试客户端版本；
- 仅修改 README、运维文档、网站、翻译、账号或订阅源码时，不得顺手修改发布标记或手动启动正式发布；
- 正式发布、版本回退、证书/Secrets 变更需要独立决策和记录。

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

1. 安装依赖并验证发布标记与包版本一致；
2. 运行 `npm run dist`，完成 contract、完整性清单、Windows 构建和发布产物生成；
3. 检查版本化安装包、blockmap、`latest.yml` 和 `release-manifest.json` 均存在且版本一致；
4. 从公开更新源读取并验证上一稳定版本及其安装包/blockmap，建立可回滚基线；
5. 先上传不可变的版本化安装包和 blockmap；
6. 保存上一稳定版 `latest.yml` 的回滚快照；
7. 最后上传新的 `latest.yml`，使客户端看到新版本；
8. 从公开更新源反复验证新 `latest.yml`、安装包和 blockmap 均可访问；
9. 若传播验证失败，恢复上一稳定版元数据并验证回滚结果。

不得先发布 `latest.yml` 再补传安装包，也不得覆盖旧版本化安装包来模拟回滚。上一稳定元数据和旧版本产物应保留，供自动回滚和人工处置使用。

## 产物验证

正式构建至少要求：

- `geek-setup-<version>.exe`
- `geek-setup-<version>.exe.blockmap`
- `latest.yml`
- `release-manifest.json`

构建脚本会核对 `latest.yml` 版本、要求 blockmap 存在，并生成包含 SHA-256 的发布清单。发布工作流还会从公开更新端点验证元数据与版本化产物，而不是仅相信 R2 上传命令成功。

Release Worker 只允许服务 updater 所需的 `latest.yml`、版本化 `.exe` 和 `.blockmap`。不得借客户端发布把它扩大为通用静态文件服务。

## Authenticode

当前未配置正式 Windows Authenticode 证书时，安装包会显示“未知发布者”。这是当前运营约束，不应通过关闭安全检查、伪造签名或把证书写入仓库来绕过。

以后配置 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` 后，构建脚本会自动签名并验证 EXE 的 Authenticode 状态。证书、私钥和密码只能存在于受保护的 CI secret 或受控环境变量中，不得写入：

- 仓库源码或文档；
- commit message、Issue、PR 评论或 Actions summary；
- 构建产物旁的明文文件；
- shell 历史、聊天记录或诊断日志。

证书采购、Secrets 配置、轮换和吊销属于单独的高影响运营决策。

## 发布前检查

正式发布或同版本恢复重试前至少确认：

- 发布版本、变更范围和用户影响已明确；
- 同版本重试具有对应失败 run、根因记录和已有发布授权；
- `package.json.version` 与发布标记一致；
- 完整 contract suite 通过；
- Electron/LINE/WA/TG 等受影响平台完成必要的真实兼容回归；
- 没有真实运行数据、凭据、临时日志或测试账号进入产物；
- 更新 Worker 仍保持 updater-only allowlist；
- 上一稳定版本和公开产物可访问，回滚路径可用；
- 发布后公开传播检查通过。

没有这些证据时，不得通过修改发布标记“试运行”正式发布，也不得把 `workflow_dispatch` 当作绕过门禁的替代入口。
