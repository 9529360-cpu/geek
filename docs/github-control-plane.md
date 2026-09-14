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

## Repository Actions Secrets

Configured project control-plane credential names:

- `CLOUDFLARE_API_TOKEN`: project-scoped Worker deployment and R2 publication token.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account identifier.
- `CLOUDFLARE_INFRA_API_TOKEN`: project-scoped infrastructure token for read-only verification and explicitly reviewed D1/DNS/route operations.

The infrastructure token must remain limited to the Geek Cloudflare account and the `bbnba.com` zone. It must not be expanded to billing, membership, API-token-management, unrelated accounts/zones or account-ownership permissions.

Provider/application secrets may be mirrored into GitHub only when an intentional rotation or automated secret-management workflow is added. Existing Worker secrets are not read or printed by deployment workflows.

## Worker validation plane

Cloudflare Worker validation and production deployment are separate ownership planes.

`.github/workflows/cloudflare-worker-validation.yml` is the non-production validation plane. It runs for relevant pull requests and `master` pushes when Worker/deployment source, tests, Wrangler config, deploy workflows, observer/smoke tooling, this control-plane documentation, or the recovery contract changes. It uses only `contents: read`, does not enter a production GitHub environment, does not write Issues, and does not consume Cloudflare deployment credentials.

The validation job installs dependencies with lifecycle scripts disabled, runs the repository test suite, syntax-checks Worker/deployment JavaScript, and bundles all four production Workers with the repository's current Wrangler deployment version using `wrangler deploy --dry-run --outdir ...`. Wrangler dry-run is the non-production bundle oracle: it proves that Wrangler can build the production config/entry graph without uploading a Worker.

Validation inputs are intentionally broader than production deployment inputs. In particular:

```text
test change != production artifact change
deployment observer change != Worker artifact change
deploy workflow change != automatic production deploy
```

A change to tests, `scripts/cloudflare-deploy-report.cjs`, `scripts/account-live-smoke.mjs`, a deploy workflow, or other validation/control-plane tooling must be able to revalidate the system without automatically publishing a Worker. Pull-request code must never receive production Worker deployment credentials.

## Automatic production deployment

Production deployment workflows run only from a matching `master` production artifact/config change or an explicit `workflow_dispatch`. They do not deploy pull-request code and therefore do not expose production deployment credentials to PR code.

For automatic `master` deployment, each Worker's `push.paths` is owned by its deployable input closure: the matching Wrangler config plus the repository-local modules reachable from that config's production `main` entry. Tests, smoke runners, deployment reporters, documentation, CI helpers and the deploy workflow file itself are validation inputs, not automatic production deployment inputs.

| Workflow | Independent production target | Public verification | Status channel |
|---|---|---|---|
| `deploy-website` | `geek-website` | `https://geek.bbnba.com/health` | #21 |
| `deploy-translate` | `geek-translate` | static translation `/health` endpoint | #21 |
| `deploy-release-worker` | `geek-release` | public updater `latest.yml` | #21 |
| `deploy-subscription` | `geek-subscription` | `https://admin.bbnba.com/health` plus account smoke | #21 and #23 |

Each service keeps its own workflow, concurrency boundary and Wrangler deployment. A failure in one service does not prevent unrelated services from deploying.

For every deployment, the same GitHub-hosted job performs the relevant sequence:

1. install dependencies without lifecycle scripts;
2. run the complete `npm test` suite;
3. syntax-check the affected Worker and helper scripts;
4. deploy with the matching Wrangler config;
5. verify a fixed public HTTPS endpoint;
6. publish a non-sensitive result to the Actions job summary and Issue #21.

The subscription workflow additionally runs registration, login, authenticated API and test-account cleanup smoke, then publishes that result to Issue #23. Its overall deployment report in #21 includes only the smoke outcome, not account details.

Translation, release and subscription share `scripts/cloudflare-deploy-report.cjs` for fixed endpoint selection, HTTPS verification, response-body discard and #21 publication. Website keeps its direct reporter. Status publication is part of the deployment result rather than a best-effort observer; a missing or failed report must not silently convert a failed deployment into success.

## Production evidence

Use this order when determining production state:

1. the corresponding live GitHub Actions run and its job/step conclusions;
2. the latest matching Issue #21 deployment comment;
3. for account behavior, the latest Issue #23 smoke comment;
4. current `master` workflow/source/Wrangler configuration;
5. dated Issue #50/history and old runbooks only as context after live evidence is known.

`.agent/HANDOFF.md` is a recovery contract/durable invariant document, not a production-state checkpoint. It may tell a maintainer **how** to recover evidence, but it must not substitute for Actions/#21/#23/live source.

Do not use a local maintenance container's DNS resolution as production evidence. Local environments may have transient network or resolver limits that say nothing about the GitHub-hosted deployment job.

Deployment reports may contain only:

- service/workflow name;
- overall, Wrangler, public verification and account-smoke outcome where applicable;
- HTTP status code;
- fixed public endpoint;
- workflow run link/identifier;
- commit SHA and trigger/time metadata.

They must not contain response bodies, DNS values, D1/R2/KV contents, API tokens, Authorization headers, cookies, JWTs, passwords, account data or user data.

## Client release boundary

`.github/workflows/release-client.yml` has two controlled entrypoints:

- a path-filtered `master` push when `.github/release-client-version` changes, used for a normal new-version release;
- an explicit `workflow_dispatch`, used only to retry the same authorized version after a failed release attempt.

Both paths validate that the marker exactly matches `package.json.version` and then execute the same Windows contract/build, artifact validation, previous-stable verification, immutable upload, rollback snapshot, `latest.yml`-last promotion and public verification sequence. Manual dispatch does not bypass any release safeguard.

A normal source, Worker or documentation merge must leave the marker unchanged and must not manually dispatch `release-client`. Formal new-version releases, deliberate same-version retries, certificate changes and changes to the public updater metadata require a separate release decision and the process documented in [`release-security.md`](release-security.md).

The release Worker deployment and a client release are different operations:

- `deploy-release-worker` deploys the updater-serving Worker code and verifies the existing public `latest.yml`.
- `release-client` builds and publishes a Windows installer/blockmap, promotes `latest.yml` last, and can be explicitly rerun only for an authorized same-version recovery.

Do not describe a release Worker code deployment as a new client release, and do not use the client release workflow as a general CI or deployment test.

Windows Authenticode certificate/secret ownership is intentionally outside routine maintenance and is tracked separately in Issue #445. Enabling signing must not bypass the release authorization or artifact/public-propagation gates.

## Repository merge-control boundary

The repository's expected exact-head merge discipline should be enforced by GitHub rules rather than maintainer memory. Current owner/admin follow-up for `master` branch protection and required status checks is tracked in Issue #444.

When that rule is configured, do not make a path-filtered workflow required unless it is guaranteed to emit a terminal check for every PR that needs it; otherwise a legitimate docs/source PR can be stuck forever waiting for a check that never starts. Always-emitted aggregate gates should be preferred for required-check policy.

Routine maintainers must not weaken CI or request broader administration credentials merely to bypass the control plane.

## Infrastructure access verification

`.github/workflows/verify-cloudflare-infra.yml` runs only on `master` or explicit dispatch. It uses `CLOUDFLARE_INFRA_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to perform read-only checks against the Cloudflare API.

The smoke check verifies access to the `bbnba.com` zone plus D1, R2, KV, Workers scripts, Pages, DNS records, Workers Routes and zone settings. It intentionally does not create, edit or delete Cloudflare resources. The report records only resource/check names, result and HTTP status; it does not include credential values, DNS records or Cloudflare response bodies.

## Infrastructure-token target scope

Account scope: only the account that owns the Geek Workers and D1.

Account permissions required for the current architecture:

- Workers Scripts: Edit
- Workers KV Storage: Edit
- Workers R2 Storage: Edit
- D1: Edit
- Cloudflare Pages: Edit
- Workers Builds Configuration: Edit
- Workers Observability: Edit
- Account Settings: Read

Zone scope: only `bbnba.com`.

Zone permissions required for the current architecture:

- DNS: Edit
- Workers Routes: Edit
- Zone: Read
- Zone Settings: Edit
- SSL and Certificates: Edit
- Cache Purge: Purge/Edit when available in the dashboard permission selector

Do not add Billing Edit, Memberships Edit, API Tokens Edit, Account Settings Edit, or permissions for unrelated accounts/zones.

Permissions and product availability can change. Before making an infrastructure change, verify the current Cloudflare/GitHub configuration and the minimum privilege actually required; this list is an architecture target, not permission to silently expand a token.

## Safety rules

- Never commit API tokens, passwords, OAuth sessions, cookies, API keys, JWT secrets or provider credentials.
- Never export browser profiles, cookies or HAR files into the repository.
- Production deploy and infrastructure workflows must not run on `pull_request` events.
- Destructive D1 migrations must be explicit migration files and must not be re-run blindly.
- DNS and zone changes must be represented as reviewed repository changes before automation applies them.
- Cloudflare login ownership, 2FA recovery, billing and credential rotation remain owner-controlled outside routine maintenance.
- Payment QR content must derive from the current server-provided address; do not hard-code a second destination in website or deployment tooling.
- Release Worker routes remain updater-only and must not become a general static-file service.

## Agent recovery

A future maintenance agent should read `AGENTS.md`, `.agent/HANDOFF.md` and `docs/README.md` for durable rules and document authority, then **query live GitHub** for current `master`, version/marker, open PR/Issues and current Actions before selecting work. Read this file and relevant Wrangler/workflow configuration for control-plane changes. Issue #50 remains the long-term dated checkpoint/history channel and is useful only after live state is established.

Routine code, Worker deployment and CI can be managed through the repository. Infrastructure mutations must use the minimum scoped credential through a purpose-built, reviewed workflow rather than exposing its value.