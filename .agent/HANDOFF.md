# HANDOFF

Updated: 2026-08-24

## Live baseline

- Default branch: `master`.
- Verified `master` HEAD: `ddbc0d387b4ac061b44f94759aad6da3917f5019` (`release: Geek 1.2.16`).
- `package.json.version`: `1.2.16`.
- `.github/release-client-version`: `1.2.16`.
- Broadcast integration PR #166: `ux/broadcast-account-jobs`, head `cc552c2dc0271cef00fcbffa7c250b3d9e9af489`.
- Product-polish PR #175: `ux/broadcast-product-polish`; runtime/product code validated at head `2b383424380fdd8f48ef65ac48a1fb9a94142b1f` before this HANDOFF-only evidence update.
- Telegram pure-text child PR #180 merged into product branch as `6115887cd881c8afd948258a55d0ffd59868ddde`.
- Saved-selection child PR #181 merged into product branch as `ff3a2ab9379f49d92cf0d6fa0ca3909c73783201`.
- Private validation PR #183 is closed without merge after successful Windows validation; its artifact is the only current candidate.
- Formal client release has NOT been triggered; source integration and release remain separate actions.

## Task Queue

- P0 done — Account-scoped Broadcast Job/runtime/scheduler architecture and durable scheduled-attachment refs are integrated in #166.
- P0 done — Fix both renderer-starvation loops; scoped/idempotent observer contracts remain required.
- P0 done — Productize edit/run/terminal presentation on #175: workspace side sheet, richer account-scoped task panel, explicit terminal close, stable failure details.
- P0 done — Reject artifact `9535717311` / `geek-1.2.16-broadcast-polish-final-08fa79c4.exe` after owner real-client testing found Telegram pure-text and saved-selection regressions.
- P0 done — Remove temporary saved-selection wrapper/runtime experiments and stale loader reference from the final tree. Do not reintroduce a parallel verifier/state machine.
- P0 done — Issue #178 / PR #180: Telegram pure-text `platformTransportFor(...).sendText()` now reuses canonical `BROADCAST_ADAPTERS['telegram-z'].send`; attachment transport and target/composer guards are unchanged. Child merge-tree CI run `32775106566` passed 90/90 tests with 0 npm vulnerabilities.
- P0 done — Issue #179 / PR #181: original `broadcast-save-group` handler now awaits account-scoped persistence, applies UI only after persistence succeeds, renders the option before selecting it, and uses in-button progress/success/failure feedback. Child merge-tree CI run `32775372952` passed 90/90 tests with 0 npm vulnerabilities.
- P0 done — Combined #175 standard CI run `32775623403` checked merge tree `3932d295af82c9c7df92e77cd41054ba8b7f75bc`; Ubuntu 24.04 / Node 22.23.2 / npm 10.9.8; 91/91 tests passed and npm audit reported 0 vulnerabilities.
- P0 done — Fresh Windows private validation PR #183 checked merge tree `1a35bbbcf3fcbbaaec413f618f1f058ac54e457b` on Windows Server 2025; 91/91 tests passed including Windows ACL integration, `npm run dist:test` succeeded, artifact upload succeeded, and PR #183 was closed without merge.
- P0 done — Current candidate artifact: `9538030486`; installer `geek-1.2.16-broadcast-product-fixed-1a35bbbc.exe`; EXE SHA-256 `b09a1412e9d66048292c5d300144574464f815cfe1eaf9d82c667bfcfb7da73e`; manifest binds product head `2b383424380fdd8f48ef65ac48a1fb9a94142b1f`; `productionPublished: false`.
- P0 in_progress — Owner real-client revalidation: TG text-only, TG photo+caption, WA/LINE regression, save/reload/apply recipient collection, editor/workspace coexistence, task controls and terminal close.
- P1 planned — Issue #182 tracks adjacent saved-tag delete optimistic persistence. Keep it separate from P0/product acceptance; no source fix has been accepted for it yet.
- P1 planned — `docs/release-security.md` opening version statement is stale (1.2.14 vs live 1.2.16); correct it via separate documentation maintenance, not this runtime candidate.
- P1 planned — Only after fresh product acceptance, resume #166 integration toward `master`.
- P1 planned — Formal client release remains a separate explicitly authorized action under `docs/release-security.md`.

## Current implementation facts

### Telegram

- The rejected Windows candidate proved Telegram attachment/photo broadcast still works while pure text did not.
- Root cause was a duplicate narrow Telegram submit script inside `platformTransportFor(...).sendText()`.
- Validated product code delegates `sendText()` to the selected platform adapter's existing `transport.send`; Telegram therefore uses `telegram-z.send`.
- Telegram attachment transport remains separate and unchanged.

### Saved recipient/group collection

- The original save handler did not await sandbox persistence and selected the new tag id before the corresponding `<option>` existed.
- Validated product code waits for `accountStorageSetItem('broadcastGroups', ...)`, aborts on explicit `false`, renders saved options first, then selects the saved tag and refreshes the list.
- Save feedback is local to the existing button: `正在保存…` → `已保存 · N 个群`, or `保存失败，请重试`.
- No saved-selection wrapper, observer, or parallel state machine is present.

## Current validation candidate

- Validation workflow run: `32775944675` (`validate-broadcast-product-fixed-windows`), success.
- Validation PR: #183, closed without merge.
- Validation merge tree: `1a35bbbcf3fcbbaaec413f618f1f058ac54e457b`.
- Product head recorded by manifest: `2b383424380fdd8f48ef65ac48a1fb9a94142b1f`.
- Artifact ID: `9538030486`.
- Installer: `geek-1.2.16-broadcast-product-fixed-1a35bbbc.exe`.
- Installer SHA-256: `b09a1412e9d66048292c5d300144574464f815cfe1eaf9d82c667bfcfb7da73e`.
- Artifact ZIP digest: `7293275cd68bcb5c97b1521a4d6635d228f22ddff1aa84a91b9bf50ffcf5771e` (do not confuse with installer SHA-256).
- Build command: `npm run dist:test`.
- `productionPublished`: false.

## Rejected validation artifacts

- `9530876594` / `geek-1.2.16-broadcast-validation-2c5ae792.exe`: REJECTED, renderer freeze.
- `9532121198` / `geek-1.2.16-broadcast-validation-738ff851.exe`: REJECTED, broadcast interaction freeze.
- `9534323810` / `geek-1.2.16-broadcast-final-candidate-da649219.exe`: freeze fix/send capability only; owner rejected as overall UX acceptance.
- `9535717311` / `geek-1.2.16-broadcast-polish-final-08fa79c4.exe`: REJECTED, TG pure text fails and recipient selection save is broken. SHA-256 `2d85232bc6ec98c19ceb71e7c508d1dec7080816e6582c0c8f37d3ba03b0e200`. Never reuse.

## Release boundary

- Test builds use `npm run dist:test` only.
- Do not modify `package.json.version` or `.github/release-client-version` for these fixes.
- No R2 upload, updater `latest.yml`, release tag, website version or formal client publication is authorized.
- Do not merge #166 to `master` until the fresh real-client product candidate is accepted.
- Any formal release requires separate explicit authorization and the current `docs/release-security.md` gate.
