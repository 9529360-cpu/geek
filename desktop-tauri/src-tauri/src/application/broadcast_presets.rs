//! One transactional owner for reusable presets; no directory or platform effects.
use super::ports::BroadcastPresetRepository;
use crate::domain::{
    account::{valid_id, MAX_ACCOUNTS},
    account_backup::PresetBackup,
    broadcast_presets::{
        normalize_preset_name, validate_exclusions, validate_preset_message,
        validate_preset_recipients, BroadcastAudiencePreset, BroadcastMessagePreset,
        BroadcastPresetDocument, BroadcastPresetKind, BroadcastPresetSnapshot,
        MAX_PRESETS_PER_COLLECTION, MAX_PRESET_REVISION, PRESET_SCHEMA_VERSION,
    },
    error::{AppError, Result},
};
use uuid::Uuid;

pub struct BroadcastPresets<R: BroadcastPresetRepository> {
    repository: R,
    document: BroadcastPresetDocument,
}

impl<R: BroadcastPresetRepository> BroadcastPresets<R> {
    pub fn open(repository: R) -> Result<Self> {
        let document = repository.load()?.unwrap_or_default();
        document.validate()?;
        Ok(Self {
            repository,
            document,
        })
    }

    pub fn snapshot(&self, account_id: &str) -> Result<BroadcastPresetSnapshot> {
        if !valid_id(account_id) {
            return Err(AppError::BroadcastPresetInvalid);
        }
        Ok(self
            .document
            .accounts
            .iter()
            .find(|account| account.account_id == account_id)
            .cloned()
            .unwrap_or_else(|| BroadcastPresetSnapshot::empty(account_id)))
    }

    pub fn save_message(
        &mut self,
        account_id: &str,
        expected_revision: u64,
        name: &str,
        message: &str,
    ) -> Result<BroadcastPresetSnapshot> {
        let name = normalize_preset_name(name)?;
        validate_preset_message(message)?;
        self.update(account_id, expected_revision, |account| {
            if let Some(existing) = account.messages.iter_mut().find(|entry| entry.name == name) {
                if existing.message == message {
                    return Ok(false);
                }
                existing.message = message.into();
            } else {
                if account.messages.len() == MAX_PRESETS_PER_COLLECTION {
                    return Err(AppError::BroadcastPresetLimit);
                }
                account.messages.push(BroadcastMessagePreset {
                    id: Uuid::new_v4().to_string(),
                    name,
                    message: message.into(),
                });
            }
            Ok(true)
        })
    }

    pub fn save_audience(
        &mut self,
        account_id: &str,
        expected_revision: u64,
        name: &str,
        recipient_ids: Vec<String>,
    ) -> Result<BroadcastPresetSnapshot> {
        let name = normalize_preset_name(name)?;
        validate_preset_recipients(&recipient_ids)?;
        self.update(account_id, expected_revision, |account| {
            if account.audiences.len() == MAX_PRESETS_PER_COLLECTION {
                return Err(AppError::BroadcastPresetLimit);
            }
            account.audiences.push(BroadcastAudiencePreset {
                id: Uuid::new_v4().to_string(),
                name,
                recipient_ids,
            });
            Ok(true)
        })
    }

    pub fn save_exclusions(
        &mut self,
        account_id: &str,
        expected_revision: u64,
        excluded_contact_ids: Vec<String>,
        excluded_group_ids: Vec<String>,
    ) -> Result<BroadcastPresetSnapshot> {
        validate_exclusions(&excluded_contact_ids, &excluded_group_ids)?;
        self.update(account_id, expected_revision, |account| {
            if account.excluded_contact_ids == excluded_contact_ids
                && account.excluded_group_ids == excluded_group_ids
            {
                return Ok(false);
            }
            account.excluded_contact_ids = excluded_contact_ids;
            account.excluded_group_ids = excluded_group_ids;
            Ok(true)
        })
    }

    /// Used under the same owner lock as new-job submission. Existing frozen jobs
    /// are independent; this deny list cannot create targets or edit their intent.
    pub fn ensure_not_excluded(&self, account_id: &str, recipient_ids: &[String]) -> Result<()> {
        let current = self.snapshot(account_id)?;
        let excluded = current
            .excluded_contact_ids
            .iter()
            .chain(&current.excluded_group_ids)
            .collect::<std::collections::HashSet<_>>();
        if recipient_ids.iter().any(|id| excluded.contains(id)) {
            return Err(AppError::BroadcastExclusionConflict);
        }
        Ok(())
    }

    pub fn delete(
        &mut self,
        account_id: &str,
        expected_revision: u64,
        kind: BroadcastPresetKind,
        id: &str,
    ) -> Result<BroadcastPresetSnapshot> {
        if !valid_id(id) {
            return Err(AppError::BroadcastPresetInvalid);
        }
        self.update(account_id, expected_revision, |account| {
            let removed = match kind {
                BroadcastPresetKind::Message => {
                    let index = account.messages.iter().position(|entry| entry.id == id);
                    index.map(|index| account.messages.remove(index)).is_some()
                }
                BroadcastPresetKind::Audience => {
                    let index = account.audiences.iter().position(|entry| entry.id == id);
                    index.map(|index| account.audiences.remove(index)).is_some()
                }
            };
            if !removed {
                return Err(AppError::BroadcastPresetUnknown);
            }
            Ok(true)
        })
    }

    pub fn audience(
        &self,
        account_id: &str,
        expected_revision: u64,
        id: &str,
    ) -> Result<BroadcastAudiencePreset> {
        if !valid_id(id) {
            return Err(AppError::BroadcastPresetInvalid);
        }
        self.at_revision(account_id, expected_revision)?
            .audiences
            .into_iter()
            .find(|entry| entry.id == id)
            .ok_or(AppError::BroadcastPresetUnknown)
    }

    /// Validate the entire replacement and store limit without publishing it.
    pub fn validate_restore(
        &self,
        account_id: &str,
        expected_revision: u64,
        backup: &PresetBackup,
    ) -> Result<()> {
        let current = self.at_revision(account_id, expected_revision)?;
        let mut candidate = self.restore_snapshot(&current, backup)?;
        if candidate != current {
            candidate.revision = next_revision(candidate.revision)?;
            self.candidate_document(&candidate)?;
        }
        Ok(())
    }

    /// Restored recipients remain hints: only the existing catalog can resolve
    /// them into a later audience. Portable input cannot restore preset UUIDs.
    pub fn restore(
        &mut self,
        account_id: &str,
        expected_revision: u64,
        backup: &PresetBackup,
    ) -> Result<BroadcastPresetSnapshot> {
        let current = self.at_revision(account_id, expected_revision)?;
        let candidate = self.restore_snapshot(&current, backup)?;
        self.update(account_id, expected_revision, |account| {
            if *account == candidate {
                return Ok(false);
            }
            *account = candidate;
            Ok(true)
        })
    }

    fn restore_snapshot(
        &self,
        current: &BroadcastPresetSnapshot,
        backup: &PresetBackup,
    ) -> Result<BroadcastPresetSnapshot> {
        backup.validate()?;
        let mut candidate = current.clone();
        if let Some(messages) = &backup.messages {
            candidate.messages = messages
                .iter()
                .map(|message| BroadcastMessagePreset {
                    id: current
                        .messages
                        .iter()
                        .find(|entry| entry.name == message.name)
                        .map(|entry| entry.id.clone())
                        .unwrap_or_else(|| Uuid::new_v4().to_string()),
                    name: message.name.clone(),
                    message: message.message.clone(),
                })
                .collect();
        }
        if let Some(audiences) = &backup.audiences {
            // Duplicate audience names are valid. Match each identical row once
            // so a retry preserves both content and independent local identities.
            let mut remaining = current.audiences.iter().collect::<Vec<_>>();
            candidate.audiences = audiences
                .iter()
                .map(|audience| {
                    let existing = remaining.iter().position(|entry| {
                        entry.name == audience.name && entry.recipient_ids == audience.recipient_ids
                    });
                    let id = existing
                        .map(|index| remaining.remove(index).id.clone())
                        .unwrap_or_else(|| Uuid::new_v4().to_string());
                    BroadcastAudiencePreset {
                        id,
                        name: audience.name.clone(),
                        recipient_ids: audience.recipient_ids.clone(),
                    }
                })
                .collect();
        }
        if let Some(contacts) = &backup.excluded_contact_ids {
            candidate.excluded_contact_ids = contacts.clone();
        }
        if let Some(groups) = &backup.excluded_group_ids {
            candidate.excluded_group_ids = groups.clone();
        }
        validate_exclusions(
            &candidate.excluded_contact_ids,
            &candidate.excluded_group_ids,
        )?;
        Ok(candidate)
    }

    fn at_revision(&self, account_id: &str, expected: u64) -> Result<BroadcastPresetSnapshot> {
        if expected > MAX_PRESET_REVISION {
            return Err(AppError::BroadcastPresetInvalid);
        }
        let current = self.snapshot(account_id)?;
        if current.revision != expected {
            return Err(AppError::BroadcastPresetConflict);
        }
        Ok(current)
    }

    fn update(
        &mut self,
        account_id: &str,
        expected: u64,
        edit: impl FnOnce(&mut BroadcastPresetSnapshot) -> Result<bool>,
    ) -> Result<BroadcastPresetSnapshot> {
        let mut account = self.at_revision(account_id, expected)?;
        if !edit(&mut account)? {
            return Ok(account);
        }
        account.revision = next_revision(account.revision)?;
        let next = self.candidate_document(&account)?;
        self.repository
            .save(&next)
            .map_err(|_| AppError::BroadcastPresetPersistence)?;
        // Empty account rows retain their revision: deleting the last preset must
        // not let an old revision-zero draft become authoritative after restart.
        self.document = next;
        Ok(account)
    }

    fn candidate_document(
        &self,
        account: &BroadcastPresetSnapshot,
    ) -> Result<BroadcastPresetDocument> {
        let mut next = self.document.clone();
        next.schema_version = PRESET_SCHEMA_VERSION;
        if let Some(existing) = next
            .accounts
            .iter_mut()
            .find(|entry| entry.account_id == account.account_id)
        {
            *existing = account.clone();
        } else {
            if next.accounts.len() == MAX_ACCOUNTS {
                return Err(AppError::BroadcastPresetLimit);
            }
            next.accounts.push(account.clone());
        }
        next.validate()?;
        Ok(next)
    }
}

fn next_revision(revision: u64) -> Result<u64> {
    revision
        .checked_add(1)
        .filter(|revision| *revision <= MAX_PRESET_REVISION)
        .ok_or(AppError::BroadcastPresetLimit)
}
