//! One transactional owner for reusable presets; no directory or platform effects.
use super::ports::BroadcastPresetRepository;
use crate::domain::{
    account::{valid_id, MAX_ACCOUNTS},
    broadcast_presets::{
        normalize_preset_name, validate_preset_message, validate_preset_recipients,
        BroadcastAudiencePreset, BroadcastMessagePreset, BroadcastPresetDocument,
        BroadcastPresetKind, BroadcastPresetSnapshot, MAX_PRESETS_PER_COLLECTION,
        MAX_PRESET_REVISION,
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
        account.revision = account
            .revision
            .checked_add(1)
            .filter(|revision| *revision <= MAX_PRESET_REVISION)
            .ok_or(AppError::BroadcastPresetLimit)?;
        let mut next = self.document.clone();
        if let Some(existing) = next
            .accounts
            .iter_mut()
            .find(|entry| entry.account_id == account_id)
        {
            *existing = account.clone();
        } else {
            if next.accounts.len() == MAX_ACCOUNTS {
                return Err(AppError::BroadcastPresetLimit);
            }
            next.accounts.push(account.clone());
        }
        next.validate()?;
        self.repository
            .save(&next)
            .map_err(|_| AppError::BroadcastPresetPersistence)?;
        // Empty account rows retain their revision: deleting the last preset must
        // not let an old revision-zero draft become authoritative after restart.
        self.document = next;
        Ok(account)
    }
}
