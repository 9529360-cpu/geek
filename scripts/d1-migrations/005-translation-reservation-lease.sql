-- Durable lease for translation quota reservations.
-- Apply only after confirming the live D1 schema does not already contain this column/trigger.
ALTER TABLE translation_usage ADD COLUMN lease_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_translation_usage_lease
  ON translation_usage(lease_expires_at);

CREATE TRIGGER IF NOT EXISTS trg_translation_usage_reservation_lease
AFTER INSERT ON translation_usage
WHEN NEW.lease_expires_at IS NULL
  AND (NEW.status = 'reserved' OR NEW.status LIKE 'reserved:%')
BEGIN
  UPDATE translation_usage
  SET lease_expires_at = datetime('now', '+2 minutes')
  WHERE request_id = NEW.request_id
    AND lease_expires_at IS NULL;
END;
