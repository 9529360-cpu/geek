# geek-release 发布运维备注（2026-08-17 更新）

## 2026-08-17 翻译网关改为免费模型轮换池（移除 DeepSeek）

- Worker：`scripts/geek-translate-worker.js`
- 上游改为免费模型轮换池，按顺序尝试、限流/失败自动切换下一个：
  1. GLM `glm-4.7-flash`（ZAI_API_KEY，来自 Hermes .env）
  2. Groq `llama-3.3-70b-versatile`（GROQ_API_KEY，来自 pool_accounts.json groq.key）
  3. Gemini `gemini-2.0-flash`（GEMINI_API_KEY，来自 pool_accounts.json gemini.key，OpenAI 兼容端点）
  4. Mistral `mistral-small-latest`（MISTRAL_API_KEY，来自 pool_accounts.json mistral.key）
- **DeepSeek 已移除**（secret 已删除，代码不再引用）
- 客户端 `src/main.cjs` 正式打包版默认端点指向 `https://geek-translate.9529360.workers.dev`（6ad89ed）
- 生产 D1 补建 `translation_usage` 表（此前缺失导致翻译 409 duplicate_request 误报）
- 测试：npm test 37/37；实测翻译 200（engine=glm/mistral 均正常）
- 部署命令：`npx wrangler deploy --config wrangler-translate.toml`

## 重大坑：wrangler r2 命令默认操作本地模拟存储！

`npx wrangler r2 object put/get` **不带 `--remote` 时操作的是本地 Miniflare 模拟存储**，
不是云端 R2！症状：命令显示 "Upload complete."，但 Cloudflare API / Worker 都看不到对象。

**必须显式加 `--remote`**：

```powershell
npx wrangler r2 object put geek-release/geek-setup-1.2.4.exe --file dist-release/geek-setup-1.2.4.exe --remote
npx wrangler r2 object put geek-release/geek-setup-1.2.4.exe.blockmap --file dist-release/geek-setup-1.2.4.exe.blockmap --remote
npx wrangler r2 object put geek-release/latest.yml --file dist-release/latest.yml --remote
```

验证是否真的到云端：用 Cloudflare API 列出对象
（`GET /accounts/<account_id>/r2/buckets/geek-release/objects`，Authorization: Bearer <wrangler oauth_token>），
看 `last_modified` 和 etag 是否更新。不要信 wrangler get 的返回内容（可能来自本地模拟）。

## 2026-08-17 重新发布（翻译网关默认端点修复，版本仍 1.2.4）

- 修改：`src/main.cjs` `translationGatewayEndpoints()` 正式打包版默认端点
  从空 `[]` 改为 `['https://geek-translate.9529360.workers.dev']`（环境变量 `GEEK_TRANSLATION_GATEWAY_URL` 仍可覆盖）
- 背景：正式版之前必须靠系统环境变量配置翻译网关，用户装完没设就报"远程翻译服务尚未配置"，翻译不可用
- 云端翻译 Worker（geek-translate.9529360.workers.dev）本身一直正常，上游 DeepSeek，与本地号池无关
- 测试：npm test 37/37 通过
- 构建：npm run dist（electron-builder，无签名"未知发布者"，与 GPT 流程一致）
- 上传：见上方 --remote 命令
- 验证：Worker 读取 latest.yml 为新 sha512 DcMuu+...；exe 下载 md5 476df187000fecf942be545b72804bea 与本地一致
