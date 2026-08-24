# HANDOFF

Updated: 2026-08-24

## Live baseline

- Default branch: `master`
- Verified master HEAD: `ddbc0d387b4ac061b44f94759aad6da3917f5019`.
- Broadcast integration PR: #166 (`ux/broadcast-account-jobs`), current integration head before this focused fix branch: `ed597d7395cc7b7b6a3bb8a5423b9af0d48d8942`.
- Scheduled attachment child PR #168 merged into #166.
- Private validation PR #170 is closed without merge.
- Focused renderer-starvation fix branch: `fix/broadcast-observer-starvation`.
- `package.json.version`: `1.2.16`.
- `.github/release-client-version`: `1.2.16`.
- Formal client release has NOT been triggered; source integration and release remain separate actions.

## Task Queue

- P0 done — Fix stale account-scoped attachment drafts; standard PR test run #528 passed.
- P0 done — Fix live-session scheduled/queued jobs losing their timer when an account WebView is transiently unavailable; standard PR run #531 passed.
- P0 done — Reject old validation run #10 / artifact `9530876594` after owner observed renderer freeze.
- P0 done — Fix renderer starvation caused by the controller observing the full document body; controller observers are scoped and summary writes idempotent.
- P0 done — Refreshed Windows validation run #16 (`32759223627`) succeeded at contract/build level: 86/86 tests passed and `npm run dist:test` succeeded.
- P0 done — Reject validation installer `geek-1.2.16-broadcast-validation-738ff851.exe` after owner observed that opening/starting group broadcast still freezes the renderer. Its prior provisional acceptance is superseded by this later real-client failure report.
- P0 done — Root-cause the second renderer starvation path: `ui/broadcast-account-indicator.js` observes `#nav-accounts` child mutations, while its own `render()` adds/removes the badge and unconditionally rewrites badge `textContent`; once a Broadcast Job creates a badge, the observer can continuously retrigger itself.
- P0 done — Fix account indicator rendering to be idempotent and make the observer ignore its own badge mutations / react only to account-structure changes.
- P0 done — Add `test/broadcast-account-indicator-contract.cjs` to prevent regression of this self-trigger loop.
- P0 in_progress — Run standard CI on the focused fix branch/PR, then build a NEW private Windows validation installer. Do not reuse run #16 / artifact `9532121198`.
- P0 planned — Owner retests: open broadcast editor, create/start a Job, confirm UI remains responsive and account badge/taskbar update without freezing.
- P1 planned — Only after fresh real-client acceptance, resume #166 integration toward `master`.
- P1 planned — Formal client release remains a separate explicitly authorized action under `docs/release-security.md`.

## Rejected validation artifacts

### Rejected package A

- Run #10 / artifact `9530876594`.
- Installer: `geek-1.2.16-broadcast-validation-2c5ae792.exe`.
- Reason: renderer became effectively unresponsive due to the controller full-body MutationObserver self-trigger loop.
- Status: **REJECTED**. Never reuse.

### Rejected package B

- Validation run: #16 / `32759223627`.
- Validation merge commit checked out by Actions: `738ff85102dacb648ff2a00b6681ae8416cd0685`.
- Product checkpoint: `8c26f6c3ed7c7ccd2b04ee63b6bc0bac47ec7287`.
- Contracts/build evidence: 86/86 passed; `npm run dist:test` succeeded.
- Installer: `geek-1.2.16-broadcast-validation-738ff851.exe`.
- Installer SHA-256: `51648f7541948211f8a95830b223d1181829325bbcdece69d738b1f8c2d03be1`.
- Artifact ID: `9532121198`.
- Later owner real-client result: app/login worked, but group broadcast interaction froze the renderer.
- Status: **REJECTED**. Contract/build success does not override real-client failure.
- `productionPublished`: false.

## Second renderer-loop fix

- `broadcast-account-indicator.js` badge text/title/state writes are idempotent.
- The account indicator observer no longer rerenders on every child mutation.
- Observer explicitly ignores `.bc-account-job-state` mutations caused by its own render.
- Observer only rerenders for actual `.nav-account` structure changes.
- No fallback to `document.body`.
- Dedicated contract guards these invariants.

## Release boundary

- Test builds use `npm run dist:test` only.
- No R2 upload, updater `latest.yml`, release tag, website version, package version, or `.github/release-client-version` change is authorized by this fix.
- Do not merge #166 to `master` until the fresh package passes real-client broadcast interaction testing.
- Any formal release must follow `docs/release-security.md` and requires explicit release authorization.
