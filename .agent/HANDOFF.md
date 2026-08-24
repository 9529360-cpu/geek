# HANDOFF

Updated: 2026-08-24

## Live baseline

- Default branch: `master`
- Verified master HEAD: `ddbc0d387b4ac061b44f94759aad6da3917f5019`
- Latest broadcast product-code checkpoint: `57d2e4d78d7de33f2d51bdd73ce08f833a96cb3b`
- Current broadcast branch HEAD before this doc checkpoint: `b5b865ee25f8a52dbdf61c3b4dc73d456c021255`
- `package.json.version`: `1.2.16`
- `.github/release-client-version`: `1.2.16`
- Broadcast base PR: #166 (`ux/broadcast-account-jobs`)
- Scheduled attachment child PR: #168 (`fix/scheduled-broadcast-attachments`, Draft)
- Current private validation PR: #170 (`validation/broadcast-account-jobs-1.2.16`, Draft, do not merge)
- Superseded validation experiment #171 is closed without merge.
- Formal client release is NOT authorized by this task.

## Task Queue

- P0 done — Remove the incorrect self-hosted PR build path from #168.
- P0 done — Fix stale account-scoped attachment drafts; focused contract added; standard PR test run #528 passed.
- P0 done — Fix live-session scheduled/queued jobs losing their one-shot timer when account WebView is transiently unavailable; runtime now reuses bounded recovery; standard PR run #531 passed.
- P0 done — Rebuild the private Windows validation installer from the current #168 tree using the proven #170 GitHub-hosted Windows path. Refreshed validation run #10 (`32755801505`) completed successfully. Full repository contracts: 86/86 passed. `npm run dist:test` succeeded. Private installer + SHA-256 artifact uploaded.
- P0 in_progress — Owner performs real-client WA/TG/LINE regression from the current validation installer in the normal logged-in Windows user profile.
- P1 planned — After owner real-client acceptance, update #168 readiness and decide any separate release action. Do not change package version or release marker before explicit release authorization.
- P2 done — Obsolete validation PR #169 closed without merge.
- P2 done — Superseded validation PR #171 closed without merge.
- P2 planned — Close #170 only after owner real-client acceptance is complete; never merge it.

## Current validation artifact

- Validation PR: #170 (Draft, do not merge)
- Windows run: #10 / `32755801505`
- Validation merge commit actually checked out by Actions: `2c5ae79227682ca375863126afbd93f39b0c0eb2`
- Validation branch head: `4e8b3a09192a0c84da15e76b1ffa5fbb9f343be1`
- Product base embedded in validation tree: `fix/scheduled-broadcast-attachments@91fa44284209dc07a71cf09b3d7f54a9a5ca763d`
- Product-code checkpoint inside that tree: `57d2e4d78d7de33f2d51bdd73ce08f833a96cb3b`
- Build command: `npm run dist:test`
- Package version: `1.2.16`
- Installer: `geek-1.2.16-broadcast-validation-2c5ae792.exe`
- Installer SHA-256: `bc0057833432b6a2bf10041faf30c531d4a9abc198909ce0e0e731d4a189c211`
- Actions artifact ID: `9530876594`
- Artifact ZIP digest: `fc444c2cfee7adf830a65979c9d32b1505387c3f9d18ab2605ff2d5bda5c94d2`
- Artifact expires: 2026-08-31
- `productionPublished`: false

## Current constraints

- Validation uses `dist:test`; `npm run dist` and `release-client` are not daily validation entrypoints.
- No production upload/tag/release/updater metadata changes.
- Do not modify `.github/release-client-version` for validation.
- Keep `GeekBroadcastSafety`, WebView security, opaque attachment paths/owner binding, and existing WA/TG/LINE transport semantics unchanged.
- Scheduled attachment refs remain main-process-only durable opaque references bound to account + job/task.

## Evidence established

- Refreshed Windows validation run #10 `32755801505`: completed/success.
- Windows actual full repository contracts: 86/86 passed.
- `npm run dist:test`: actual success on GitHub-hosted Windows; Electron 43.4.0 / electron-builder 26.15.3 built NSIS `geek-setup-1.2.16.exe` before it was copied/renamed as the private validation installer.
- Artifact preparation printed installer SHA-256 `bc0057833432b6a2bf10041faf30c531d4a9abc198909ce0e0e731d4a189c211`.
- Artifact upload actual success: ID `9530876594`, ZIP digest `fc444c2cfee7adf830a65979c9d32b1505387c3f9d18ab2605ff2d5bda5c94d2`.
- Standard PR test workflow for the same refreshed validation head also completed success (`32755801349`).
- `master` remains `ddbc0d3` and no formal client release was triggered.

## Remaining real-client acceptance

- Fresh editor session must not resurrect attachments selected in a previous broadcast; successful job creation must consume the editor attachment draft.
- A due scheduled Job whose account view is briefly unavailable must retry and either execute or visibly fail after the bounded retry limit; it must not stay scheduled/queued forever.
- A/B different accounts can run Broadcast Jobs concurrently; taskbar stays account-local; pause/resume/stop isolation holds.
- Same-account active + due schedule queues and drains in order.
- WA / Telegram / LINE scheduled attachment: create future task, quit app, restart, wait until due, verify original transport sends correctly.
- Attachment-only and multi-file scheduled sends.
- Delete/replace/modify source before due => visible failed state and no send.
- Cancel/terminal cleanup does not delete another job's durable refs.
- Immediate WA/TG/LINE attachment sending remains unchanged.
