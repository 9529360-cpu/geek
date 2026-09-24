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

Migration tests use immutable pre-migration fixtures under `scripts/d1-baselines/`. The current 006 admission uses `005-translation-reservation-schema.sql`, which freezes the verified post-005 table/index/trigger state plus the local managed-ledger fixture recording 005. Do not replace a migration baseline with the moving `scripts/geek-subscription-schema.sql`: the canonical schema is expected to advance after a migration lands, while a migration's input state must remain reproducible.

## Production workflow boundary

`.github/workflows/d1-migrations-production.yml` is manual-only. It has no push or pull-request mutation trigger, runs only when dispatched from `master`, uses the infrastructure D1 credential, and never deploys a Worker.

Two modes exist:

- `plan`: read-only inspection of `translation_usage`, the expected indexes/triggers, and managed-ledger existence. It intentionally does **not** run `wrangler d1 migrations list` against production because Wrangler initializes the migration ledger before listing.
- `apply`: requires the exact admitted migration name and an exact human-readable confirmation token. It is still a production schema mutation and must be explicitly authorized before dispatch.

The repository guard fails closed when it sees a partial migration, an out-of-band schema change, an unexpected managed-ledger entry, or a later migration's schema before the current admission is complete. For the current 006 boundary, the verified 005 managed-ledger entry is a prerequisite: a missing/empty ledger is a stop condition. A retry is safe only when the complete 005 prerequisite remains recorded and no partial 006 artifact has appeared.

## Migration 005 completed state

Migration `005-translation-reservation-lease.sql` is complete in production. The authorized apply and postflight verified the lease column, lease index, reservation trigger, and managed ledger entry before the dependent recovery Worker was merged. The recovery Worker and its bounded Cron owner are deployed, and the public aggregate health projection reached `staleReservations.count = 0`.

Migration 005 is therefore historical prerequisite state, not the current admitted migration. Its SQL is no longer present in the one-at-a-time managed directory; the immutable post-005 state is preserved in `scripts/d1-baselines/005-translation-reservation-schema.sql`.

## Migration 006 rollout

Migration `006-translation-outcome-replay.sql` is additive. It adds `translation_usage.request_hash`, `replay_ciphertext`, `replay_expires_at`, and `idx_translation_usage_replay_expiry`. It does not rewrite user rows, plaintext chat content, translation content, or quota values.

Required order:

1. Merge the schema-control-plane admission containing **only** managed migration 006 to `master`.
2. Dispatch `d1-migrations-production` in `plan` mode from `master`. The state must be exactly `ready`; the guard must prove the complete 005 lease schema and exact 005 managed-ledger entry while all 006 artifacts are absent.
3. Obtain explicit authorization for the production schema mutation.
4. Dispatch the same workflow in `apply` mode with migration `006-translation-outcome-replay.sql` and confirmation `APPLY 006-translation-outcome-replay.sql`.
5. Require postflight to prove all three replay columns, the replay-expiry index, the preserved 005 lease artifacts, and exact managed-ledger entries for 005 and 006.
6. Only after 006 is verified may the outcome-recovery Worker/runtime PR become Ready and merge to `master`.
7. Verify the normal translation Worker deployment and privacy-safe service health separately from the schema migration evidence.

Do not merge application code that requires 006 before step 5 is complete. The automatic `deploy-translate` workflow remains intentionally schema-agnostic; migration ordering is established before the Worker PR enters `master`.

The one-at-a-time rule remains deliberate for later migrations: each schema boundary must replace the currently admitted SQL, carry an immutable pre-migration baseline, and pass plan → explicit authorization → apply → verify before dependent code deploys.

## Local / PR validation

`cloudflare-worker-validation` receives no production infrastructure secret. It creates an isolated local D1 database from the immutable post-005 / pre-006 fixture `scripts/d1-baselines/005-translation-reservation-schema.sql`, runs admitted migration 006 with the pinned Wrangler version, then verifies the resulting replay schema and managed ledger using `scripts/d1-migration-guard.cjs`.

This proves that the D1-only Wrangler config is accepted and that 006 executes against its exact prior schema/ledger state, while allowing the current canonical schema to advance independently after rollout. Local success is not production evidence.

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
