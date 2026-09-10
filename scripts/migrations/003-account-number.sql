-- Phase 1: expand + backfill. Keep the column nullable during the old-Worker/new-Worker cutover.
ALTER TABLE users ADD COLUMN account_no TEXT;

UPDATE users
SET account_no = 'GK-' || lower(hex(randomblob(16)))
WHERE account_no IS NULL;

CREATE UNIQUE INDEX idx_users_account_no ON users(account_no);
