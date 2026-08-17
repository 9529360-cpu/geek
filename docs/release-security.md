# Windows 发布流程

正式发布使用 `npm run dist`。未配置证书时沿用 v1.2.3 的免费发布方式，安装时 Windows 会显示“未知发布者”；以后配置 `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` 后会自动签名并验证签名。

`npm run dist:test` 仅供本机功能测试，不得上传 R2、更新官网或创建 tag。

正式构建完成后脚本会核对 `latest.yml` 版本、要求 blockmap 存在，并生成包含 SHA-256 的 `release-manifest.json`；配置证书时还会验证所有 EXE 的 Authenticode 状态。

证书和密码只能放在 CI secret/受保护环境变量中，不得写入仓库、日志或构建产物。
