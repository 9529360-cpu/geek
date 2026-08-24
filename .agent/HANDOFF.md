# HANDOFF

Updated: 2026-08-24

## Live baseline

- Default branch: `master`
- Verified master HEAD: `ddbc0d387b4ac061b44f94759aad6da3917f5019`
- `package.json.version`: `1.2.16`
- `.github/release-client-version`: `1.2.16`
- Broadcast base PR: #166 (`ux/broadcast-account-jobs`)
- Scheduled attachment child PR: #168 (`fix/scheduled-broadcast-attachments`, Draft)
- Formal client release is NOT authorized by this task.

## Task Queue

- P0 done — Remove the incorrect self-hosted PR build path from #168. Standard `test.yml` restored, temporary broadcast installer workflow removed, and `scripts/release-build.cjs` restored to the feature base version.
- P0 in_progress — Produce a private Windows validation installer from the cleaned #168 product tree using the repository precedent from Issue #153. Temporary Draft PR #170 uses GitHub-hosted `windows-latest`, full `npm test`, then `npm run dist:test`, private artifact only. Standard PR test run #524 is success; Windows validation run #3 has passed full repository contracts and is currently building with `dist:test`.
- P0 planned — Owner performs real-client WA/TG/LINE regression from the validation installer in the normal logged-in Windows user profile.
- P1 planned — After real-client evidence, update #168 validation status and decide readiness without changing package version or release marker.
- P2 planned — Close/remove obsolete temporary validation PR/branch #169 once the replacement validation artifact is confirmed.
- P2 planned — Close/remove temporary validation PR #170 and branch after the artifact/evidence has served its purpose; never merge it.

## Current constraints

- Real-client self-hosted runner is for GUI/profile regression, not a generic PR build machine.
- For GUI/profile regression it must run in the logged-in desktop user session, not as Windows Service / NETWORK SERVICE.
- Validation build uses `dist:test`; `npm run dist` and `release-client` are not daily validation entrypoints.
- No production upload/tag/release/updater metadata changes.
- Keep `GeekBroadcastSafety`, WebView security, opaque attachment paths/owner binding, and existing WA/TG/LINE transport semantics unchanged.
- Scheduled attachment refs remain main-process-only durable opaque references bound to account + job/task.

## Evidence already established

- Standard PR CI after cleanup: run #524 success.
- Windows validation run #3: dependency install success; full repository contracts success; `npm run dist:test` currently in progress.
- Earlier self-hosted Windows service build is not accepted as final real-client validation evidence because it ran under the wrong service/profile context.
- ACL integration test was corrected to use the effective Windows principal and its dedicated Windows workflow subsequently passed.
- Windows-safe attachment-boundary test fixture and guarded manager contract changes are retained as cross-platform test fixes; product security behavior was not weakened.
