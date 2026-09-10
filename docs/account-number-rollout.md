# Public account number model and rollout

`users.id` remains Geek's internal numeric database key. It continues to back foreign keys, JWT `uid`, session authorization, orders, quota accounting, password reset records and admin mutation routes. It must not be presented as the customer-support account number.

`users.account_no` is the public, immutable support reference. Its contract is `GK-` followed by 32 lowercase hexadecimal characters representing 16 random bytes, for example `GK-58b81cb8727a9fbc947b2f4fb89231ad`. New values are generated only on the server with Workers Web Crypto `crypto.getRandomValues(new Uint8Array(16))`. A unique D1 index is the final collision arbiter; the Worker retries only `account_no` uniqueness conflicts a bounded number of times.

The public number is not a login credential, session key or authorization input. A user request is still authorized from the existing server-verified session/JWT and internal `users.id`. Admin mutation endpoints continue to accept numeric internal IDs.

## Why the migration is two-phase

Migration `003-account-number.sql` deliberately adds `account_no` as nullable, backfills all rows that already exist with SQLite `randomblob(16)`, and creates the unique index. Leaving the new column nullable is a compatibility requirement during the rollout window: an already-deployed old Worker can continue inserting its old column list after 003 has been applied.

The account-number-aware Worker is deployed second. New registration writes `account_no` itself, while login and authenticated user loading lazily repair a NULL `account_no`. This closes the old-writer race for users who become active before the cleanup migration.

Migration `004-account-number-repair.sql` is the post-deploy repair. It fills any NULL rows inserted by the old Worker during the cutover and reasserts the unique index with `IF NOT EXISTS`. Do not run 004 before the new Worker is confirmed deployed; otherwise an old Worker can create new NULL rows again.

## Production runbook

Production D1 migration and Worker deployment are separate operator actions. Repository CI must not silently apply production migrations.

1. Confirm the reviewed commit, the live `master` HEAD, the next unapplied D1 migration number, the subscription Worker production entry, and a recent backup/restore point. Confirm there is no already-deployed equivalent `account_no` implementation.
2. Before migration, query `PRAGMA table_info(users);`, `PRAGMA index_list(users);`, `SELECT COUNT(*) AS users FROM users;`, and snapshot non-secret integrity totals needed for comparison. Do not print account numbers or password material into Actions summaries or Issues.
3. Apply only migration `003-account-number.sql` to the production D1 using the normal Wrangler D1 migrations command for `wrangler-subscription.toml`. Stop if it fails; do not treat a failed migration as a partial success.
4. Verify immediately: `SELECT COUNT(*) AS missing FROM users WHERE account_no IS NULL;` must be zero for rows that existed before 003. Validate format and run `SELECT account_no, COUNT(*) AS c FROM users GROUP BY account_no HAVING account_no IS NOT NULL AND c > 1;`; the duplicate query must return no rows. Compare user count and business totals with the pre-check. Do not publish returned account numbers in CI summaries or issue comments.
5. Deploy the reviewed subscription Worker only after 003 is healthy. Do not deploy a Worker that requires `account_no` before 003 exists.
6. Run the account live smoke. It must verify registration, login and `/api/me` return the same valid account number, but its logs/status comments must include only pass/fail, never the generated value.
7. Apply `004-account-number-repair.sql` only after the new Worker deployment and smoke are healthy.
8. Repeat the NULL, malformed and duplicate checks. Also verify a small sample through authenticated/admin APIs without publishing full account numbers to logs.
9. Verify the website account center and Electron personal center display the server value, and verify admin exact account-number lookup plus legacy email lookup.

## Stop and rollback conditions

Stop before the next phase if a migration fails, duplicate/malformed rows appear, register/login/me disagree, existing user IDs or quota totals change unexpectedly, auth/session behavior regresses, or account numbers appear in logs/status channels.

Application rollback is safe only to a version that tolerates the nullable `account_no` column. Do not drop the column or unique index as an emergency response: that is a destructive schema change and would discard public identities already issued. If the new Worker must be rolled back after 003, the old Worker can still write NULL rows; keep 003 in place, repair those NULLs only after an account-number-aware Worker is restored, then run 004. If 004 has already run and an old Worker is restored, the same NULL-window risk returns because SQLite UNIQUE indexes allow multiple NULLs; restore the new Worker before performing another repair.
