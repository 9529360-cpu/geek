//! Original normalized translation policy, owned and persisted by Accounts.
use super::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const LANGUAGES: &[&str] = &[
    "zh", "en", "it", "es", "fr", "de", "pt", "ja", "ko", "hi", "ar", "ru", "id", "pl", "tr", "vi",
    "nl", "sv", "el", "th",
];
pub const MAX_CHAT_POLICIES: usize = 100;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranslationPolicy {
    pub provider: String,
    pub route: String,
    pub enabled: bool,
    pub auto_send: bool,
    pub source: String,
    pub target: String,
    pub message_action: bool,
    pub display_translation: bool,
    pub translation_mode: String,
    pub message_target: String,
    pub message_from: String,
    pub group_auto: bool,
    pub translate_history: bool,
    pub include_zh: bool,
    pub font_size: u8,
    pub font_color: String,
}

impl Default for TranslationPolicy {
    fn default() -> Self {
        Self {
            provider: "auto".into(),
            route: "default".into(),
            enabled: false,
            auto_send: false,
            source: "auto".into(),
            target: "en".into(),
            message_action: true,
            display_translation: true,
            translation_mode: "click".into(),
            message_target: "zh".into(),
            message_from: "auto".into(),
            group_auto: false,
            translate_history: false,
            include_zh: true,
            font_size: 13,
            font_color: "#667eea".into(),
        }
    }
}

impl TranslationPolicy {
    pub fn validate(&self) -> Result<()> {
        let source = |s: &str| s == "auto" || LANGUAGES.contains(&s);
        if !["auto", "local"].contains(&self.provider.as_str())
            || !["default", "primary", "backup"].contains(&self.route.as_str())
            || !["click", "auto"].contains(&self.translation_mode.as_str())
            || !source(&self.source)
            || !source(&self.message_from)
            || !LANGUAGES.contains(&self.target.as_str())
            || !LANGUAGES.contains(&self.message_target.as_str())
            || ![11, 13, 15].contains(&self.font_size)
            || self.font_color.len() != 7
            || !self.font_color.starts_with('#')
            || !self.font_color.as_bytes()[1..]
                .iter()
                .all(u8::is_ascii_hexdigit)
        {
            return Err(AppError::TranslationInvalid);
        }
        // These require a separate native SendIntent/history admission owner.
        // Reject unsupported truthy flags instead of silently promising behavior.
        if self.enabled || self.auto_send || self.translate_history {
            return Err(AppError::TranslationUnavailable);
        }
        Ok(())
    }
}

#[derive(Clone, Default, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranslationSettings {
    pub revision: u64,
    pub global: TranslationPolicy,
    pub chats: BTreeMap<String, TranslationPolicy>,
}

impl TranslationSettings {
    pub fn validate(&self) -> Result<()> {
        self.global.validate()?;
        if self.chats.len() > MAX_CHAT_POLICIES {
            return Err(AppError::TranslationLimit);
        }
        for (id, policy) in &self.chats {
            if !valid_chat_id(id) {
                return Err(AppError::TranslationInvalid);
            }
            policy.validate()?;
        }
        Ok(())
    }

    pub fn policy(&self, chat_id: &str) -> &TranslationPolicy {
        self.chats.get(chat_id).unwrap_or(&self.global)
    }
}

pub fn valid_chat_id(id: &str) -> bool {
    let Some((number, domain)) = id.split_once('@') else {
        return false;
    };
    !number.is_empty()
        && number.as_bytes()[0].is_ascii_digit()
        && number.len() <= 40
        && number.bytes().all(|b| b.is_ascii_digit() || b == b'-')
        && ["c.us", "lid", "g.us"].contains(&domain)
}

pub fn validate_text(text: &str) -> Result<()> {
    if text.trim().is_empty()
        || text.len() > 32_768
        || text.encode_utf16().count() > 10_000
        || text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(AppError::TranslationInvalid);
    }
    Ok(())
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IncomingTranslation {
    pub id: String,
    pub chat_id: String,
    pub message_id: String,
    pub text: String,
    pub manual: bool,
    #[serde(default)]
    pub refresh: bool,
    pub policy_revision: u64,
    pub attempt: u32,
    pub sent_at: u64,
}

impl IncomingTranslation {
    pub fn validate(&self) -> Result<()> {
        if !super::account::valid_id(&self.id)
            || !valid_chat_id(&self.chat_id)
            || !(1..=10_000).contains(&self.attempt)
            || self.message_id.is_empty()
            || self.message_id.len() > 256
            || self.message_id.chars().any(char::is_control)
        {
            return Err(AppError::TranslationInvalid);
        }
        validate_text(&self.text)
    }
}
