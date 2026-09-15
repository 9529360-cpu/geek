-- Recoverable translation outcomes for timeout-after-commit ambiguity.
-- Apply only after confirming the live D1 schema does not already contain these columns.
ALTER TABLE translation_usage ADD COLUMN request_hash TEXT;
ALTER TABLE translation_usage ADD COLUMN replay_ciphertext TEXT;
ALTER TABLE translation_usage ADD COLUMN replay_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_translation_usage_replay_expiry
  ON translation_usage(replay_expires_at);
