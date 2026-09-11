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
- Remote WebViews keep `sandbox=true`, `nodeIntegration=false`, and `webSecurity=true`; insecure content is not enabled as a maintenance shortcut.
- WhatsApp and Telegram use `contextIsolation=true`. LINE has a deliberately scoped `contextIsolation=false` compatibility exception; do not remove or broaden it without the authenticated evidence described by #16/#130.
- Post-attach WebView navigation is account-scoped and fail-closed when account/partition ownership cannot be established. Popup, navigation, and redirect policy must not become a global cross-account allowlist.
- WebView permission decisions are account/session scoped and fail closed outside each platform/account policy.
- Immediate broadcast files use opaque main-process capabilities; renderer code must not receive arbitrary filesystem paths.
- Scheduled broadcast attachments use durable opaque refs owned by account + task/job. Canonical paths remain main-process state; materialization revalidates source metadata and owner binding, and terminal/cancel cleanup invalidates refs.
- Real Electron E2E uses an isolated `geek-e2e-*` userData profile under the OS temp root. Synthetic E2E evidence proves only the mechanism it actually exercises; it does not substitute for authenticated WA/TG/LINE compatibility evidence.
- Website is a first-class account type: custom URLs are HTTPS-only, accounts have distinct persistent Sessions, navigation is scoped to that account's configured host policy, and Website guests receive no privileged preload bridge.
- Normal maintenance must not bump package version, change `.github/release-client-version`, publish updater metadata, or trigger a formal client release unless the task explicitly authorizes a release.

## Remaining live gates at the last verification

These entries describe unresolved evidence/decisions, not an instruction to implement them automatically. Refresh each Issue before acting.

- **#223 — account-scoped WebView navigation.** The production account-scoped navigation fix is in `master`, and PR #323 added a synthetic real-Electron guest runtime gate proving page `location.assign(...)` reaches main-process `will-navigate` while forbidden WA -> TG and Website A -> B destinations never commit via `did-navigate`; same-owner Website navigation remains the positive control. **Keep #223 open** until authenticated WA/TG/LINE login, messaging, restart/session-persistence compatibility evidence is recorded. Do not treat #323 as that authenticated proof.
- **#167 — durable scheduled attachments.** `ScheduledBroadcastAttachmentStore`, account + job/task owner binding, restart persistence, source mutation detection, opaque renderer refs, and cleanup contracts already exist in `master`. Do not reimplement the Store from the stale Issue body. **Keep #167 open** for real-client WA/TG/LINE restart, cancel, source-mutation, send, and cleanup/isolation validation.
- **#130 / #16 — LINE compatibility evidence.** The Electron upgrade is complete, but authenticated LINE post-login behavior remains the gate for changing the scoped `contextIsolation=false` exception. Do not remove that exception based on unauthenticated or static contracts alone.
- **#3 — historical credentials/runtime data.** Current code-side exposure is contained. Remaining credential rotation / risk acceptance / Git history rewrite is an owner-controlled and potentially destructive decision. Never expose historical secrets, rewrite history, or force-push as routine maintenance.
- **WhatsApp Windows cold-start E2E gate (#332).** PR #332 added a GitHub-hosted `windows-latest` Electron lane for the official WhatsApp Web cold-start oracle and wired it into the aggregate `electron-e2e` gate. The PR head produced a successful real Windows Electron run, but the first merged `master` push run (`electron-e2e` #202 on `ce938f2700c968cb6021afc2bc049753a35c7c9c`) failed only because `loadingProgress=1` while `officialWeb=true`, `documentComplete=true`, `loginShell=true`, and `rendererResponsive=true`. Treat this as **E2E oracle instability / false-positive risk until stronger evidence proves a product regression**; do not respond by changing WhatsApp startup, WA-JS, WPP/WAPLUS, partition, permission, sandbox, or security settings. The current oracle counts raw `progress,[role="progressbar"]` DOM nodes, which does not distinguish hidden/background/transient progress elements from a truly visible blocking loading state. If this gate is revisited, first re-check live Actions and then prefer a visibility/blocking-aware loading predicate while keeping official-Web, completed-document, login-shell, and renderer-responsiveness checks. The previous mutation proof changed the test's expected URL to the historical localhost bootstrap and proves URL mismatch is caught; it is **not** by itself proof that a real visible loading stall is detected. Stabilize the oracle before making `electron-e2e` a repository-level required merge check.
- **Old WhatsApp diagnostic PRs, including #314/#315/#316.** Re-evaluate them against live `master` before using any finding. A diagnostic branch or artifact is not a product fix and must not be merged merely because its old observation was once valid.

## Last verified snapshot

**Historical checkpoint — refresh live state before acting.**

Last verified before this handoff change: **2026-09-11**.

- audited `master` snapshot: `ce938f2700c968cb6021afc2bc049753a35c7c9c`;
- audited `package.json.version`: `1.2.22`;
- audited `.github/release-client-version`: `1.2.22`;
- latest audited `master` push gates at that point: `test` #1043 success and `electron-e2e` #202 failure;
- the `electron-e2e` #202 failure was isolated to the Windows WhatsApp lane described above; the Linux smoke job passed;
- PR #296 had already made Website a supported first-class account type;
- PR #323 had already merged the synthetic real-Electron navigation mechanism gate;
- PR #332 had merged the Windows WhatsApp cold-start E2E lane, with the remaining oracle-stability caveat recorded above.

The values above are intentionally frozen as evidence of what was reviewed on that date. They are **not** a declaration of the current master or current released version after this document changes.

## Historical / Git archaeology

Older HANDOFF revisions contain useful history around broad broadcast stabilization (#166), the #231 editor/readiness regression, validation artifacts, translation/contact-note work, and temporary integration branches. Preserve that history in Git, but do not restore those branch names, artifact SHAs, Draft states, or "current target" language into this recovery contract unless live GitHub and current source independently show they are active again.

When archaeology is needed, inspect the historical commit/PR/Issue directly. Do not promote a historical snapshot into a current maintenance plan by copying it here.
