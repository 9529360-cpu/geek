# HANDOFF

Updated: 2026-08-24

## Live baseline

- Default branch: `master`
- Verified master HEAD: `ddbc0d387b4ac061b44f94759aad6da3917f5019`
- Latest broadcast product-code checkpoint: `57d2e4d78d7de33f2d51bdd73ce08f833a96cb3b`
- Current broadcast branch HEAD: `91fa44284209dc07a71cf09b3d7f54a9a5ca763d` (doc-only checkpoint after product code)
- `package.json.version`: `1.2.16`
- `.github/release-client-version`: `1.2.16`
- Broadcast base PR: #166 (`ux/broadcast-account-jobs`)
- Scheduled attachment child PR: #168 (`fix/scheduled-broadcast-attachments`, Draft)
- Current private validation PR: #170 (`validation/broadcast-account-jobs-1.2.16`, Draft, do not merge)
- Superseded validation experiment: #171 (`validation/broadcast-account-jobs-1.2.16-r2`, Draft, do not merge)
- Formal client release is NOT authorized by this task.

## Task Queue

- P0 done — Remove the incorrect self-hosted PR build path from #168. Standard `test.yml` restored, temporary broadcast installer workflow removed, and `scripts/release-build.cjs` restored to the feature base version.
- P0 done — Produce the first private Windows validation installer from the cleaned #168 product tree using the Issue #153 precedent. Draft PR #170 used GitHub-hosted `windows-latest`, full `npm test`, then `npm run dist:test`, private artifact only. Windows validation run #3 (`32745935468`) completed successfully with all 86 tests passing and the installer uploaded. This first artifact is historical because it predates later runtime fixes.
- P0 done — Audit the branch after owner reported the broadcast UX felt broken. Fixed stale account-scoped attachment drafts that survived editor close/job creation and could reappear in the next broadcast. Fresh editor open now resets the draft and successful job creation consumes it; focused contract added. Standard PR test run #528 passed on that fix.
- P0 done — Fix live-session scheduled/queued jobs losing their one-shot timer when the account WebView is transiently unavailable. Runtime due and same-account drain paths now reuse `SchedulePersistence.startDueForAccount`, so they enter the existing bounded retry/fail path instead of remaining stuck forever; focused runtime contract added. Standard PR run #531 passed for this product-code checkpoint.
- P0 in_progress — Rebuild the private Windows validation installer from the CURRENT #168 tree. The proven #170 validation branch was refreshed by merge commit `4e8b3a09192a0c84da15e76b1ffa5fbb9f343be1`, whose tree is current #168 (`91fa4428`) plus only the temporary validation workflow/helper. The update was fast-forward only (no force push). #170 now points at the current product tree and should rerun the same GitHub-hosted Windows validation path. Current session has not yet observed the new completed Actions run/artifact, so no new installer is accepted yet.
- P0 planned — Owner performs real-client WA/TG/LINE regression from the refreshed #170 validation installer after Windows run + artifact are confirmed.
- P1 planned — After real-client evidence, update #168 validation status and decide readiness without changing package version or release marker.
- P2 done — Obsolete temporary validation PR #169 closed without merge.
- P2 planned — Close superseded #171 after #170 refreshed validation is confirmed; never merge #170/#171.

## Historical validation artifact

- Validation PR: #170 (older run on older tree)
- Windows run: #3 / `32745935468`
- Build command: `npm run dist:test`
- Package version: `1.2.16`
- Installer: `geek-1.2.16-broadcast-validation-48ef1472.exe`
- Installer SHA-256: `573c3be3764275cc618cbf0d75ea39565156e6866f3f43653e1040e093189cf2`
- Actions artifact ID: `9527175785`
- Artifact expires: 2026-08-31
- Artifact ZIP digest: `e9dd4387e55ba91e0c06859477ad805b251ac89710555fc06e1d633e040dc039`
- `productionPublished`: false
- Important: this artifact predates product checkpoint `57d2e4d7`; historical evidence only.

## Current validation candidate

- Validation PR: #170 (Draft, do not merge)
- Validation branch head: `4e8b3a09192a0c84da15e76b1ffa5fbb9f343be1`
- Product base embedded in validation merge: `fix/scheduled-broadcast-attachments@91fa44284209dc07a71cf09b3d7f54a9a5ca763d`
- Product-code checkpoint inside that tree: `57d2e4d78d7de33f2d51bdd73ce08f833a96cb3b`
- Build command: `npm run dist:test`
- Package version: `1.2.16`
- Workflow: GitHub-hosted `windows-latest` → `npm ci --ignore-scripts` → `npm test` → `npm run dist:test` → SHA-256 manifest → private artifact upload.
- `productionPublished`: false by design.
- Status: validation branch refreshed and PR synchronized; awaiting observable completed Windows Actions evidence and new artifact ID/SHA before handing installer to owner.

## Current constraints

- Validation uses `dist:test`; `npm run dist` and `release-client` are not daily validation entrypoints.
- No production upload/tag/release/updater metadata changes.
- Do not modify `.github/release-client-version` for this validation.
- Keep `GeekBroadcastSafety`, WebView security, opaque attachment paths/owner binding, and existing WA/TG/LINE transport semantics unchanged.
- Scheduled attachment refs remain main-process-only durable opaque references bound to account + job/task.

## Evidence established

- Standard PR CI after cleanup: run #524 success.
- Older Windows validation run #3: 86/86 repository contracts passed on Windows and `npm run dist:test` succeeded.
- Attachment-draft reset: commits `9c228a2b` + `f38f78e9`; standard PR test run #528 actual success.
- Live-session due/queue recovery: commits `0df876d4` + `57d2e4d7`; standard PR test run #531 actual success.
- Refreshed validation tree: `4e8b3a09` is a non-force merge that combines current #168 tree with the already-proven temporary #170 workflow/helper only.
- Current session has NOT yet observed the refreshed #170 Windows run completion; do not claim the new installer exists until artifact evidence is available.

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
