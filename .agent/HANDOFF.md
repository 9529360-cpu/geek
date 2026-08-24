# HANDOFF

Updated: 2026-08-24

## Live baseline

- Default branch: `master`
- Verified master HEAD: `ddbc0d387b4ac061b44f94759aad6da3917f5019`.
- Broadcast integration PR: #166 (`ux/broadcast-account-jobs`), head before this HANDOFF-only commit `9284d32b099a55ba98559ef0ecd6fb5e6d0e1b0e`.
- Scheduled attachment child PR #168 merged into #166 as `9284d32b099a55ba98559ef0ecd6fb5e6d0e1b0e`.
- Private validation PR #170 is closed without merge after successful refreshed validation.
- `package.json.version`: `1.2.16`.
- `.github/release-client-version`: `1.2.16`.
- Formal client release has NOT been triggered; source integration and release remain separate actions.

## Task Queue

- P0 done — Fix stale account-scoped attachment drafts; standard PR test run #528 passed.
- P0 done — Fix live-session scheduled/queued jobs losing their timer when an account WebView is transiently unavailable; standard PR run #531 passed.
- P0 done — Reject old validation run #10 / artifact `9530876594` after owner observed renderer freeze.
- P0 done — Fix renderer starvation caused by a full-body `MutationObserver`; observers are now scoped and summary writes idempotent; regression contract forbids `observe(document.body, ...)`.
- P0 done — Refreshed Windows validation run #16 (`32759223627`) succeeded on fixed product checkpoint `8c26f6c3ed7c7ccd2b04ee63b6bc0bac47ec7287`: 86/86 tests passed and `npm run dist:test` succeeded.
- P0 done — Refreshed private installer `geek-1.2.16-broadcast-validation-738ff851.exe` was accepted by owner in real-client testing on 2026-08-24.
- P0 done — #168 merged into #166; #170 closed without merge.
- P0 in_progress — Final #166 integration tree CI: standard test run #549 (`32759905734`) and Windows ACL run #31 (`32759905688`) are running on head `9284d32b...`. Do not merge #166 into `master` until both complete successfully.
- P1 planned — After final #166 CI is green, merge source into `master` without changing package version or release marker.
- P1 planned — Formal client release remains a separate explicitly authorized action under `docs/release-security.md`.

## Accepted validation artifact

- Validation run: #16 / `32759223627`.
- Validation merge commit actually checked out by Actions: `738ff85102dacb648ff2a00b6681ae8416cd0685`.
- Product checkpoint inside that validation merge: `8c26f6c3ed7c7ccd2b04ee63b6bc0bac47ec7287`.
- Full repository contracts: **86/86 passed**.
- `npm run dist:test`: **success**.
- Installer: `geek-1.2.16-broadcast-validation-738ff851.exe`.
- Installer SHA-256: `51648f7541948211f8a95830b223d1181829325bbcdece69d738b1f8c2d03be1`.
- Artifact ID: `9532121198`.
- Artifact ZIP SHA-256: `1c4ca42e8f2a26283746d091faf1b7d9e1d08c220025f312628bea69b955917f`.
- Owner real-client result: **accepted / passed**.
- `productionPublished`: false.

## Rejected validation artifact

- Run #10 / artifact `9530876594` / installer `geek-1.2.16-broadcast-validation-2c5ae792.exe` remains rejected and must never be reused as a current candidate.

## Release boundary

- Test builds use `npm run dist:test` only.
- No R2 upload, updater `latest.yml`, release tag, website version, package version, or `.github/release-client-version` change occurred during validation.
- Source merge into `master` is ordinary maintenance and does not itself authorize or trigger a formal client release while the release marker is unchanged.
- Any formal release must follow the current `docs/release-security.md` gate and have explicit release authorization.
