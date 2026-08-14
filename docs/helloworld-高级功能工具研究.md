# HelloWorld「高级功能工具」逆向研究报告

> 逆向来源：`D:/项目/agent/hw_extract/resources/app_extracted/extension/whatsapp_a_test/lddaflngpimiapnbfaindmghndbnjcgm/1.7_0/js/public/pragmaz-core.js`（4.8MB，WUPE 核心）
> 日期：2026-08-14
> 目的：用户要的是 HelloWorld 的"高级功能工具"（群发消息/群组工具/群组链接等），不是 WA 页面里的扩展面板。此记录用于指导移植。

## 一、菜单结构（用户截图）

```
[基础菜单] 打开对话 / 界面设置 / 隐私设置 / 发布动态 / 深色主题
[高级功能工具]（ferramentaspremium / Premium Tools）
  ├─ 群发消息（msgauto）
  ├─ 自动通话（自动拨号）
  ├─ 用户管理
  ├─ 智能回复（msgauto1）
  ├─ 群组工具（opcoesgrupos）
  ├─ 群组链接（linkunicoparagrupos）
  ├─ 导出联系人（exportador）
  ├─ 导出/导入备份（exportadorconfig）
  └─ 数据报表（relatorios）
```

菜单注入：`WUPE.loader.lafp()`（add menu）——WA 页面 header 注入菜单按钮，点击弹出。

## 二、群发消息（msgauto）—— 已研究透

- UI：alertify 大弹窗「群发消息」，8 个发送目标单选：
  1. 联系人与群组（selectize 多选）
  2. 粘贴号码（textarea + 国家区号按钮 + Total 计数）
  3. Excel（.csv/.xlsx + 添加区号 + 自动识别列）
  4. 私聊发送给所有群成员（select 群组）
  5. 对应标签下全部联系人（select 标签）
  6. 所有联系人（排除列表）
  7. 所有群组（排除列表）
  8. 所有联系人和群组
- 消息内容：大输入框（maxlength 65000）+ 变量按钮（%nc 联系人名称 / %nr 真实昵称 / %sa 问候语）+ 创建多版本消息（Spintax `{A|B|C}` 随机替换）
- 附件：拖拽区（图片/视频/音频/PIX/vCard）+ 按钮（文字/PIX/电子名片/文字转语音）+ @全体开关 + 按钮交互
- 发送间隔：随机区间（防封）
- 定时发送：开关 + 日期时间选择
- 发送动画：#enviando（进度条 progress-bar-striped + 计数 `1/5 (20.00%)` + 倒计时 `下一次发送 MM:SSs` + 已发送至 N/M + 消息预览 + 暂停/停止/继续 + 导出未发送）
- 发送链路（WPP）：
  - 文本：`WAWebSendTextMsgChatAction.sendTextMsgToChat(chat, text, {mentionedJidList})`——@全体 = 群成员 `participants.map(id)` 经 `verificaArrayLid` 转 LID
  - 媒体：`await createFromData(file, type)` → `prepRawMedia(mediaData, prepOptions)` → `waitForPrep()` → `WAWebMediaPrep.sendMediaMsgToChat({chat: ChatStore.get(chatId), options:{caption,type}, prep, earlyUpload:null})`
  - 名片：`WAWebFrontendVcardUtils.vcardFromContactModel(contact)` → 手工构造消息 → `WAWebSendMsgChatAction.addAndSendMsgToChat(chat, msg)`（多张 = multi_vcard + vcardList）
  - 按钮：`native_flow` + `interactivePayload.messageVersion:1`（URL 按钮 `url|显示文字`）

## 三、群组工具（opcoesgrupos）

- 群组管理功能集合：
  - 选择群组以获取链接（capture 群组邀请链接）
  - 统一链接管理（localStorage `linksdegrupos` 存群链接列表——添加/删除）
  - 设置最大参与人数
  - 群成员相关操作

## 四、群组链接（linkunicoparagrupos）—— 关键 API

```js
// 加入群组邀请链接（chat.whatsapp.com/<path> 的 path）
WUPE.GroupInvite2.joinGroupViaInvite(path)   // 或 WUPE.joinGroupViaInvite(path)
// 先查群信息：queryGroupInviteInfo(path).then(N => ...)（群名/群主）
// 批量：多个链接循环 joinGroupViaInvite + toastr 成功提示（群名 + 链接）
```

**重要**：HelloWorld 加群 = 直接调 WA 内部 API `joinGroupViaInvite`（**不是导航页面点按钮**）。咱们现有实现（导航→找加入按钮→点击）可以升级为此 API（更稳更快）。

## 五、智能回复（msgauto1）

- 自动回复设置（关键词 → 回复内容）——用户之前明确"不需要自动回复"，跳过移植。

## 六、导出联系人（exportador）/ 备份（exportadorconfig）

- 导出联系人：WA 联系人列表导出（CSV/Excel）
- 导出/导入备份：配置备份（群组预设/消息模板等）

## 七、数据报表（relatorios）

- 群发统计报表（发送成功/失败/未注册/重复 + 饼图 echarts + 导出发送报告.xlsx）

## 八、移植计划（到极客）

1. **「高级功能工具」菜单**：顶部群发按钮菜单扩为完整列表（群发消息/群组工具/群组链接/导出联系人/备份/报表）
2. **群发消息**：已有（卡片式）——对齐 8 单选（已做 6 个——补"私聊群成员"/"标签"）
3. **群组工具**：批量加群（已有 join-overlay）——增强（群链接管理列表）
4. **群组链接**：升级加入方式为 `joinGroupViaInvite`（WPP 直调——替代导航式）
5. **导出联系人**：WA 联系人导出 CSV
6. **备份**：群组预设/模板备份导入
7. **报表**：发送统计（成功/失败/导出）
