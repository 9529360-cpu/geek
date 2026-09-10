-- Phase 2: run only after the account_no-aware Worker is deployed.
-- This repairs rows that an old Worker could have inserted after 003 but before the deploy completed.
UPDATE users
SET account_no = 'GK-' || lower(hex(randomblob(16)))
WHERE account_no IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_account_no ON users(account_no);
