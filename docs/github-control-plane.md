# GitHub control plane

This repository is the daily operations control plane for the Geek project. Production credentials remain in GitHub Repository Actions Secrets or Cloudflare Worker secrets; plaintext secrets must never be committed, printed or copied into Issue comments.

The current client/package version is intentionally not hard-coded in this operations guide. Before maintenance or release work, read the live `package.json.version`, `.github/release-client-version`, current `master` HEAD, open PR/Issues and relevant Actions runs. Read `AGENTS.md` and `.agent/HANDOFF.md` for durable rules/recovery invariants, not for a second copy of live status. Ordinary source and documentation changes must not modify the release marker. The normal new-version release path is marker-gated; explicit `workflow_dispatch` is reserved for an already authorized same-version recovery retry after a failed release attempt.

## Production components

- Desktop app source and releases: this repository.
- Website Worker: `geek-website`, config `wrangler-website.toml`, custom domain `geek.bbnba.com`.
- Subscription/admin Worker: `geek-subscription`, config `wrangler-subscription.toml`, custom domain `admin.bbnba.com`.
- Translation Worker: `geek-translate`, config `wrangler-translate.toml`, D1 binding `geek_subscriptions`.
- Release Worker: `geek-release`, config `wrangler.toml`, R2 bucket `geek-release`.
- D1: `geek-subscriptions`.
- Cloudflare zone: `bbnba.com`.

These names describe the repository's control-plane model. When diagnosing production, verify current Wrangler bindings/routes and Actions evidence instead of assuming a dated document proves deployment state.

## Repository Actions secrets

Configured project control-plane credential names include:

- `CLOUDFLARE_API_TOKEN`: project-scoped Worker deployment and R2 publication token.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account identifier.
- `CLOUDFLARE_INFRA_API_TOKEN`: infrastructure token for read-only verification and explicitly reviewed D1/DNS/route operations.

The infrastructure token must remain limited to the Geek Cloudflare account and the `bbnba.com` zone. Do not expand it to billing, membership, API-token-management, unrelated accounts/zones or account-ownership permissions merely to unblock routine maintenance.

Provider/application secrets may be mirrored into GitHub only when an intentional rotation or automated secret-management workflow is added. Existing Worker secrets are never read or printed by deployment workflows.

## Worker validation plane

Cloudflare Worker validation and production deployment are separate ownership planes.

`.github/workflows/cloudflare-worker-validation.yml` is the non-production validation plane. It runs for relevant pull requests and `master` pushes when Worker/deployment source, tests, Wrangler config, deployment workflows or observer/smoke tooling change. It uses only repository read access, does not enter a production GitHub environment and does not consume Cloudflare deployment credentials.

The validation job installs dependencies with lifecycle scripts disabled, runs repository tests, syntax-checks Worker/deployment JavaScript, and bundles the production Workers with Wrangler dry-run. A dry-run validates the deployable graph without uploading a Worker.

Keep these distinctions explicit:

```text
test change != production artifact change
deployment observer change != Worker artifact change
deploy workflow change != automatic production deploy
```

Pull-request code must never receive production Worker deployment credentials.

## Automatic production deployment

Production deployment workflows run only from matching `master` production artifact/config changes or an explicit authorized `workflow_dispatch`. They do not deploy pull-request code.

For automatic `master` deployment, each Worker's `push.paths` is owned by its deployable input closure: the matching Wrangler config plus repository-local modules reachable from that config's production entry. Tests, smoke runners, deployment reporters, documentation, CI helpers and deployment workflow files are validation/control-plane inputs and must not accidentally become production-deploy triggers.

| Workflow | Production target | Public verification | Status channel |
|---|---|---|---|
| `deploy-website` | `geek-website` | `https://geek.bbnba.com/health` | #21 |
| `deploy-translate` | `geek-translate` | translation `/health` endpoint | #21 |
| `deploy-release-worker` | `geek-release` | public updater `latest.yml` | #21 |
| `deploy-subscription` | `geek-subscription` | `https://admin.bbnba.com/health` plus account smoke | #21 and #23 |

Each service keeps its own workflow, concurrency boundary and Wrangler deployment. A failure in one service must not silently block or publish an unrelated service.

For every deployment, the same GitHub-hosted job performs the relevant sequence: install dependencies without lifecycle scripts, run the required test suite, syntax-check affected Worker/helper code, deploy with the matching Wrangler config, verify a fixed public HTTPS endpoint, and publish a non-sensitive result to the job summary and Issue #21. Subscription additionally runs its account smoke and reports the outcome to Issue #23 without exposing account details.

## Production evidence

Use this order when determining production state:

1. matching live GitHub Actions run and exact job/step conclusions;
2. latest matching Issue #21 deployment comment;
3. for account behavior, latest Issue #23 smoke comment;
4. current `master` workflow/source/Wrangler configuration;
5. dated Issue #50/history and old runbooks only as context.

`.agent/HANDOFF.md` is a recovery contract/durable invariant document, not a production-state checkpoint. It may tell a maintainer how to recover evidence, but it must not substitute for live Actions/#21/#23/source.

Do not use a local maintenance container's DNS result as production evidence. Deployment reports may contain only service/workflow name, pass/fail state, HTTP status, fixed public endpoint, workflow run link/identifier, commit SHA and trigger/time metadata. Never include response bodies, DNS values, D1/R2/KV contents, API tokens, Authorization headers, cookies, JWTs, passwords, account data or user data.

## Client release boundary

`.github/workflows/release-client.yml` has two controlled entrypoints:

- a marker-changing `master` push when `.github/release-client-version` changes, used for a normal authorized new-version release;
- explicit `workflow_dispatch`, used only to retry the same already-authorized version after a failed release attempt.

Both paths validate that the marker exactly matches `package.json.version` and execute the same Windows contract/build, artifact validation, previous-stable verification, immutable upload, rollback snapshot, `latest.yml`-last promotion and public verification sequence. Manual dispatch does not bypass release safeguards.

A normal source, Worker, test or documentation merge must leave the marker unchanged and must not manually dispatch `release-client`. Formal new-version releases, deliberate same-version retries, certificate changes and public updater metadata changes require a separate release decision and the process in [`release-security.md`](release-security.md).

`deploy-release-worker` and `release-client` are different operations: the former deploys updater-serving Worker code and verifies the existing updater; the latter builds and publishes a Windows client release. Never describe a release Worker deployment as a new client release.

## Repository merge-control boundary

`master` merge discipline is repository-enforced, not a maintainer-memory convention. Issue #444 records the completed rollout of repository protection; it is historical evidence, not an open owner/admin follow-up.

The exact live ruleset is dynamic and must be queried before relying on its current check names or policy. At the 2026-09-14 architecture audit, the active `Protect master` ruleset required pull requests, blocked branch deletion and non-fast-forward updates, used strict required-status-check policy, and required the always-emitted `test` and `electron-e2e` checks with no bypass actors. Future maintainers must re-read the live ruleset rather than treating this dated observation as permanent configuration.

The durable invariant is:

- direct unreviewed pushes are not the normal path;
- force-push/non-fast-forward and branch deletion stay blocked unless an explicit future emergency policy changes that boundary;
- required checks must be always-emitted gates, not path-filtered jobs that can remain permanently pending;
- current workflow contracts must preserve the required `test` and aggregate `electron-e2e` gate semantics while those names remain required by the live ruleset;
- routine maintainers must not weaken CI or request broader administration credentials merely to bypass merge control.

`test/master-merge-gate-contract.cjs` protects the repository-side workflow shape. The live GitHub ruleset remains the authority for repository enforcement itself.

## Infrastructure access verification

`.github/workflows/verify-cloudflare-infra.yml` runs only on `master` or explicit dispatch. It uses `CLOUDFLARE_INFRA_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` for read-only Cloudflare capability/status checks. It must not create, edit or delete Cloudflare resources merely to prove access.

The report records only resource/check names, result and HTTP status. It does not include credential values, DNS records or Cloudflare response bodies.

## Infrastructure-token target scope

Account scope is only the account that owns Geek Workers and D1. Current architecture may require Workers Scripts, KV, R2, D1, Pages, Workers Builds/Observability and Account Settings read capabilities; zone scope is only `bbnba.com`, with DNS, Workers Routes, Zone read/settings, SSL/certificates and cache purge capabilities as needed by reviewed infrastructure workflows.

Permission names and product availability can change. Before an infrastructure mutation, verify the current Cloudflare/GitHub configuration and minimum permission actually required. This section is an architecture target, not permission to silently expand a token.

Never add Billing Edit, Memberships Edit, API Tokens Edit, broad account ownership permissions or unrelated account/zone access for routine project work.

## Safety rules

- Never commit API tokens, passwords, OAuth sessions, cookies, API keys, JWT secrets or provider credentials.
- Never export browser profiles, cookies or HAR files into the repository.
- Production deploy and infrastructure workflows must not run on `pull_request` events.
- Destructive D1 migrations must be explicit migration files and must not be re-run blindly.
- DNS and zone changes must be represented as reviewed repository changes before automation applies them.
- Cloudflare login ownership, 2FA recovery, billing and credential rotation remain owner-controlled outside routine maintenance.
- Payment destination content must derive from current server-provided state; do not hard-code a second destination in website/deployment tooling.
- Release Worker routes remain updater-only and must not become a general static-file service.

## Agent recovery

A future maintenance agent should read `AGENTS.md`, `.agent/HANDOFF.md` and [`README.md`](README.md) for durable rules/document authority, then query live GitHub for current `master`, version/marker, open PR/Issues, current Actions and repository rules before selecting work. Read relevant Wrangler/workflow configuration for control-plane changes. Issue #50 remains the long-term dated checkpoint/history channel and is useful only after live state is established.

Routine code, Worker deployment and CI can be managed through the repository. Infrastructure mutations must use the minimum scoped credential through a purpose-built, reviewed workflow rather than exposing its value.
