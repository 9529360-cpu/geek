//! Portable settings only. Target identity, revisions and execution stay local.
mod legacy;
mod strict_json;

use super::{
    account::Account,
    broadcast_presets::{
        normalize_preset_name, validate_exclusions, validate_exclusions_for_platform,
        validate_preset_message, validate_preset_recipients, BroadcastPresetSnapshot,
        MAX_PRESETS_PER_COLLECTION,
    },
    error::{AppError, Result},
    translation::{
        supports_receive, valid_receive_chat_id, ChatTranslationPolicy, TranslationPolicy,
        TranslationSettings,
    },
};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::{BTreeMap, HashSet};

pub const BACKUP_SCHEMA: &str = "geek-account-settings";
pub const BACKUP_VERSION: u32 = 3;
pub const MAX_BACKUP_BYTES: usize = 8 * 1024 * 1024;
const EXCLUDED_KEYS: &[&str] = &["sendHistory", "scheduleTasks", "broadcastJobSchedules"];

// An absent component preserves current data. Explicit null must not silently
// acquire that meaning, especially during a reviewed destructive replacement.
fn present<'de, D, T>(deserializer: D) -> std::result::Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupAccount {
    pub name: String,
    #[serde(rename = "type")]
    pub account_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupMessage {
    pub name: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupAudience {
    pub name: String,
    pub recipient_ids: Vec<String>,
}

#[derive(Clone, Default, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresetBackup {
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub messages: Option<Vec<BackupMessage>>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub audiences: Option<Vec<BackupAudience>>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub excluded_contact_ids: Option<Vec<String>>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub excluded_group_ids: Option<Vec<String>>,
}

impl PresetBackup {
    pub fn from_snapshot(snapshot: &BroadcastPresetSnapshot) -> Self {
        Self {
            messages: Some(
                snapshot
                    .messages
                    .iter()
                    .map(|entry| BackupMessage {
                        name: entry.name.clone(),
                        message: entry.message.clone(),
                    })
                    .collect(),
            ),
            audiences: Some(
                snapshot
                    .audiences
                    .iter()
                    .map(|entry| BackupAudience {
                        name: entry.name.clone(),
                        recipient_ids: entry.recipient_ids.clone(),
                    })
                    .collect(),
            ),
            excluded_contact_ids: Some(snapshot.excluded_contact_ids.clone()),
            excluded_group_ids: Some(snapshot.excluded_group_ids.clone()),
        }
    }

    pub fn is_present(&self) -> bool {
        self.messages.is_some()
            || self.audiences.is_some()
            || self.excluded_contact_ids.is_some()
            || self.excluded_group_ids.is_some()
    }

    pub fn validate(&self) -> Result<()> {
        if !self.is_present() {
            return Err(AppError::BackupInvalid);
        }
        let mut names = HashSet::new();
        if let Some(messages) = &self.messages {
            if messages.len() > MAX_PRESETS_PER_COLLECTION {
                return Err(AppError::BroadcastPresetLimit);
            }
            for message in messages {
                if normalize_preset_name(&message.name)? != message.name
                    || !names.insert(&message.name)
                {
                    return Err(AppError::BroadcastPresetInvalid);
                }
                validate_preset_message(&message.message)?;
            }
        }
        if let Some(audiences) = &self.audiences {
            if audiences.len() > MAX_PRESETS_PER_COLLECTION {
                return Err(AppError::BroadcastPresetLimit);
            }
            for audience in audiences {
                if normalize_preset_name(&audience.name)? != audience.name {
                    return Err(AppError::BroadcastPresetInvalid);
                }
                validate_preset_recipients(&audience.recipient_ids)?;
            }
        }
        validate_exclusions(
            self.excluded_contact_ids.as_deref().unwrap_or_default(),
            self.excluded_group_ids.as_deref().unwrap_or_default(),
        )?;
        Ok(())
    }

    pub fn validate_for_platform(&self, platform: &str) -> Result<()> {
        self.validate()?;
        validate_exclusions_for_platform(
            platform,
            self.excluded_contact_ids.as_deref().unwrap_or_default(),
            self.excluded_group_ids.as_deref().unwrap_or_default(),
        )?;
        if let Some(audiences) = &self.audiences {
            if audiences
                .iter()
                .flat_map(|entry| &entry.recipient_ids)
                .any(|id| !valid_receive_chat_id(platform, id))
            {
                return Err(AppError::BroadcastPresetInvalid);
            }
        }
        Ok(())
    }
}

#[derive(Clone, Default, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranslationBackup {
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub global: Option<TranslationPolicy>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub chats: Option<BTreeMap<String, ChatTranslationPolicy>>,
}

impl TranslationBackup {
    pub fn from_settings(settings: &TranslationSettings) -> Self {
        Self {
            global: Some(settings.global.clone()),
            chats: Some(settings.chats.clone()),
        }
    }

    pub fn apply_to(
        &self,
        current: &TranslationSettings,
        platform: &str,
    ) -> Result<TranslationSettings> {
        if self.global.is_none() && self.chats.is_none() {
            return Err(AppError::BackupInvalid);
        }
        if !supports_receive(platform) {
            return Err(AppError::TranslationUnavailable);
        }
        let candidate = TranslationSettings {
            revision: current.revision,
            global: self
                .global
                .clone()
                .unwrap_or_else(|| current.global.clone()),
            chats: self.chats.clone().unwrap_or_else(|| current.chats.clone()),
        };
        candidate.validate_for_platform(platform)?;
        Ok(candidate)
    }
}

#[derive(Clone, Default, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupData {
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub presets: Option<PresetBackup>,
    #[serde(
        default,
        deserialize_with = "present",
        skip_serializing_if = "Option::is_none"
    )]
    pub translation: Option<TranslationBackup>,
}

impl BackupData {
    pub fn validate_for_platform(&self, platform: &str) -> Result<()> {
        if let Some(presets) = &self.presets {
            presets.validate_for_platform(platform)?;
        }
        if let Some(translation) = &self.translation {
            translation.apply_to(&TranslationSettings::default(), platform)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountBackup {
    pub schema: String,
    pub version: u32,
    pub exported_at: String,
    pub account: BackupAccount,
    pub data: BackupData,
    #[serde(default)]
    pub excludes: Vec<String>,
}

impl AccountBackup {
    pub fn export(
        account: &Account,
        presets: &BroadcastPresetSnapshot,
        exported_at: String,
    ) -> Result<Self> {
        if account.id != presets.account_id {
            return Err(AppError::BackupInvalid);
        }
        let record = Self {
            schema: BACKUP_SCHEMA.into(),
            version: BACKUP_VERSION,
            exported_at,
            account: BackupAccount {
                name: account.name.clone(),
                account_type: account.platform_id.clone(),
            },
            data: BackupData {
                presets: Some(PresetBackup::from_snapshot(presets)),
                translation: Some(TranslationBackup::from_settings(&account.translation)),
            },
            excludes: EXCLUDED_KEYS.iter().map(|key| (*key).into()).collect(),
        };
        validate_metadata(&record.account, &record.exported_at, &record.excludes)?;
        record.data.validate_for_platform(&account.platform_id)?;
        if serde_json::to_vec(&record)
            .map_err(|_| AppError::BackupInvalid)?
            .len()
            > MAX_BACKUP_BYTES
        {
            return Err(AppError::BackupLimit);
        }
        Ok(record)
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackupImport {
    pub version: u32,
    pub account: BackupAccount,
    pub data: BackupData,
    pub reported_unsupported: Vec<String>,
    pub ignored_keys: Vec<String>,
}

fn validate_metadata(
    account: &BackupAccount,
    exported_at: &str,
    excludes: &[String],
) -> Result<()> {
    let bounded = |value: &str, limit: usize| {
        value.encode_utf16().count() <= limit && !value.chars().any(char::is_control)
    };
    if !bounded(&account.name, 256)
        || !bounded(&account.account_type, 64)
        || exported_at.is_empty()
        || !bounded(exported_at, 64)
        || excludes.len() > EXCLUDED_KEYS.len()
        || excludes
            .iter()
            .any(|key| !EXCLUDED_KEYS.contains(&key.as_str()))
    {
        return Err(AppError::BackupInvalid);
    }
    Ok(())
}

pub fn parse_account_backup(bytes: &[u8], target_platform: &str) -> Result<BackupImport> {
    if bytes.len() > MAX_BACKUP_BYTES {
        return Err(AppError::BackupLimit);
    }
    let value = strict_json::parse(bytes)?;
    if value.get("schema").and_then(|value| value.as_str()) != Some(BACKUP_SCHEMA) {
        return Err(AppError::BackupInvalid);
    }
    let version = value
        .get("version")
        .and_then(|value| value.as_u64())
        .ok_or(AppError::BackupVersion)?;
    let imported = match version {
        2 => legacy::parse(value)?,
        3 => {
            let record: AccountBackup =
                serde_json::from_value(value).map_err(|_| AppError::BackupInvalid)?;
            validate_metadata(&record.account, &record.exported_at, &record.excludes)?;
            if record.data.presets.is_none() && record.data.translation.is_none() {
                return Err(AppError::BackupInvalid);
            }
            BackupImport {
                version: record.version,
                account: record.account,
                data: record.data,
                reported_unsupported: Vec::new(),
                ignored_keys: Vec::new(),
            }
        }
        _ => return Err(AppError::BackupVersion),
    };
    imported.data.validate_for_platform(target_platform)?;
    Ok(imported)
}
