# D1 migration operations

Geek treats production D1 schema changes as a control plane separate from Worker deployment. A green Worker PR, a Wrangler dry-run, or an existing SQL file does not prove that the production database is on the required schema.

## Source of truth

Before any schema mutation, recover the live state from production D1 and the current `master` commit. Do not infer an applied migration from a file name, an old PR, a historical runbook, or the canonical create-schema file.

The repository has legacy migrations under `scripts/migrations/`. Their effects predate the managed migration epoch and production historically did not record those files in Wrangler's legacy `d1_migrations` ledger. They are archaeology and compatibility evidence; **do not point Wrangler migrations at that directory and do not fabricate historical applied timestamps to make the ledger look complete**.

Wrangler-managed production migrations start at migration 005 and use:

- config: `wrangler-d1-migrations.toml`;
- directory: `scripts/d1-migrations/`;
- ledger: `geek_d1_migrations`;
- database: `geek-subscriptions`.

Only one migration is admitted in the managed directory at a time. This prevents `wrangler d1 migrations apply` from crossing an unreviewed rollout boundary by applying multiple newly-added files in one run.

Migration tests use immutable pre-migration schema fixtures under `scripts/d1-baselines/`. For migration 005, `004-subscription-schema.sql` is the frozen schema after the proven legacy 002–004 effects and before any 005 artifact. Do not replace a migration baseline with the moving `scripts/geek-subscription-schema.sql`: the canonical schema is expected to advance after a migration lands, while a migration's input state must remain reproducible.

## Production workflow boundary

`.github/workflows/d1-migrations-production.yml` is manual-only. It has no push or pull-request mutation trigger, runs only when dispatched from `master`, uses the infrastructure D1 credential, and never deploys a Worker.

Two modes exist:

- `plan`: read-only inspection of `translation_usage`, the expected indexes/triggers, and managed-ledger existence. It intentionally does **not** run `wrangler d1 migrations list` against production because Wrangler initializes the migration ledger before listing.
- `apply`: requires the exact admitted migration name and an exact human-readable confirmation token. It is still a production schema mutation and must be explicitly authorized before dispatch.

The repository guard fails closed when it sees a partial migration, an out-of-band schema change, an unexpected managed-ledger entry, or a later migration's schema before the current admission is complete. An empty managed ledger with no current migration artifacts is retryable because Wrangler may have initialized the ledger before an interrupted migration attempt.

## Migration 005 rollout

Migration `005-translation-reservation-lease.sql` is additive. It adds `translation_usage.lease_expires_at`, the lease index, and the reservation lease trigger. It does not refund or delete old reservations by itself.

Required order:

1. Merge the schema-control-plane admission containing **only** managed migration 005 to `master`.
2. Dispatch `d1-migrations-production` in `plan` mode from `master`. The state must be exactly `ready`; any partial or future schema is a stop condition.
3. Obtain explicit authorization for the production schema mutation.
4. Dispatch the same workflow in `apply` mode with migration `005-translation-reservation-lease.sql` and confirmation `APPLY 005-translation-reservation-lease.sql`.
5. Require the workflow postflight to prove the lease column, index, trigger, and the exact `geek_d1_migrations` ledger entry. Migration 006 replay columns/index must still be absent.
6. Only after 005 is verified may the translation Worker change that depends on reservation leases merge to `master` and use the repository's normal automatic translation Worker deployment path.
7. Verify the production Worker deployment and non-sensitive service health evidence separately from the schema migration evidence.

Do not merge a Worker that requires 005 before step 5 is complete. The automatic `deploy-translate` workflow is intentionally not made schema-aware; migration ordering is established before the Worker PR enters `master`.

## Migration 006 and later

Do not place migration 006 in `scripts/d1-migrations/` while 005 is still the admitted production migration. After the 005-dependent Worker is deployed and healthy, make a separate schema admission that replaces the one-migration boundary with 006, updates the guard's expected pre/post state, validates it locally, then repeats the plan → explicit authorization → apply → verify sequence.

This one-at-a-time rule is deliberate: each schema boundary can be stopped, reviewed, and verified before application code depending on it is deployed.

## Local / PR validation

`cloudflare-worker-validation` receives no production infrastructure secret. It creates an isolated local D1 database from the immutable pre-005 fixture `scripts/d1-baselines/004-subscription-schema.sql`, runs the admitted managed migration with the pinned Wrangler version, then verifies the resulting schema and managed ledger using `scripts/d1-migration-guard.cjs`.

This proves that the D1-only Wrangler config is accepted and that the migration executes against its actual prior schema, while allowing the current canonical schema to advance independently after rollout. Local success is not production evidence.

## Stop conditions

Stop before mutation or before the next rollout phase if any of these are true:

- live schema does not match the guard's exact pre-migration state;
- the managed ledger contains an unexpected migration;
- only some expected migration artifacts exist;
- a later migration's columns/indexes are already present;
- the reviewed `master` commit moved after the intended admission;
- Cloudflare infrastructure access validation fails;
- Wrangler migration application or postflight fails;
- production Worker deployment/health regresses after a verified schema migration.

Do not fix a stop condition by dropping columns/indexes, deleting migration ledger rows, editing production data, broadening secrets, or manually marking a migration as applied. Those are separate high-risk operations requiring their own evidence and authorization.

## Privacy and logs

Migration workflows may print schema names, migration filenames, counts, and pass/fail state. They must not select or publish account identifiers, emails, password material, request IDs, source text, translated text, tokens, cookies, authorization headers, or other user data. Production verification should use aggregate or schema-only queries unless a separately authorized incident procedure requires more.
