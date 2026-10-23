//! Completed receive translations only; cache records never authorize work or restore requests.
use super::{
    account::valid_id,
    error::{AppError, Result},
};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use zeroize::Zeroizing;

pub const MAX_TRANSLATION_CACHE_ENTRIES: usize = 256;
pub const MAX_TRANSLATION_CACHE_TEXT_BYTES: usize = 1024 * 1024;
pub const MAX_TRANSLATION_CACHE_ENTRY_BYTES: usize = 128 * 1024;
pub const MAX_TRANSLATION_CACHE_PLAIN_BYTES: usize = 2 * 1024 * 1024 - 4096;
pub const TRANSLATION_CACHE_TTL_SECONDS: u64 = 30 * 24 * 60 * 60;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranslationCacheEntry {
    /// Hash of the server user ID and account number, never a login credential.
    pub principal: String,
    pub account_id: String,
    /// Versioned, length-prefixed digest of the complete receive semantics.
    pub key: String,
    /// Original completion time in UNIX seconds. Reads must never renew this time.
    pub saved_at: u64,
    pub text: String,
}

impl TranslationCacheEntry {
    pub fn fresh(&self, now: u64) -> bool {
        now > 0
            && now
                .checked_sub(self.saved_at)
                .is_some_and(|age| age < TRANSLATION_CACHE_TTL_SECONDS)
    }

    fn valid(&self) -> bool {
        valid_hash(&self.principal)
            && valid_id(&self.account_id)
            && valid_hash(&self.key)
            && self.saved_at > 0
            && self.saved_at <= MAX_SAFE_INTEGER
            && !self.text.trim().is_empty()
            && self.text.len() <= MAX_TRANSLATION_CACHE_ENTRY_BYTES
    }
}

#[derive(Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranslationCacheDocument {
    pub schema_version: u32,
    pub entries: Vec<TranslationCacheEntry>,
}

impl Default for TranslationCacheDocument {
    fn default() -> Self {
        Self {
            schema_version: 1,
            entries: Vec::new(),
        }
    }
}

impl TranslationCacheDocument {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1 {
            return Err(AppError::StoreVersion);
        }
        if self.entries.len() > MAX_TRANSLATION_CACHE_ENTRIES {
            return Err(AppError::StoreInvalid);
        }
        let mut keys = HashSet::new();
        let mut text_bytes = 0usize;
        for entry in &self.entries {
            if !entry.valid() || !keys.insert(&entry.key) {
                return Err(AppError::StoreInvalid);
            }
            text_bytes = text_bytes
                .checked_add(entry.text.len())
                .ok_or(AppError::StoreInvalid)?;
            if text_bytes > MAX_TRANSLATION_CACHE_TEXT_BYTES {
                return Err(AppError::StoreInvalid);
            }
        }
        // JSON escaping can multiply control-character bytes; text size is not file size.
        let plain = Zeroizing::new(serde_json::to_vec(self).map_err(|_| AppError::StoreInvalid)?);
        if plain.len() > MAX_TRANSLATION_CACHE_PLAIN_BYTES {
            return Err(AppError::StoreInvalid);
        }
        Ok(())
    }
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}
