# HANDOFF

Updated: 2026-08-24

## Live baseline

- Default branch: `master`.
- Verified `master` HEAD: `ddbc0d387b4ac061b44f94759aad6da3917f5019` (`release: Geek 1.2.16`).
- `package.json.version`: `1.2.16`.
- `.github/release-client-version`: `1.2.16`.
- Broadcast integration PR #166: `ux/broadcast-account-jobs`, head `cc552c2dc0271cef00fcbffa7c250b3d9e9af489`.
- Product-polish PR #175: `ux/broadcast-product-polish`, product head before the current regression fixes `4dfeef7e34be6ca22a5865c2d2ef04b7ef73c333`.
- Validation PR #177 is closed without merge; its artifact is now rejected by real-client testing.
- Formal client release has NOT been triggered; source integration and release remain separate actions.

## Task Queue

- P0 done — Account-scoped Broadcast Job/runtime/scheduler architecture and durable scheduled-attachment refs are integrated in #166.
- P0 done — Fix both renderer-starvation loops; scoped/idempotent observer contracts remain required.
- P0 done — Productize edit/run/terminal presentation on #175: workspace side sheet, richer account-scoped task panel, explicit terminal close, stable failure details.
- P0 done — Standard PR #175 CI run #559 (`32769300624`) passed on merge tree `b7f3b953aaa02b2541bf4fcb9aad0e8ce2b9d5fc`; 89/89 contracts.
- P0 done — Windows validation run `32769410578` passed on Windows Server 2025; 89/89 contracts, Windows ACL integration and `npm run dist:test` succeeded.
- P0 done — Reject artifact `9535717311` / `geek-1.2.16-broadcast-polish-final-08fa79c4.exe` after owner real-client testing found two regressions: Telegram photos send but pure text broadcast does not; the recipient-area `保存当前选择` action does not persist/apply the saved selection. CI/build success does not override these real-client failures.
- P0 in_progress — Root-cause and fix Telegram pure-text broadcast without weakening existing Telegram attachment behavior, transport safety or target/composer guards.
- P0 in_progress — Root-cause and fix recipient/group collection `保存当前选择`; preserve existing saved-group compatibility and avoid reintroducing blocking system alerts.
- P0 planned — Add focused contracts that reproduce both regressions, then run the full standard PR CI on the final merge tree.
- P0 planned — Build ONE fresh Windows private candidate from the final fixed product head. Do not reuse artifact `9535717311` or any earlier broadcast candidate.
- P0 planned — Owner real-client revalidation: TG text-only, TG photo+caption, WA/LINE regression, save/reload/apply recipient collection, editor/workspace coexistence, task controls and terminal close.
- P1 planned — Only after fresh product acceptance, resume #166 integration toward `master`.
- P1 planned — Formal client release remains a separate explicitly authorized action under `docs/release-security.md`.

## Current real-client findings

### Telegram

- Latest rejected candidate launches and Telegram attachment/photo broadcast succeeds.
- Telegram pure-text broadcast does not send.
- WA and LINE were reported normal in the same candidate.
- Treat this as a transport/runtime regression until source inspection proves otherwise; do not generalize the failure to Telegram attachments.

### Saved recipient/group collection

- In the broadcast recipient area, `保存当前选择` does not work in the latest candidate.
- The intended behavior remains: save the current selected chat IDs as a reusable collection, then allow later selection/filtering without deleting real chats/groups.
- System success `alert()` must not be restored as the completion UX.

## Rejected validation artifacts

- `9530876594` / `geek-1.2.16-broadcast-validation-2c5ae792.exe`: REJECTED, renderer freeze.
- `9532121198` / `geek-1.2.16-broadcast-validation-738ff851.exe`: REJECTED, broadcast interaction freeze.
- `9534323810` / `geek-1.2.16-broadcast-final-candidate-da649219.exe`: freeze fix/send capability only; owner rejected as overall UX acceptance.
- `9535717311` / `geek-1.2.16-broadcast-polish-final-08fa79c4.exe`: REJECTED, TG pure text fails and recipient selection save is broken. SHA-256 `2d85232bc6ec98c19ceb71e7c508d1dec7080816e6582c0c8f37d3ba03b0e200`. Never reuse.

## Release boundary

- Test builds use `npm run dist:test` only.
- Do not modify `package.json.version` or `.github/release-client-version` for these fixes.
- No R2 upload, updater `latest.yml`, release tag, website version or formal client publication is authorized.
- Do not merge #166 to `master` until a fresh real-client product candidate is accepted.
- Any formal release requires separate explicit authorization and the current `docs/release-security.md` gate.
