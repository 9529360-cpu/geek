# HANDOFF

Updated: 2026-08-24

## Live baseline

- Default branch: `master`.
- Verified `master` HEAD: `ddbc0d387b4ac061b44f94759aad6da3917f5019` (`release: Geek 1.2.16`).
- `package.json.version`: `1.2.16`.
- `.github/release-client-version`: `1.2.16`.
- Broadcast integration PR #166: `ux/broadcast-account-jobs`, head `cc552c2dc0271cef00fcbffa7c250b3d9e9af489`.
- Product PR #175: `ux/broadcast-product-polish`; product code + HANDOFF head validated for this candidate is `7402629f248202e977bd6a6b9814cb2dbf9038e3`.
- Formal `master` already contains the refined compact broadcast dialog (`90dadad12447229b4d7ec93dfb0aba48726136ac`, merged by `d658c0a91199d1c2446596da37344e2ed4319d5a`). That formal editor is the UX baseline and must not be replaced by the Job controller.
- Formal client release has NOT been triggered; source integration and release remain separate actions.

## Task Queue

- P0 done — Account-scoped Broadcast Job/runtime/scheduler architecture and durable scheduled-attachment refs are integrated in #166.
- P0 done — Fix both renderer-starvation loops; account observers remain scoped and no `document.body` MutationObserver is allowed.
- P0 done — Issue #178 / PR #180: Telegram pure-text `sendText()` reuses canonical `BROADCAST_ADAPTERS['telegram-z'].send`; TG attachment transport and safety guards remain unchanged. Child merge-tree CI `32775106566`: 90/90, 0 npm vulnerabilities.
- P0 done — Issue #179 / PR #181: original `broadcast-save-group` handler awaits account-scoped persistence, renders the saved option before selecting it, and uses in-button save feedback. Child merge-tree CI `32775372952`: 90/90, 0 npm vulnerabilities.
- P0 done — REJECT artifact `9538030486` / `geek-1.2.16-broadcast-product-fixed-1a35bbbc.exe` after owner real-client testing reported the overall broadcast UX was materially worse than formal 1.2.16. Never reuse or offer again.
- P0 done — Issue #184 / PR #185: remove the rejected full-height side sheet, four-stat grid, account/current-next activity card, editor copy rewrites and editor summary observer. Restore formal compact editor ownership. Controller now only owns the compact upper-right Job bar; new Job creation closes the editor; terminal exposes explicit `关闭` and failure detail. PR #185 merge-tree CI `32778331461`: 92/92, npm audit 0 vulnerabilities.
- P0 done — Latest combined #175 merge-tree CI `32778496608`, merge tree `4d350e12a33a183f6157a99c2b98df3278d6b3d3`: 92/92 tests passed, npm audit 0 vulnerabilities.
- P0 done — Final #175 diff review: `ui/app.js` differs from #166 only by the focused Telegram pure-text submit removal and saved-selection persistence/order/feedback fix; controller no longer owns formal editor layout/copy.
- P0 done — Fresh Windows private validation PR #186 checked merge tree `7f10234aa42c5857656f0b840edacc609d193c5a` on Windows Server 2025; Windows 92/92 tests passed including ACL integration; `npm run dist:test` succeeded; artifact upload succeeded. PR #186 closed without merge.
- P0 in_progress — Owner real-client validation of the ONE current candidate below: formal compact editor quality, submit then editor auto-closes, compact upper-right task bar, terminal Close, TG text-only, TG photo+caption, WA/LINE regression, save/reload/apply saved group selection.
- P1 planned — Issue #182 tracks saved-tag delete optimistic persistence; keep separate from P0 acceptance.
- P1 planned — `docs/release-security.md` opening version statement is stale (1.2.14 vs live 1.2.16); fix separately.
- P1 planned — Only after real-client product acceptance, resume #166 integration toward `master`.
- P1 planned — Formal client release remains a separate explicitly authorized action under `docs/release-security.md`.

## Current validation candidate

- This is the ONLY current candidate. All earlier broadcast artifacts remain rejected.
- Validation PR: #186, closed without merge.
- Windows workflow run: `32778633018` (`validate-broadcast-formal-ux-windows`), success.
- Validation merge tree/source commit: `7f10234aa42c5857656f0b840edacc609d193c5a`.
- Product head bound in manifest: `7402629f248202e977bd6a6b9814cb2dbf9038e3`.
- Artifact ID: `9538979997`.
- Installer: `geek-1.2.16-broadcast-formal-ux-7f10234a.exe`.
- Installer SHA-256: `47be91c87142d0e0bb730d7094be263e04e90b241b451441846c7e1fd110ace3`.
- Artifact ZIP digest: `9f74f7846167d6b8cc96bc17cb6079218068f4f0e297a39b2194dd9b5a3f08ef` (not the EXE hash).
- EXE SHA was verified in three places: completed Actions log, validation manifest, and independently after downloading/unpacking the artifact in the maintenance environment.
- Build command: `npm run dist:test`.
- `productionPublished`: false.

## Current UX contract

### Editor

- Formal/master compact broadcast dialog is the source of truth for layout, backdrop, modal semantics, copy and footer behavior.
- `ui/broadcast-job-controller.js` must not inject `#broadcast-overlay` geometry/style overrides, rewrite editor copy, or observe editor mutations.
- When a genuinely new account-owned Job appears after submission, the open editor is hidden so the chat workspace is visible again.

### Sending feedback

- One compact upper-right account-scoped Job bar, approximately 350 px max width.
- Running: concise `current / total`, success/failure counts and next-send countdown, with pause/resume and stop.
- Terminal: explicit `关闭`; failed jobs can reveal failure details.
- No four-stat dashboard, no account hero row, no current/next-recipient activity block, no full-height side sheet.

### Telegram

- Text-only submission delegates to the selected adapter's canonical `transport.send`; no Telegram-only runtime submit special-case.
- Telegram attachment transport remains separate and unchanged.

### Saved recipient/group collection

- Save waits for `accountStorageSetItem('broadcastGroups', ...)`; explicit `false` aborts UI application.
- Saved options render before the new tag is selected.
- Save feedback is local to the existing button (`正在保存…` / `已保存 · N 个群` / `保存失败，请重试`).
- No saved-selection wrapper, observer or parallel state machine.

## Rejected validation artifacts

- `9530876594` / `geek-1.2.16-broadcast-validation-2c5ae792.exe`: REJECTED, renderer freeze.
- `9532121198` / `geek-1.2.16-broadcast-validation-738ff851.exe`: REJECTED, broadcast interaction freeze.
- `9534323810` / `geek-1.2.16-broadcast-final-candidate-da649219.exe`: send/freeze validation only; owner rejected UX.
- `9535717311` / `geek-1.2.16-broadcast-polish-final-08fa79c4.exe`: REJECTED, TG pure text fails + saved selection broken.
- `9538030486` / `geek-1.2.16-broadcast-product-fixed-1a35bbbc.exe`: REJECTED, overall UX materially worse than formal release. Never reuse.

## Release boundary

- Test builds use `npm run dist:test` only.
- Do not modify `package.json.version` or `.github/release-client-version` for these fixes.
- No R2 upload, updater `latest.yml`, release tag, website version or formal client publication is authorized.
- Do not merge #166/#175 to `master` until the fresh real-client product candidate is accepted.
- Any formal release requires separate explicit authorization and the current `docs/release-security.md` gate.
