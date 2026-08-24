# HaloGPT / HelloWorld 逆向参考源码归档

本目录是极客项目的**只读研究参考资料**，不是极客生产代码，也不应被构建系统或发布流程自动引用。

## 内容边界

### `halogpt/`
- `resources/app.asar`：本机 HaloGPT 原始应用归档。
- `app_extracted/`：从归档提取的完整应用文件（已排除 `node_modules`，依赖应按 `package.json` 重新安装）。
- `deobf/`：我们已有的反混淆/分析结果。

### `helloworld/`
- `app.asar`：本机 HelloWorld 原始应用归档。
- `app.asar.unpacked/`：原应用中未打入 asar 的完整资源。
- `helloworld-translation-deobf/`：我们已有的 LINE/Telegram 等反混淆整理代码。

## 重要说明

1. 这是从本机安装包/运行目录逆向提取的材料，不等同于上游开发者的原始 Git 工作树；源码可能已经经过打包、压缩、混淆或构建转换。
2. 不包含整个 Electron 安装目录、安装器、运行时 DLL、缓存和用户数据；这些不是产品源码，且会污染仓库。HelloWorld 内嵌的第三方 Signal 可执行运行时也未上传（GitHub 单文件限制且不属于 HelloWorld 源码）。
3. HelloWorld 的 `app.asar` 原文件已保留；尝试用 Electron ASAR 工具提取时检测到异常文件头/异常条目，提取器无法完整展开，因此没有伪造“完整解包成功”。已保留原始 `app.asar`、完整 `app.asar.unpacked/` 和已有反混淆整理代码。
4. `app.asar` 与 `app_extracted/` 是故意同时保留：前者用于核对原始归档，后者用于搜索和分析。HaloGPT 的 `app_extracted/` 已完成；HelloWorld 因原归档异常未生成该目录。
5. 仅供极客项目的架构、UI、扩展适配和行为研究参考；未经确认不得复制进生产代码或对外发布。
6. 本归档可能包含第三方组件及其许可证，使用时必须遵守各自许可证和适用法律。
