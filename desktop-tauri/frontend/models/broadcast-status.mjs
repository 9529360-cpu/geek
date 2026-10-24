const messages = {
  BROADCAST_ACCOUNT_NOT_READY: '账号页面尚未就绪，请打开并登录该账号后重新读取聊天。',
  BROADCAST_ACCOUNT_CHANGED: '发送账号已切换。草稿仍保留，请重新打开群发以确认发送账号。',
  BROADCAST_ACCOUNT_UNAVAILABLE: '发送账号当前不可用，请重新打开该账号。',
  ACCOUNT_UNAVAILABLE: '发送账号当前不可用，请重新打开该账号。',
  CAPABILITY_UNAVAILABLE: '账号页面的发送能力尚未就绪，请打开并登录该账号后重试。',
  GUEST_CHANGED: '发送账号的页面已重新加载或更换，请核对任务状态和发送明细。',
  TARGET_CHANGED: '发送对象已变化，该步骤未提交。请核对对象和账号状态。',
  COMPOSER_MISMATCH: '平台当前输入框与任务不一致，该步骤未提交。请核对账号页面。',
  NOT_SUBMITTED: '该步骤没有提交到平台。',
  RECEIPT_MISSING: '平台未返回可验证的发送回执，请到对应平台核对。',
  TIMED_OUT: '平台响应超时，请结合发送明细核对该步骤的提交状态。',
  INTERRUPTED: '上次执行已中断，尚未自动继续。请核对进度后再继续剩余对象。',
  INTERRUPTED_UNCERTAIN: '上次发送结果不确定，未自动重发。请先到对应平台核对。',
  CANCELLED: '该步骤已取消，没有继续提交。',
  PERSISTENCE_FAILED: '任务检查点未能保存，已停止自动执行。请检查本地存储并核对任务状态。',
  SCHEDULE_ACCOUNT_UNAVAILABLE: '定时任务到点时发送账号不可用，请重新打开并登录该账号。',
  RUNTIME_FAILED: '平台执行步骤未能完成，请结合发送明细核对提交状态。',
  BROADCAST_UNSUPPORTED: '当前平台暂不支持群发；本次迁移支持 WhatsApp。',
  BROADCAST_INVALID: '任务内容未通过校验，请检查发送对象、内容和时间设置。',
  BROADCAST_TELEGRAM_CAPTION_LIMIT: 'Telegram K 附件说明最多 1024 个字符，请缩短内容。',
  BROADCAST_TELEGRAM_TEXT_LIMIT: 'Telegram K 每条消息最多 4096 个字符，请缩短内容。',
  BROADCAST_LIMIT: '群发任务或发送对象已达到容量限制，请处理现有任务后重试。',
  BROADCAST_CONFLICT: '该任务标识已对应另一份内容，请重新打开编辑器并核对任务。',
  BROADCAST_RETIRED: '任务记录已关闭，请新建任务。不会自动重放已关闭的任务。',
  BROADCAST_STATE: '任务状态已改变，请查看最新进度后再操作。',
  BROADCAST_PERSISTENCE: '群发状态未能保存。请检查本地存储并查看任务状态后重试。',
  BROADCAST_UNAVAILABLE: '发送账号页面或聊天列表已变化，请重新读取聊天并确认发送对象。',
  BROADCAST_CATALOG_INVALID: '聊天列表无法验证，请重新读取。',
  BROADCAST_CATALOG_STALE: '账号页面或聊天列表已变化，请重新读取并确认发送对象。',
  BROADCAST_AUDIENCE_EMPTY: '请至少选择一个发送对象。',
  BROADCAST_PASTE_UNVERIFIED: '请先核验当前号码，再确认发送对象。',
  BROADCAST_SOURCE_EMPTY: '请先选择来源。',
  BROADCAST_SOURCE_LIMIT: '最多选择 20 个群组。',
  BROADCAST_SOURCE_STALE: '所选来源已失效，请重新选择并读取。',
  BROADCAST_SOURCE_UNAVAILABLE: '当前账号暂时无法读取此来源。',
  BROADCAST_SOURCE_UNVERIFIED: '请先读取当前来源，再确认发送对象。',
  BROADCAST_PRESET_INVALID: '名称或内容无效，请检查后重试。',
  BROADCAST_PRESET_LIMIT: '保存数量或内容超过上限。',
  BROADCAST_PRESET_CONFLICT: '保存的资料已变化，请刷新后重试。',
  BROADCAST_PRESET_UNKNOWN: '这条资料已不存在，请刷新后重试。',
  BROADCAST_PRESET_PERSISTENCE: '资料未能保存，原列表和草稿仍保留。',
  BROADCAST_EXCLUSION_CONFLICT: '排除名单已变化，请刷新后重新核对发送对象。',
  BROADCAST_IMPORT_INVALID: '联系人文件格式无效，请检查号码列或聊天ID列。',
  BROADCAST_IMPORT_LIMIT: '联系人文件最多 5 MiB，最多 2000 个不同收件人。',
  BROADCAST_IMPORT_EMPTY: '没有可核验的收件人，原选择已保留。',
  BROADCAST_IMPORT_UNAVAILABLE: '联系人暂时无法核验，请稍后重新导入。',
  BROADCAST_EXPORT_EMPTY: '当前任务没有可导出的异常记录。',
  BROADCAST_EXPORT_FAILED: '异常记录未能导出，请重试。',
  BROADCAST_CONTENT_EMPTY: '请填写消息内容、添加附件或选择电子名片。',
  BROADCAST_ATTACHMENTS_UNAVAILABLE: '当前账号的附件发送尚未就绪。',
  BROADCAST_ATTACHMENT_INVALID: '附件信息无法验证，请重新选择。',
  BROADCAST_ATTACHMENT_LIMIT: '附件超出限制：最多 10 个，单个 512 MiB，总计 1 GiB。',
  BROADCAST_ATTACHMENT_UNAVAILABLE: '所选附件已不可用，请重新选择。',
  BROADCAST_ATTACHMENT_CHANGED: '所选附件已变化，请重新选择。',
  BROADCAST_ATTACHMENTS_TAG_ALL: '附件任务不支持@全体，请先关闭@全体或移除附件。',
  BROADCAST_FILE_COUNT_LIMIT: '最多添加 10 个附件。',
  BROADCAST_FILE_SIZE_LIMIT: '单个附件不能超过 512 MiB。',
  BROADCAST_FILE_TOTAL_LIMIT: '附件总大小不能超过 1 GiB。',
  BROADCAST_FILE_UNAVAILABLE: '所选附件已不可用，请重新选择。',
  BROADCAST_FILE_OWNER_INVALID: '附件不属于当前发送账号，请重新选择。',
  BROADCAST_FILE_REGISTRY_LIMIT: '待处理附件过多，请移除不用的附件后重试。',
  BROADCAST_NAME_MISSING: '部分对象没有可用姓名，请移除姓名变量或调整发送对象。',
  BROADCAST_INTERVAL_INVALID: '发送间隔必须是 5–60 秒的整数，最大值不能小于最小值。',
  BROADCAST_SCHEDULE_INVALID: '请选择未来的发送时间；不会自动改成立即发送。',
  BROADCAST_SCHEDULE_UNAVAILABLE: '定时发送尚不可用，请稍后重试。',
  BROADCAST_VCARDS_UNAVAILABLE: '当前账号的电子名片能力尚未就绪。',
  BROADCAST_TAG_ALL_UNAVAILABLE: '当前账号的 @全体能力尚未就绪。',
  BROADCAST_TAG_ALL_REQUIRES_TEXT: '@全体需要文本消息，不能用于仅发送电子名片的任务。',
  BROADCAST_ACCOUNT_BUSY: '当前账号已有执行中的任务，请在任务条或指挥台查看。',
  ACCOUNT_BUSY: '当前账号已有执行中的任务，请在任务条或指挥台查看。',
  BROADCAST_ID_UNAVAILABLE: '无法创建任务标识，请重新打开应用后重试。',
  BROADCAST_STORE_FAILED: '任务未能保存。草稿仍保留，请检查本地存储后重试。',
  STORE_IO: '任务未能保存。草稿仍保留，请检查本地存储后重试。',
  BROADCAST_INTERRUPTED: '上次执行已中断，尚未自动继续。请核对进度后决定是否继续剩余对象。',
  BROADCAST_INTERRUPTED_UNCERTAIN: '上次发送结果不确定，未自动重发。请先在对应平台核对。',
  BROADCAST_RESULT_UNCERTAIN: '无法确认这次发送结果，未自动重发。请在对应平台核对。',
  BROADCAST_UNKNOWN: '群发操作未完成，请查看任务状态后重试。',
};

export function errorCode(error) {
  const value = typeof error === 'string' ? error : error?.code;
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,100}$/.test(value) ? value : 'BROADCAST_UNKNOWN';
}

export function errorMessage(error) {
  const code = errorCode(error);
  return messages[code] || '该步骤未完成，请查看账号状态并重试。';
}

export function pasteErrorMessage(error) {
  return {
    BROADCAST_IMPORT_INVALID: '号码格式无效，请每行填写一个完整国际号码。',
    BROADCAST_IMPORT_LIMIT: '粘贴内容最多 128 KiB，最多 2000 个不同号码。',
    BROADCAST_IMPORT_EMPTY: '没有可核验的号码，输入已保留。',
    BROADCAST_IMPORT_UNAVAILABLE: '号码暂时无法核验，请重试。',
  }[errorCode(error)] || errorMessage(error);
}

export function audienceSourceError(error, kind) {
  if (kind === 'paste') return pasteErrorMessage(error);
  return {
    BROADCAST_IMPORT_INVALID: '来源无法验证，请重新选择。',
    BROADCAST_IMPORT_LIMIT: kind === 'groups' ? '最多选择 20 个群组，最多 2000 个收件人。' : '最多读取 2000 个收件人。',
    BROADCAST_IMPORT_EMPTY: '没有可发送的对象，原选择已保留。',
    BROADCAST_IMPORT_UNAVAILABLE: '来源暂时无法读取，请重试。',
  }[errorCode(error)] || errorMessage(error);
}
