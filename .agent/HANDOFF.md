# HANDOFF

Updated: 2026-08-24

## Live baseline

- Default branch: `master`
- Verified master HEAD: `ddbc0d387b4ac061b44f94759aad6da3917f5019`
- Broadcast child HEAD: `f38f78e9babb93029fcc325f0c5cdbee47a5a218`
- `package.json.version`: `1.2.16`
- `.github/release-client-version`: `1.2.16`
- Broadcast base PR: #166 (`ux/broadcast-account-jobs`)
- Scheduled attachment child PR: #168 (`fix/scheduled-broadcast-attachments`, Draft)
- Formal client release is NOT authorized by this task.

## Task Queue

- P0 done — Remove the incorrect self-hosted PR build path from #168. Standard `test.yml` restored, temporary broadcast installer workflow removed, and `scripts/release-build.cjs` restored to the feature base version.
- P0 done — Produce a private Windows validation installer from the cleaned #168 product tree using the Issue #153 precedent. Draft PR #170 used GitHub-hosted `windows-latest`, full `npm test`, then `npm run dist:test`, private artifact only. Standard PR test run #524 succeeded; Windows validation run #3 (`32745935468`) completed successfully with all 86 tests passing and the validation installer uploaded.
- P0 done — Audit the branch after owner reported the broadcast UX felt broken. Found a deterministic renderer regression where the new account-scoped attachment draft survived editor close/job creation and could reappear in the next broadcast. `broadcast-runtime.js` now resets the draft on a fresh editor open and consumes it after successful job creation; focused contract added. Standard PR test run #528 passed on the fix.
- P0 in_progress — Owner performs real-client WA/TG/LINE regression from a validation installer in the normal logged-in Windows user profile. The previous #170 installer predates the attachment-draft reset and is no longer sufficient as final acceptance evidence for current HEAD.
- P1 planned — Produce/validate a new private Windows validation artifact for current #168 HEAD before final real-client acceptance; do not publish it and do not change package/release versions.
- P1 planned — After real-client evidence, update #168 validation status and decide readiness without changing package version or release marker.
- P2 done — Obsolete temporary validation PR #169 closed without merge after replacement artifact confirmation. Branch cleanup remains optional because the current GitHub connector does not expose ref deletion.
- P2 planned — Close temporary validation PR #170 and remove its branch after replacement/current-head validation is complete; never merge it.

## Current validation artifact

- Validation PR: #170 (Draft, do not merge)
- Windows run: #3 / `32745935468`
- Build command: `npm run dist:test`
- Package version: `1.2.16`
- Installer: `geek-1.2.16-broadcast-validation-48ef1472.exe`
- Installer SHA-256: `573c3be3764275cc618cbf0d75ea39565156e6866f3f43653e1040e093189cf2`
- Actions artifact ID: `9527175785`
- Artifact expires: 2026-08-31
- Artifact ZIP digest: `e9dd4387e55ba91e0c06859477ad805b251ac89710555fc06e1d633e040dc039`
- `productionPublished`: false
- Important: this artifact predates current child HEAD `f38f78e9`; it remains useful for prior evidence but must not be treated as final current-head acceptance.

## Current constraints

- Real-client self-hosted runner is for GUI/profile regression, not a generic PR build machine.
- For GUI/profile regression it must run in the logged-in desktop user session, not as Windows Service / NETWORK SERVICE.
- Validation build uses `dist:test`; `npm run dist` and `release-client` are not daily validation entrypoints.
- No production upload/tag/release/updater metadata changes.
- Keep `GeekBroadcastSafety`, WebView security, opaque attachment paths/owner binding, and existing WA/TG/LINE transport semantics unchanged.
- Scheduled attachment refs remain main-process-only durable opaque references bound to account + job/task.

## Evidence established

- Standard PR CI after cleanup: run #524 success.
- Windows validation run #3: 86/86 repository contracts passed on Windows for the pre-draft-reset tree.
- `npm run dist:test`: actual success on GitHub-hosted Windows for that validation tree; Electron 43.4.0 / electron-builder 26.15.3 generated the NSIS installer.
- Private artifact upload: actual success; installer + validation manifest present.
- Current attachment-draft reset: commits `9c228a2b` + `f38f78e9`; standard PR test run #528 actual success, including the focused runtime contract.
- Earlier self-hosted Windows service build is not accepted as final real-client validation evidence because it ran under the wrong service/profile context.
- ACL integration test was corrected to use the effective Windows principal and its dedicated Windows workflow subsequently passed; current ACL workflow run #20 also succeeded.
- Windows-safe attachment-boundary test fixture and guarded manager contract changes are retained as cross-platform test fixes; product security behavior was not weakened.

## Remaining real-client acceptance

- Fresh editor session must not resurrect attachments selected in a previous broadcast; successful job creation must consume the editor attachment draft.
- A/B different accounts can run Broadcast Jobs concurrently; taskbar stays account-local; pause/resume/stop isolation holds.
- Same-account active + due schedule queues and drains in order.
- WA / Telegram / LINE scheduled attachment: create future task, quit app, restart, wait until due, verify original transport sends correctly.
- Attachment-only and multi-file scheduled sends.
- Delete/replace/modify source before due => visible failed state and no send.
- Cancel/terminal cleanup does not delete another job's durable refs.
- Immediate WA/TG/LINE attachment sending remains unchanged.
