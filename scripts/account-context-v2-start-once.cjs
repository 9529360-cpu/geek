'use strict';
const fs = require('node:fs');
const path = 'docs/agent-collaboration-handoff.md';
let text = fs.readFileSync(path, 'utf8');
if (!text.includes('### [REPORT-004]')) {
  text = text.replace('status: ready-for-user-test', 'status: implementing');
  text = text.replace('working_branch: feat/account-context-001', 'working_branch: feat/account-context-001-v2');
  const allowedNeedle = 'allowed_changes:\n  - ui/index.html';
  if (text.includes(allowedNeedle) && !text.slice(text.indexOf('### 当前任务'), text.indexOf('## 4.')).includes('  - ui/subscription.html')) {
    text = text.replace(allowedNeedle, 'allowed_changes:\n  - ui/subscription.html\n  - ui/index.html');
  }
  text = text.replace(/next_gate: .*?(?=\n```)/, 'next_gate: v2 从稳定基线重新实现；代码/CI 通过后重新生成 Windows 验证构建，仍由阿豪亲自验收后决定是否接受');
  text += `\n\n### [REPORT-004]\n\n日期时间：2026-08-31 02:07 Asia/Kuala_Lumpur\n任务 ID：ACCOUNT-CONTEXT-001 v1 用户打回\n状态：rejected\n决策者：阿豪\n记录者：网页版 GPT\n\n被拒绝实现：\n- branch：feat/account-context-001\n- commit：d3a4ac6b0a5d28a5950f0001f0fbeb3c16d3daf2\n- PR：#275（保持 Draft / 未合并）\n- Windows validation artifact：9735755875（保留为 rejected evidence，不作为后续验收包）\n\n根据用户明确“太差了，打回去重新做”的决定，v1 不再作为可接受实现。重新对照稳定基线和产品范围后确认两个结构性问题：\n- 真实的极客账户个人中心本来就在 ui/subscription.html 的 view-home；v1 没有修这个真实入口，反而在主应用 Settings overlay 新增第二个“个人中心”，造成重复产品入口，同时原入口仍调用 getQuota(true)，fail-open 风险没有从真实用户路径消失。\n- 产品范围要求把实例级操作从普通 Settings 迁到具体实例右键上下文；v1 删除了既有右键独立代理弹窗，却把账号设置继续塞在同一个 settings-overlay/settings-controller 中，仅改为右键唤起，所有权仍混在全局设置壳里。\n\n处置：\n- 不在 v1 上继续打补丁。\n- 保留 v1 branch / PR / CI / artifact 作为 rejected evidence。\n- 从稳定 master 5245a710b429cf8454682fcf437517518b77c21f 新建 v2 分支重新实现。\n- v1 为其错误页面组织写的 contract 不作为 v2 产品架构的权威测试。\n\n### [START-004]\n\n日期时间：2026-08-31 02:07 Asia/Kuala_Lumpur\n任务 ID：ACCOUNT-CONTEXT-001 v2 rework\n基线 commit：5245a710b429cf8454682fcf437517518b77c21f\n工作分支：feat/account-context-001-v2\n当前工作区状态：通过 GitHub connector 在远程新建分支，HEAD 精确等于稳定基线；未使用、清理或覆盖用户本地 worktree。\n本次目标：从产品所有权重新实现 Phase 2，而不是修补 rejected v1。\n本次允许修改：ui/subscription.html（现有真实个人中心，仅账户展示/fail-open UI）；ui/index.html；ui/app.js；ui/settings-controller.js；必要时 ui/settings-controller.css；src/main.cjs 仅 HTTP 代理协议和关闭实例代理后的全局代理即时回落；相关测试；本交接记录。\n本次明确禁止修改：master；PR #275 合并状态；登录/注册流程语义；WebView partition；账号数据存储边界；主导航；全局设置语义；正式 release marker；release-client；Worker；真实用户数据。\n实现方向：\n- 个人中心只改现有 ui/subscription.html view-home，不在主应用再造第二份。\n- 普通 Settings 只保留全局设置。\n- 右键“账号设置”使用独立实例面板，仅名称/字体等实例显示项；右键“代理设置”保留独立代理面板；两者都固定绑定被右击实例 ID，并复用 accounts:update。\n- 刷新只重载被右击实例 WebView；删除仍走既有安全删除路径；不伪造 relogin。\n- 先写会在稳定基线上失败的 v2 contract/runtime tests，再写产品代码。\n预计验证方式：红测试 → v2 实现 → npm test / diff review / GitHub CI → 独立 Windows validation build → 阿豪真实安装验收。用户确认前状态绝不 accepted，绝不合并。\n`;
}
fs.writeFileSync(path, text, 'utf8');
fs.unlinkSync('scripts/account-context-v2-start-once.cjs');
fs.unlinkSync('.github/workflows/account-context-v2-start-once.yml');
