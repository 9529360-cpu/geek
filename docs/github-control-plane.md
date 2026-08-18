# GitHub control plane

This repository is the daily operations control plane for the Geek project. Production credentials stay in GitHub Repository Actions Secrets; plaintext secrets must never be committed.

## Production components

- Desktop app source and releases: this repository.
- Website Worker: `geek-website`, config `wrangler-website.toml`, custom domain `geek.bbnba.com`.
- Subscription/admin Worker: `geek-subscription`, config `wrangler-subscription.toml`, custom domain `admin.bbnba.com`, workers.dev endpoint enabled.
- Translation Worker: `geek-translate`, config `wrangler-translate.toml`, D1 binding `geek_subscriptions`.
- Release Worker: `geek-release`, config `wrangler.toml`, R2 bucket `geek-release`.
- D1: `geek-subscriptions`.
- Cloudflare zone: `bbnba.com`.

## Repository Actions Secrets

Configured project control-plane credentials:

- `CLOUDFLARE_API_TOKEN` - project-scoped Worker deployment token.
- `CLOUDFLARE_ACCOUNT_ID` - Cloudflare account identifier.
- `CLOUDFLARE_INFRA_API_TOKEN` - project-scoped infrastructure token for D1, DNS, Workers Routes and zone maintenance. Its value is stored only as a GitHub Repository Actions Secret and must never be copied into source, logs or documentation.

The infrastructure token must remain limited to the Geek Cloudflare account and the `bbnba.com` zone. It must not be expanded to billing, membership, API-token-management, unrelated accounts/zones or Cloudflare account-ownership permissions.

Provider/application secrets may be mirrored into GitHub only when an intentional rotation or automated secret-management workflow is added. Existing Cloudflare Worker secrets are not read or printed by deployment workflows.

## Automatic production deployment

Production deploy workflows run only from `master` pushes or an explicit `workflow_dispatch`; they do not deploy from pull requests and therefore do not expose deployment credentials to PR code.

- `.github/workflows/deploy-subscription.yml`
- `.github/workflows/deploy-website.yml`
- `.github/workflows/deploy-translate.yml`
- `.github/workflows/deploy-release-worker.yml`

Each workflow runs the full test suite, performs a syntax check for its Worker, then deploys using the matching Wrangler config.

## Infrastructure access verification

`.github/workflows/verify-cloudflare-infra.yml` runs only on `master` or explicit dispatch. It uses `CLOUDFLARE_INFRA_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to perform read-only checks against the Cloudflare API.

The smoke check verifies access to the `bbnba.com` zone plus D1, R2, KV, Workers scripts, Pages, DNS records, Workers Routes and zone settings. It intentionally does not create, edit or delete Cloudflare resources. This gives future maintainers a safe way to confirm that the GitHub control plane still has effective infrastructure access without printing credential values or production response bodies.

## Infrastructure-token target scope

The infrastructure token should cover project operations without becoming a Cloudflare account takeover token.

Account scope: only the account that owns the Geek Workers and D1.

Account permissions required for current architecture:

- Workers Scripts: Edit
- Workers KV Storage: Edit
- Workers R2 Storage: Edit
- D1: Edit
- Cloudflare Pages: Edit
- Workers Builds Configuration: Edit
- Workers Observability: Edit
- Account Settings: Read

Zone scope: only `bbnba.com`.

Zone permissions required for current architecture:

- DNS: Edit
- Workers Routes: Edit
- Zone: Read
- Zone Settings: Edit
- SSL and Certificates: Edit
- Cache Purge: Purge/Edit when available in the dashboard permission selector

Do not add Billing Edit, Memberships Edit, API Tokens Edit, Account Settings Edit, or permissions for unrelated accounts/zones.

## Safety rules

- Never commit API tokens, passwords, OAuth sessions, cookies, API keys, JWT secrets or provider credentials.
- Never export browser profiles, cookies or HAR files into the repository.
- Production deploy and infrastructure workflows must not run on `pull_request` events.
- Destructive D1 migrations must be explicit migration files and must not be re-run blindly.
- DNS and zone changes should be represented as reviewed repository changes before automation applies them.
- Cloudflare login ownership, 2FA recovery and billing remain owner-controlled outside GitHub.

## Agent handoff

A future maintenance agent should first read `AGENTS.md`, this file, and the relevant Wrangler config. Routine code, Worker deployment and GitHub CI can be managed through the repository. Infrastructure mutations must use `CLOUDFLARE_INFRA_API_TOKEN` through a purpose-built GitHub Actions workflow rather than exposing its value.
