# HANDOFF

Updated: 2026-08-24

## Live baseline

- Default branch: `master`
- Verified master HEAD: `ddbc0d387b4ac061b44f94759aad6da3917f5019`
- Current broadcast base PR: #166 (`ux/broadcast-account-jobs`, Draft), product fix head `e1e5b5b64c79086db5f235d8243556413dd4c4b1`.
- Scheduled attachment child PR: #168 (`fix/scheduled-broadcast-attachments`, Draft), product fix checkpoint `8c26f6c3ed7c7ccd2b04ee63b6bc0bac47ec7287` before this HANDOFF-only commit.
- `package.json.version`: `1.2.16`.
- `.github/release-client-version`: `1.2.16`.
- Private validation PR: #170 (`validation/broadcast-account-jobs-1.2.16`, Draft, do not merge).
- #169 and #171 are closed without merge.
- Formal client release is NOT authorized.

## Task Queue

- P0 done — Fix stale account-scoped attachment drafts; standard PR test run #528 passed.
- P0 done — Fix live-session scheduled/queued jobs losing their timer when an account WebView is transiently unavailable; standard PR run #531 passed.
- P0 done — Build validation run #10 (`32755801505`): Windows 86/86 contracts passed and `npm run dist:test` succeeded, but owner real-client testing rejected that package because the renderer became effectively unresponsive.
- P0 done — Root-cause the real-client freeze: `ui/broadcast-job-controller.js` observed all of `document.body`, while the observer callback itself rewrote task/summary DOM. This could continuously retrigger `MutationObserver` microtasks and starve renderer interaction. Base fix commits: `7ae228d8` + `e1e5b5b6`. #168 synchronized fix checkpoint: `8c26f6c3`.
- P0 in_progress — Rebuild a NEW private Windows validation installer from #168 after the renderer-loop fix. #170 validation branch was refreshed to the fixed product tree and retriggered; do not reuse artifact `9530876594` or installer `geek-1.2.16-broadcast-validation-2c5ae792.exe`.
- P0 planned — Owner first verifies basic UI responsiveness in a normal Windows profile, then performs WA/TG/LINE broadcast regression.
- P1 planned — Only after owner acceptance, decide readiness; package version/release marker remain unchanged until separate explicit release authorization.

## Rejected validation artifact

- Run: #10 / `32755801505`.
- Artifact ID: `9530876594`.
- Installer: `geek-1.2.16-broadcast-validation-2c5ae792.exe`.
- Installer SHA-256: `bc0057833432b6a2bf10041faf30c531d4a9abc198909ce0e0e731d4a189c211`.
- Status: **REJECTED by owner real-client test**. CI/build success does not override the observed renderer freeze. Never hand this artifact out again as a current candidate.
- `productionPublished`: false.

## Renderer-loop fix

- `refreshSummary()` now writes summary text only when content actually changed.
- Removed the `MutationObserver` on the entire `document.body`.
- Summary observation is scoped to `#broadcast-overlay`.
- Account visibility observation is scoped to `#nav-accounts`.
- Contract explicitly rejects `observe(document.body, ...)` and requires scoped observers/idempotent summary writes.
- WA/TG/LINE transport semantics, WebView security, attachment opaque refs and release controls were not changed.

## Validation boundary

- Test builds use `npm run dist:test` only.
- No R2 upload, updater `latest.yml`, release tag, website version, package version, or `.github/release-client-version` change.
- #170 is temporary private validation evidence and must never be merged.

## Next acceptance order

1. App opens and normal sidebar/account/settings/translation controls remain clickable and responsive; no renderer freeze.
2. Open/close group-send editor repeatedly; main chat remains usable.
3. Start group send; editor closes and compact account-local taskbar remains, without covering the chat page.
4. Terminal task has a working close/dismiss action.
5. Fresh editor does not resurrect previous attachments; successful job creation consumes its draft.
6. Due scheduled job retries or visibly fails after bounded WebView-unavailable retries; never sticks forever.
7. A/B accounts can run concurrently; pause/resume/stop and taskbar state stay account-local.
8. WA/TG/LINE scheduled attachments survive restart and use the existing transports.
9. Source-file deletion/replacement/modification before due fails visibly and does not send.
10. Immediate WA/TG/LINE attachment sending remains unchanged.
