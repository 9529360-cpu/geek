'use strict';
const fs = require('node:fs');
const p = 'docs/agent-collaboration-handoff.md';
let s = fs.readFileSync(p, 'utf8');
s = s.replace('status: ready-for-user-test', 'status: accepted');
s = s.replace(/next_gate: .*?(?=\n```)/, 'next_gate: ACCOUNT-CONTEXT-001 已由阿豪明确验收并授权合并/发布；Geek 1.2.18 已通过 release-client 正式发布与公网 updater 验证');
if (!s.includes('### [REPORT-007]')) {
  s += `\n\n### [REPORT-007]\n\n日期时间：2026-08-30 22:37 +02:00\n任务 ID：ACCOUNT-CONTEXT-001 合并与正式发布\n状态：accepted\n决策者：阿豪\n用户授权：阿豪明确回复“可以合并发布了”。\n\n合并结果：\n- 原 Draft PR #276 因 GitHub connector 的 draft-to-ready GraphQL 兼容错误无法转 Ready；未绕过 Draft 门禁，#276 关闭并保留历史。\n- 以完全相同的 immutable head d0021ee31ae4749d15f7d277b2c47ae3a8bdca98 创建非 Draft PR #277，无代码增量；#277 正常合并。\n- 功能 merge commit：7bdfdbc5195cbf11114d4da0342f029671991ca1。\n- 合并后 master test run 33333782774：success。\n- path-filter deploy-subscription run 33333782719：部署、live account smoke、非敏感生产状态验证均 success；这是 subscription Worker 部署，不等同客户端发布。\n\n正式客户端发布：\n- 发布版本：Geek 1.2.18。\n- release PR #278 将 package.json、package-lock.json、.github/release-client-version 同步到 1.2.18，并把官网 FALLBACK_VERSION 更新到上一稳定版 1.2.17。\n- release PR #278 merge commit / 当前 master：ed21bca77290062c38e3a0b77be8c0f4c9ab216c。\n- release-client run 33333943332 / job 99317363700：success。\n- 正式 Windows release 构建执行完整 125 tests；Windows ACL integration 在真实 Windows runner 上通过。\n- 正式安装包：geek-setup-1.2.18.exe；installer + blockmap 上传 R2 success。\n- 发布前捕获并验证上一稳定版：1.2.17；rollback/latest.yml 与 rollback/latest-1.2.17.yml 快照上传 success。\n- latest.yml 最后发布 success；生产 updater 公网验证返回 public-release=1.2.18。\n- deploy-website run 33333943365：部署与 public website 验证 success。\n\n发布状态：\n- code merged：verified。\n- CI：verified。\n- artifact built：verified。\n- release published：verified。\n- updater production verification：verified，public-release=1.2.18。\n- 用户对本任务验证版体验：accepted。\n\nACCOUNT-CONTEXT-001 至此闭环。\n`;
}
fs.writeFileSync(p, s, 'utf8');
fs.unlinkSync('scripts/account-context-release-accepted-once.cjs');
fs.unlinkSync('.github/workflows/account-context-release-accepted-once.yml');
