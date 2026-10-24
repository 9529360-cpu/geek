//! Account-owned reusable text and frozen audiences, independent of live jobs.
mod exclusions;
mod storage;

use super::{
    account::{valid_id, MAX_ACCOUNTS},
    broadcast::MAX_TARGETS,
    broadcast_render::validate_text,
    error::{AppError, Result},
};
#[cfg(test)]
pub use exclusions::validate_exclusion_ids;
pub use exclusions::{
    exclusion_kind, validate_exclusions, validate_exclusions_for_platform, ExclusionKind,
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use zeroize::Zeroizing;

pub const PRESET_SCHEMA_VERSION: u32 = 2;
pub const MAX_PRESETS_PER_COLLECTION: usize = 100;
pub const MAX_PRESET_STORE_BYTES: usize = 2 * 1024 * 1024 - 4096;
pub const MAX_PRESET_REVISION: u64 = 9_007_199_254_740_991;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BroadcastMessagePreset {
    pub id: String,
    pub name: String,
    pub message: String,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BroadcastAudiencePreset {
    pub id: String,
    pub name: String,
    pub recipient_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BroadcastPresetKind {
    Message,
    Audience,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BroadcastPresetSnapshot {
    pub account_id: String,
    pub revision: u64,
    pub messages: Vec<BroadcastMessagePreset>,
    pub audiences: Vec<BroadcastAudiencePreset>,
    pub excluded_contact_ids: Vec<String>,
    pub excluded_group_ids: Vec<String>,
}

impl BroadcastPresetSnapshot {
    pub fn empty(account_id: &str) -> Self {
        Self {
            account_id: account_id.into(),
            revision: 0,
            messages: Vec::new(),
            audiences: Vec::new(),
            excluded_contact_ids: Vec::new(),
            excluded_group_ids: Vec::new(),
        }
    }
}

#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(try_from = "storage::StoredDocument")]
pub struct BroadcastPresetDocument {
    pub schema_version: u32,
    pub accounts: Vec<BroadcastPresetSnapshot>,
}

impl Default for BroadcastPresetDocument {
    fn default() -> Self {
        Self {
            schema_version: PRESET_SCHEMA_VERSION,
            accounts: Vec::new(),
        }
    }
}

pub fn normalize_preset_name(value: &str) -> Result<String> {
    let name = value.trim();
    if name.is_empty() || name.encode_utf16().count() > 80 || name.chars().any(char::is_control) {
        return Err(AppError::BroadcastPresetInvalid);
    }
    Ok(name.into())
}

pub fn validate_preset_message(message: &str) -> Result<()> {
    if message.trim().is_empty() {
        return Err(AppError::BroadcastPresetInvalid);
    }
    validate_text(message).map_err(|_| AppError::BroadcastPresetInvalid)
}

/// The same contact/group ID shapes admitted by the native broadcast catalog.
pub fn valid_preset_recipient(id: &str) -> bool {
    if super::translation::valid_telegram_chat_id(id) {
        return true;
    }
    let Some((number, server)) = id.split_once('@') else {
        return false;
    };
    let digits = |value: &str| {
        !value.is_empty() && value.len() <= 30 && value.bytes().all(|byte| byte.is_ascii_digit())
    };
    match server {
        "c.us" | "lid" => digits(number),
        "g.us" => number.split_once('-').map_or_else(
            || digits(number),
            |(left, right)| digits(left) && digits(right) && right.len() <= 20,
        ),
        _ => false,
    }
}

pub fn validate_preset_recipients(ids: &[String]) -> Result<()> {
    if ids.len() > MAX_TARGETS {
        return Err(AppError::BroadcastPresetLimit);
    }
    let mut seen = HashSet::new();
    if ids.is_empty()
        || ids
            .iter()
            .any(|id| !valid_preset_recipient(id) || !seen.insert(id))
    {
        return Err(AppError::BroadcastPresetInvalid);
    }
    Ok(())
}

impl BroadcastPresetDocument {
    pub fn validate(&self) -> Result<()> {
        if !matches!(self.schema_version, 1 | PRESET_SCHEMA_VERSION) {
            return Err(AppError::BroadcastPresetInvalid);
        }
        if self.accounts.len() > MAX_ACCOUNTS {
            return Err(AppError::BroadcastPresetLimit);
        }
        let mut accounts = HashSet::new();
        let mut ids = HashSet::new();
        for account in &self.accounts {
            if !valid_id(&account.account_id)
                || !accounts.insert(&account.account_id)
                || account.revision == 0
                || account.revision > MAX_PRESET_REVISION
            {
                return Err(AppError::BroadcastPresetInvalid);
            }
            if self.schema_version == 1
                && (!account.excluded_contact_ids.is_empty()
                    || !account.excluded_group_ids.is_empty())
            {
                return Err(AppError::BroadcastPresetInvalid);
            }
            validate_exclusions(&account.excluded_contact_ids, &account.excluded_group_ids)?;
            if account.messages.len() > MAX_PRESETS_PER_COLLECTION
                || account.audiences.len() > MAX_PRESETS_PER_COLLECTION
            {
                return Err(AppError::BroadcastPresetLimit);
            }
            let mut names = HashSet::new();
            for message in &account.messages {
                if !valid_id(&message.id)
                    || !ids.insert(&message.id)
                    || normalize_preset_name(&message.name)? != message.name
                    || !names.insert(&message.name)
                {
                    return Err(AppError::BroadcastPresetInvalid);
                }
                validate_preset_message(&message.message)?;
            }
            for audience in &account.audiences {
                if !valid_id(&audience.id)
                    || !ids.insert(&audience.id)
                    || normalize_preset_name(&audience.name)? != audience.name
                {
                    return Err(AppError::BroadcastPresetInvalid);
                }
                validate_preset_recipients(&audience.recipient_ids)?;
            }
        }
        let encoded =
            Zeroizing::new(serde_json::to_vec(self).map_err(|_| AppError::BroadcastPresetInvalid)?);
        if encoded.len() > MAX_PRESET_STORE_BYTES {
            return Err(AppError::BroadcastPresetLimit);
        }
        Ok(())
    }
}
