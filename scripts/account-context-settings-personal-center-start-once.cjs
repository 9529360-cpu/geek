'use strict';
const fs = require('node:fs');
const handoffPath = 'docs/agent-collaboration-handoff.md';
const scopePath = 'docs/account-and-app-context-menu-scope.md';
let handoff = fs.readFileSync(handoffPath, 'utf8');
if (!handoff.includes('### [START-006]')) {
  handoff = handoff.replace('status: ready-for-user-test', 'status: implementing');
  handoff = handoff.replace(/next_gate: .*?(?=\n```)/, 'next_gate: 在 v2 上增加应用设置内只读个人中心（邮箱 + 剩余字符），完成测试/CI/新 Windows validation 后交阿豪复验；不得合并 PR #276');
  handoff += `\n\n### [START-006]\n\n日期时间：2026-08-31 03:09 Asia/Kuala_Lumpur\n任务 ID：ACCOUNT-CONTEXT-001 v2 增量：应用设置个人中心\n基线 commit：5245a710b429cf8454682fcf437517518b77c21f\n工作分支：feat/account-context-001-v2\n当前实现 HEAD：70728981a06eb195fea6cb14f74d5a2de8c48051\n当前工作区状态：GitHub connector 远程执行；PR #276 Draft/open/未合并，master 仍为 5245a710b429cf8454682fcf437517518b77c21f；没有使用或清理用户本地 worktree。\n用户最新产品决策：阿豪明确认可 v2 当前结构，并要求把主界面的“设置”视为应用设置，在其中增加一个只读“个人中心”，只展示极客账户邮箱和剩余字符。\n本次允许修改：ui/index.html；ui/settings-controller.js；必要的 ui/settings-controller.css；直接相关测试；本交接/范围文档。\n本次明确禁止修改：实例右键菜单所有权；实例账号设置/代理设置路径；subscription 登录/注册流程；preload/main/Worker/账户存储；WebView partition；master；版本号/release marker；release-client。\n实现不变量：应用设置内个人中心只是现有 subscription.getState()/refresh() 的只读镜像，不新增账户状态、缓存、保存动作或第二套余额逻辑；网络失败/无可信余额必须显示未知，不得显示 MAX_SAFE_INTEGER、假 0 或假成功。\n预计验证方式：先扩展 contract 使当前 70728981... 失败；再最小实现；完整 npm test / PR CI；重新生成 exact-head Windows validation 安装包。阿豪复验前状态不 accepted、不合并。\n`;
}
let scope = fs.readFileSync(scopePath, 'utf8');
const marker = '- 不在客户端新增保存供应商密钥、翻译服务器地址或其他敏感凭据的逻辑。';
const note = `\n\n#### 2026-08-31 产品补充：应用设置内只读个人中心\n\n阿豪确认：主界面的“设置”可视为“应用设置”，其中允许增加一个只读“个人中心”卡片，仅展示：\n\n- 极客账户邮箱\n- 剩余字符\n\n该卡片不是第二套账户中心或账户状态 owner。它必须直接复用现有 subscription.getState()/refresh() 数据源，不新增登录、账户缓存、余额计算、保存或修改账户动作。登录前/进入主界面前的现有个人中心流程继续保留。若账户信息或余额无法可信读取，应用设置内必须显示“未知/暂不可用”，不得以 MAX_SAFE_INTEGER、假 0 或其他默认值代替。\n`;
if (!scope.includes('2026-08-31 产品补充：应用设置内只读个人中心')) {
  if (!scope.includes(marker)) throw new Error('scope marker missing');
  scope = scope.replace(marker, marker + note);
}
fs.writeFileSync(handoffPath, handoff, 'utf8');
fs.writeFileSync(scopePath, scope, 'utf8');
fs.unlinkSync('scripts/account-context-settings-personal-center-start-once.cjs');
fs.unlinkSync('.github/workflows/account-context-settings-personal-center-start-once.yml');
