# HANDOFF

Updated: 2026-08-24

## Live baseline

- Default branch: `master`.
- Verified `master` HEAD: `ddbc0d387b4ac061b44f94759aad6da3917f5019` (`release: Geek 1.2.16`).
- `package.json.version`: `1.2.16`.
- `.github/release-client-version`: `1.2.16`.
- Broadcast integration PR #166 remains Draft on `ux/broadcast-account-jobs`.
- Current broadcast integration code baseline: `cc552c2dc0271cef00fcbffa7c250b3d9e9af489` before this HANDOFF-only rollback record.
- Product branch `ux/broadcast-product-polish` was exactly 25 commits ahead of #166 with merge base `cc552c2dc0271cef00fcbffa7c250b3d9e9af489` and 0 commits behind. Owner rejected the branch in real-client testing and ordered it abandoned.
- PR #175 is closed without merge and explicitly marked DO NOT MERGE / DO NOT REUSE.
- Formal `master` and formal 1.2.16 release were not changed by this rollback.
- No formal client release was triggered.

## Task Queue

- P0 done — Abandon the entire `ux/broadcast-product-polish` line after owner real-client rejection. Do not cherry-pick its UI, Telegram, saved-selection, contract, or HANDOFF commits back into #166 by default.
- P0 done — Close product follow-up Issues #174, #178, #179, #182 and #184 as `not_planned`; any future reproduction must be re-evaluated from the then-current live baseline.
- P0 done — Reject all Windows artifacts produced from the abandoned product line, including artifact `9538979997` / `geek-1.2.16-broadcast-formal-ux-7f10234a.exe`. Never reuse or offer them again.
- P0 done — Restore `ux/broadcast-account-jobs` as the active pre-productization integration baseline. No reverse cherry-pick or history rewrite was needed because #175 was never merged into #166 or `master`.
- P0 blocked — Physically delete remote refs `ux/broadcast-product-polish` and `validation/broadcast-formal-ux-1.2.16`. The currently available GitHub connector exposes PR/Issue/file/ref-move operations but no branch-ref deletion action. Do not force-move or rewrite these refs as a substitute; delete them only through an authorized branch-delete path when available.
- P1 planned — Reassess #166 itself before any further group-broadcast work. Treat current #166 code and contracts as the only candidate integration state; do not assume any behavior from the abandoned product branch is fixed or required.
- P1 planned — Formal client release remains a separate explicitly authorized action under `docs/release-security.md`.

## Rollback facts

- `ux/broadcast-product-polish` compare against `ux/broadcast-account-jobs` before abandonment:
  - merge base: `cc552c2dc0271cef00fcbffa7c250b3d9e9af489`
  - ahead: 25 commits
  - behind: 0 commits
  - changed runtime files included `ui/app.js` and `ui/broadcast-job-controller.js`, plus product-specific contracts and HANDOFF changes.
- Because the product branch was never merged into #166, restoring the prior state means using #166 directly; no source revert commit is required on #166.
- PR #175 is closed without merge.
- Validation PR #186 is closed without merge.
- Product-derived Issues #174/#178/#179/#182/#184 are closed as not planned.

## Rejected artifacts

All broadcast test installers produced from the abandoned product/validation line are rejected and must not be offered again, including:

- `9530876594` / `geek-1.2.16-broadcast-validation-2c5ae792.exe`
- `9532121198` / `geek-1.2.16-broadcast-validation-738ff851.exe`
- `9534323810` / `geek-1.2.16-broadcast-final-candidate-da649219.exe`
- `9535717311` / `geek-1.2.16-broadcast-polish-final-08fa79c4.exe`
- `9538030486` / `geek-1.2.16-broadcast-product-fixed-1a35bbbc.exe`
- `9538979997` / `geek-1.2.16-broadcast-formal-ux-7f10234a.exe`

## Release boundary

- Do not modify `package.json.version` or `.github/release-client-version` for ordinary broadcast maintenance.
- Do not publish R2 artifacts, updater `latest.yml`, tags, website release metadata, or a formal client without separate explicit authorization.
- Do not merge #166 to `master` merely because the abandoned product branch has been closed; #166 requires its own fresh review and validation.
