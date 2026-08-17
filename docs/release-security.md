# Windows 正式发布安全门槛

正式发布必须使用 `npm run dist`。该命令要求 `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`（或 electron-builder 兼容的 `CSC_*`）并强制代码签名；未签名会直接失败。

`npm run dist:test` 仅供本机功能测试，可能未签名，不得上传 R2、更新官网或创建 tag。

正式构建完成后脚本会验证所有 EXE 的 Authenticode 状态、核对 `latest.yml` 版本、要求 blockmap 存在，并生成包含 SHA-256 的 `release-manifest.json`。

上传 R2 前还必须人工确认签名主体与预期证书一致。证书和密码只能放在 CI secret/受保护环境变量中，不得写入仓库、日志或构建产物。证书轮换时先发布同时信任新旧主体的过渡版本，再切换签名证书。
