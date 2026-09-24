-- Short-lived encrypted translation outcome replay for idempotent response recovery.
-- Production precondition: migration 005 is fully applied and verified.
ALTER TABLE translation_usage ADD COLUMN request_hash TEXT;
ALTER TABLE translation_usage ADD COLUMN replay_ciphertext TEXT;
ALTER TABLE translation_usage ADD COLUMN replay_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_translation_usage_replay_expiry
  ON translation_usage(replay_expires_at);
