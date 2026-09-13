# Geek Maintenance Recovery Contract

This file is a recovery contract, not a live status database. A new maintainer or AI session must recover current state from GitHub before choosing or continuing work.

## Source of truth order

When sources disagree, use this order:

1. live GitHub `master` source and HEAD;
2. live `package.json`;
3. live `.github/release-client-version`;
4. live tests, contracts, and GitHub workflows / CI results;
5. live open Issues and pull requests, including their newest relevant comments;
6. the newest dated checkpoint on Issue #50;
7. dated historical snapshots in this file or other Markdown.

**Any SHA or version written in Markdown is a dated snapshot only. It must never be treated as live current state.** Always query GitHub again before acting.

## Recovery procedure for a new session

1. Read `AGENTS.md` and this contract, but do not start work from a SHA, version, branch, PR, or priority named in prose.
2. Fetch live `master` HEAD, `package.json`, `.github/release-client-version`, open PRs, open Issues, and the latest `master` CI runs.
3. If a dated checkpoint differs from live `master`, inspect intervening merges and current source/tests before deciding whether old Issue or PR text is still actionable.
4. Read the active code owner and its contracts for the task. Treat old Issue bodies, old PR bodies, validation artifacts, and diagnostic branches as archaeology until live source proves they are still relevant.
5. Use Issue #50 only as a persistent checkpoint/index after live state has been fetched. Its comments are snapshots, not authority over newer repository state.
6. Keep one root cause per Issue/branch/PR. Ordinary maintenance must not modify `.github/release-client-version`; a client release is a separate explicitly authorized operation.

## Durable architecture and security invariants

These are intended to survive individual maintenance rounds. Reconfirm them against live source/tests when working near the boundary.

- The real Electron entrypoint is `src/main-entry.cjs`; do not infer runtime ownership from an older entrypoint description.
- Each account owns a persistent Electron Session/partition. Account identity, partition, guest `WebContents`, and account-scoped state must not be silently rebound by UI focus or another account.
- Account IPC ingress and account state durability are separate owners. Canonical account state transitions are serialized by the Account State owner; candidate state is encrypted and atomically persisted before becoming authoritative memory, and runtime cleanup/proxy/notifications are post-commit effects.
- WebView invoke ingress for `webview:register` and `webview:insert-text` is owned by `src/webview-ipc.cjs`, composed and disposed by `src/main.cjs`. `src/webview-ownership.cjs` remains the sole ownership-registry authority; the IPC owner must inject and consult that registry plus Account State/WebContents/Session authorities rather than copying ownership state.
- Remote WebViews keep `sandbox=true`, `nodeIntegration=false`, and `webSecurity=true`; insecure content is not enabled as a maintenance shortcut.
- WhatsApp and Telegram use `contextIsolation=true`. LINE has a deliberately scoped `contextIsolation=false` compatibility exception; do not remove or broaden it without the authenticated evidence described by #16/#130.
- `line-tokens.json` may remain on upgraded installations as a legacy sensitive artifact. Current production runtime does not use it as LINE login-state authority and must not read or write it; runtime migration and Windows ACL repair must preserve any existing legacy file rather than deleting or replacing it.
- Post-attach WebView navigation is account-scoped and fail-closed when account/partition ownership cannot be established. Popup, navigation, and redirect policy must not become a global cross-account allowlist.
- WebView permission decisions are account/session scoped and fail closed outside each platform/account policy.
- Immediate broadcast files use opaque main-process capabilities; renderer code must not receive arbitrary filesystem paths.
- Scheduled broadcast attachments use durable opaque refs owned by account + task/job. Canonical paths remain main-process state; materialization revalidates source metadata and owner binding, and terminal/cancel cleanup invalidates refs.
- Real Electron E2E uses an isolated `geek-e2e-*` userData profile under the OS temp root. Synthetic E2E evidence proves only the mechanism it actually exercises; it does not substitute for authenticated WA/TG/LINE compatibility evidence.
- Website is a first-class account type: custom URLs are HTTPS-only, accounts have distinct persistent Sessions, navigation is scoped to that account's configured host policy, and Website guests receive no privileged preload bridge.
- Cloudflare Worker validation and production deployment are separate control planes: PR/master validation may run tests, syntax checks and Wrangler dry-run without production credentials, while automatic production deploy `push.paths` must represent only the matching Wrangler config plus the Worker's repository-local deployable dependency closure. Tests, deployment observers, smoke runners and deploy workflow files do not automatically publish production Workers.
- Normal maintenance must not bump package version, change `.github/release-client-version`, publish updater metadata, or trigger a formal client release unless the task explicitly authorizes a release.

## Remaining live gates at the last verification

These entries describe unresolved evidence/decisions, not an instruction to implement them automatically. Refresh each Issue before acting.

- **#223 — account-scoped WebView navigation.** The production account-scoped navigation fix is in `master`, and PR #323 added a synthetic real-Electron guest runtime gate proving page `location.assign(...)` reaches main-process `will-navigate` while forbidden WA -> TG and Website A -> B destinations never commit via `did-navigate`; same-owner Website navigation remains the positive control. **Keep #223 open** until authenticated WA/TG/LINE login, messaging, restart/session-persistence compatibility evidence is recorded. Do not treat #323 as that authenticated proof.
- **#167 — durable scheduled attachments.** `ScheduledBroadcastAttachmentStore`, account + job/task owner binding, restart persistence, source mutation detection, opaque renderer refs, and cleanup contracts already exist in `master`. Do not reimplement the Store from the stale Issue body. **Keep #167 open** for real-client WA/TG/LINE restart, cancel, source-mutation, send, and cleanup/isolation validation.
- **#130 / #16 — LINE compatibility evidence.** The Electron upgrade is complete, but authenticated LINE post-login behavior remains the gate for changing the scoped `contextIsolation=false` exception. Do not remove that exception based on unauthenticated or static contracts alone.
- **#3 — historical credentials/runtime data.** Current code-side exposure is contained. Remaining credential rotation / risk acceptance / Git history rewrite is an owner-controlled and potentially destructive decision. Never expose historical secrets, rewrite history, or force-push as routine maintenance.
- **Old WhatsApp diagnostic PRs, including #314/#315/#316.** Re-evaluate them against live `master` before using any finding. A diagnostic branch or artifact is not a product fix and must not be merged merely because its old observation was once valid.

## Last verified snapshot

**Historical checkpoint — refresh live state before acting.**

Last verified before this handoff change: **2026-09-11**.

- audited `master` snapshot: `9c6d8687a1e7f1657dea4241a6b960bff477161b`;
- audited `package.json.version`: `1.2.21`;
- audited `.github/release-client-version`: `1.2.21`;
- latest audited `master` push gates at that point: `test` #1029 success and `electron-e2e` #189 success;
- PR #296 had already made Website a supported first-class account type;
- PR #323 had already merged the synthetic real-Electron navigation mechanism gate.

The values above are intentionally frozen as evidence of what was reviewed on that date. They are **not** a declaration of the current master or current released version after this document changes.

## Historical / Git archaeology

Older HANDOFF revisions contain useful history around broad broadcast stabilization (#166), the #231 editor/readiness regression, validation artifacts, translation/contact-note work, and temporary integration branches. Preserve that history in Git, but do not restore those branch names, artifact SHAs, Draft states, or "current target" language into this recovery contract unless live GitHub and current source independently show they are active again.

When archaeology is needed, inspect the historical commit/PR/Issue directly. Do not promote a historical snapshot into a current maintenance plan by copying it here.