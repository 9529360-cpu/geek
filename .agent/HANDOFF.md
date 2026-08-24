# HANDOFF

Updated: 2026-08-24

## Live baseline

- Default branch: `master`.
- Verified `master` HEAD: `ddbc0d387b4ac061b44f94759aad6da3917f5019` (`release: Geek 1.2.16`).
- `package.json.version`: `1.2.16`.
- `.github/release-client-version`: `1.2.16`.
- Broadcast integration PR #166: `ux/broadcast-account-jobs`, head `cc552c2dc0271cef00fcbffa7c250b3d9e9af489`.
- Product-polish PR #175: `ux/broadcast-product-polish`; both focused P0 regression fixes are now integrated into this branch.
- Telegram pure-text child PR #180 merged into #175 product branch as `6115887cd881c8afd948258a55d0ffd59868ddde`.
- Saved-selection child PR #181 merged into #175 product branch as `ff3a2ab9379f49d92cf0d6fa0ca3909c73783201`.
- Validation PR #177 is closed without merge; its artifact is rejected by real-client testing.
- Formal client release has NOT been triggered; source integration and release remain separate actions.

## Task Queue

- P0 done — Account-scoped Broadcast Job/runtime/scheduler architecture and durable scheduled-attachment refs are integrated in #166.
- P0 done — Fix both renderer-starvation loops; scoped/idempotent observer contracts remain required.
- P0 done — Productize edit/run/terminal presentation on #175: workspace side sheet, richer account-scoped task panel, explicit terminal close, stable failure details.
- P0 done — Reject artifact `9535717311` / `geek-1.2.16-broadcast-polish-final-08fa79c4.exe` after owner real-client testing found two regressions: Telegram photos send but pure text broadcast does not; recipient-area `保存当前选择` does not persist/apply reliably.
- P0 done — Remove temporary saved-selection wrapper/runtime experiments and stale loader reference from the final tree. Do not reintroduce a parallel verifier/state machine.
- P0 done — Issue #178 / PR #180: Telegram pure-text `platformTransportFor(...).sendText()` now reuses canonical `BROADCAST_ADAPTERS['telegram-z'].send`; no Telegram special-case remains in `broadcast-runtime.js`, attachment transport and target/composer guards are unchanged. PR merge-tree CI run `32775106566` passed 90/90 tests with 0 npm vulnerabilities.
- P0 done — Issue #179 / PR #181: original `broadcast-save-group` handler now awaits account-scoped persistence, applies UI only after persistence succeeds, renders the option before selecting it, normalizes whitespace-only names, and uses in-button progress/success/failure feedback instead of a blocking success alert. PR merge-tree CI run `32775372952` passed 90/90 tests with 0 npm vulnerabilities.
- P0 in_progress — Run standard CI on the combined final #175 merge tree containing both regression fixes and both contracts. Expected combined contract count is 91 if no unrelated test changes land.
- P0 planned — Review combined #175 diff/security/regression surface and fix any CI failure before packaging.
- P0 planned — Build ONE fresh Windows private candidate from the final fixed product head. Do not reuse artifact `9535717311` or any earlier broadcast candidate.
- P0 planned — Owner real-client revalidation: TG text-only, TG photo+caption, WA/LINE regression, save/reload/apply recipient collection, editor/workspace coexistence, task controls and terminal close.
- P1 planned — After P0 combined CI is green, inspect adjacent saved-tag delete persistence semantics for the same optimistic-write pattern; fix only via a separate Issue/branch/PR if needed.
- P1 planned — Only after fresh product acceptance, resume #166 integration toward `master`.
- P1 planned — Formal client release remains a separate explicitly authorized action under `docs/release-security.md`.

## Current implementation facts

### Telegram

- The rejected Windows candidate proved Telegram attachment/photo broadcast still works while pure text did not.
- Root cause was a duplicate narrow Telegram submit script inside `platformTransportFor(...).sendText()`.
- Final product branch delegates `sendText()` to the selected platform adapter's existing `transport.send`; Telegram therefore uses `telegram-z.send` like the rest of the adapter abstraction.
- Telegram attachment transport remains separate and unchanged.

### Saved recipient/group collection

- The original save handler did not await sandbox persistence and selected the new tag id before the corresponding `<option>` existed.
- Final product branch waits for `accountStorageSetItem('broadcastGroups', ...)`, aborts on explicit `false`, renders saved options first, then selects the saved tag and refreshes the list.
- Save feedback is local to the existing button: `正在保存…` → `已保存 · N 个群`, or `保存失败，请重试`.
- No saved-selection wrapper, observer, or parallel state machine is present.

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
