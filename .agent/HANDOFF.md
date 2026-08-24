# HANDOFF

Updated: 2026-08-24

## Live baseline

- Default branch: `master`.
- Verified `master` HEAD: `ddbc0d387b4ac061b44f94759aad6da3917f5019` (`release: Geek 1.2.16`).
- `package.json.version`: `1.2.16`.
- `.github/release-client-version`: `1.2.16`.
- Broadcast integration PR #166: branch `ux/broadcast-account-jobs`, current head `cc552c2dc0271cef00fcbffa7c250b3d9e9af489` after merging the validated renderer-starvation fix PR #172.
- Current product-polish branch: `ux/broadcast-product-polish`, based on `cc552c2dc0271cef00fcbffa7c250b3d9e9af489`.
- Issue #174 tracks the next P0: broadcast editor/runtime productization.
- Formal client release has NOT been triggered; source integration and release remain separate actions.

## Task Queue

- P0 done — Account-scoped Broadcast Job/runtime/scheduler architecture and durable scheduled-attachment refs are integrated in #166.
- P0 done — Reject old validation artifact `9530876594`; renderer froze.
- P0 done — Reject old validation artifact `9532121198`; app/login worked but opening/starting broadcast still froze renderer.
- P0 done — Fix controller full-body MutationObserver starvation; observers are scoped and summary writes idempotent.
- P0 done — Fix account-indicator self-trigger starvation; badge writes are idempotent and observer ignores its own badge mutations.
- P0 done — Strengthen starvation contracts with behavior-level idempotence/mutation-filter checks.
- P0 done — Final source validation on PR #172: standard run #553 (`32765301689`) success, merge tree `2efb6dcec555c1d9f27a4fe2b72dbf3eb79d220d`, 88/88 contracts.
- P0 done — Fresh Windows private candidate run #2 (`32765412122`) success on Windows Server 2025: 88/88 contracts, Windows ACL integration, `npm run dist:test`, Electron 43.4.0 x64. Candidate `geek-1.2.16-broadcast-final-candidate-da649219.exe`, SHA-256 `22382807f59d70cb38ace894091f82d1ac8ce4a9f8daa1418d3e9109bff6b5ab`, artifact `9534323810`, `productionPublished=false`.
- P0 done — Owner real-client result for the fresh candidate: renderer remains interactive and broadcast can actually send.
- P0 done — PR #172 merged into #166 as `cc552c2dc0271cef00fcbffa7c250b3d9e9af489`. This validates the freeze fix only; it is not overall UX acceptance.
- P0 in_progress — Issue #174: raise broadcast UX above the formal 1.2.16 experience. Editing must no longer obscure the whole chat workspace; running/completed feedback must retain the formal version's useful progress detail while staying lightweight and account-scoped.
- P0 planned — Add focused product-UX contracts and run standard CI on the final #174 merge tree.
- P0 planned — Build a fresh private Windows candidate after #174 CI; old candidates remain invalid for UX acceptance.
- P0 planned — Owner real-client product acceptance: editor/workspace coexistence, send progress richness, pause/resume/stop, completion close/failure details, account switching.
- P1 planned — Only after fresh product acceptance, resume #166 integration toward `master`.
- P1 planned — Formal client release remains a separate explicitly authorized action under `docs/release-security.md`.

## Product finding behind #174

Formal 1.2.16 uses a heavy full-overlay sending view. It blocks the chat workspace, but it does provide useful detail: current target/message context, countdown, progress, pause/stop, completion close and failure export/detail.

The account-scoped Job redesign fixes ownership/background execution and returns the user to chat after starting, but the current upper-right bar compresses feedback too aggressively. Editing also still uses the old full-screen dark overlay, so only the running phase stopped blocking work.

#174 therefore treats edit/run/terminal states as one product flow:

- editor becomes a non-blocking workspace-side surface while preserving existing DOM IDs and mature recipient/content logic;
- runtime panel remains compact but exposes structured Job progress (not DOM-parsed progress text);
- terminal state closes cleanly and failures expand in-app without a large system alert;
- account-scoped ownership, scheduler, attachment security, platform transports and send safety remain unchanged.

## Rejected validation artifacts

- `9530876594` / `geek-1.2.16-broadcast-validation-2c5ae792.exe`: REJECTED, renderer freeze. Never reuse.
- `9532121198` / `geek-1.2.16-broadcast-validation-738ff851.exe`: REJECTED, broadcast interaction freeze. Never reuse.

The later `9534323810` candidate proved the freeze fix and actual sending, but owner explicitly rejected it as the final product-quality candidate because the broadcast UX is still incomplete. Do not treat it as UX acceptance.

## Release boundary

- Test builds use `npm run dist:test` only.
- Do not modify `package.json.version` or `.github/release-client-version` for #174.
- No R2 upload, updater `latest.yml`, release tag, website version or formal client publication is authorized by this task.
- Do not merge #166 to `master` until a fresh #174 real-client product candidate is accepted.
- Any formal release requires separate explicit authorization and the current `docs/release-security.md` gate.
