//! Original normalized translation policy, owned and persisted by Accounts.
use super::error::{AppError, Result};
use serde::{de::Error as _, Deserialize, Deserializer, Serialize};
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
        // History still requires a separate bounded admission owner.
        if self.translate_history {
            return Err(AppError::TranslationUnavailable);
        }
        Ok(())
    }

    pub fn validate_for_platform(&self, platform: &str) -> Result<()> {
        self.validate()?;
        // Messenger and Instagram rows have no proved direction or send time.
        // Click mode is the only receive policy those accounts can store.
        if receive_is_manual_only(platform) && (self.translation_mode != "click" || self.group_auto)
        {
            return Err(AppError::TranslationUnavailable);
        }
        Ok(())
    }

    pub fn should_translate_outgoing(&self, text: &str) -> bool {
        self.enabled
            && self.auto_send
            && (self.include_zh || !text.chars().any(|c| ('\u{3400}'..='\u{9fff}').contains(&c)))
    }
}

/// The original chat panel owns these seven choices. All other policy fields
/// continue to follow this account's latest global policy.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatTranslationPolicy {
    pub enabled: bool,
    pub auto_send: bool,
    pub target: String,
    pub message_action: bool,
    pub display_translation: bool,
    pub translation_mode: String,
    pub message_target: String,
}

impl ChatTranslationPolicy {
    pub fn from_policy(policy: &TranslationPolicy) -> Self {
        Self {
            enabled: policy.enabled,
            auto_send: policy.auto_send,
            target: policy.target.clone(),
            message_action: policy.message_action,
            display_translation: policy.display_translation,
            translation_mode: policy.translation_mode.clone(),
            message_target: policy.message_target.clone(),
        }
    }

    pub fn validate(&self) -> Result<()> {
        if !LANGUAGES.contains(&self.target.as_str())
            || !LANGUAGES.contains(&self.message_target.as_str())
            || !["click", "auto"].contains(&self.translation_mode.as_str())
        {
            return Err(AppError::TranslationInvalid);
        }
        Ok(())
    }

    fn resolve(&self, global: &TranslationPolicy) -> TranslationPolicy {
        TranslationPolicy {
            enabled: self.enabled,
            auto_send: self.auto_send,
            target: self.target.clone(),
            message_action: self.message_action,
            display_translation: self.display_translation,
            translation_mode: self.translation_mode.clone(),
            message_target: self.message_target.clone(),
            ..global.clone()
        }
    }
}

/// Input shapes stay strict; the account owner also matches them to chat_id.
/// The legacy storage decoder below is deliberately not used by this IPC DTO.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum TranslationPolicyUpdate {
    Global(TranslationPolicy),
    Chat(ChatTranslationPolicy),
}

impl From<TranslationPolicy> for TranslationPolicyUpdate {
    fn from(policy: TranslationPolicy) -> Self {
        Self::Global(policy)
    }
}

impl From<ChatTranslationPolicy> for TranslationPolicyUpdate {
    fn from(policy: ChatTranslationPolicy) -> Self {
        Self::Chat(policy)
    }
}

#[derive(Clone, Default, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TranslationSettings {
    pub revision: u64,
    pub global: TranslationPolicy,
    #[serde(deserialize_with = "deserialize_chat_policies")]
    pub chats: BTreeMap<String, ChatTranslationPolicy>,
}

/// Existing guest protocols consume effective full policies, never storage rows.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTranslationSettings {
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
            if !valid_stored_chat_id(id) {
                return Err(AppError::TranslationInvalid);
            }
            policy.validate()?;
        }
        Ok(())
    }

    pub fn validate_for_platform(&self, platform: &str) -> Result<()> {
        self.validate()?;
        self.global.validate_for_platform(platform)?;
        for id in self.chats.keys() {
            if !valid_receive_chat_id(platform, id) {
                return Err(AppError::TranslationInvalid);
            }
            self.policy(id).validate_for_platform(platform)?;
        }
        Ok(())
    }

    pub fn policy(&self, chat_id: &str) -> TranslationPolicy {
        self.chats.get(chat_id).map_or_else(
            || self.global.clone(),
            |policy| policy.resolve(&self.global),
        )
    }

    pub fn resolved(&self) -> ResolvedTranslationSettings {
        ResolvedTranslationSettings {
            revision: self.revision,
            global: self.global.clone(),
            chats: self
                .chats
                .iter()
                .map(|(id, policy)| (id.clone(), policy.resolve(&self.global)))
                .collect(),
        }
    }
}

fn deserialize_chat_policies<'de, D>(
    deserializer: D,
) -> std::result::Result<BTreeMap<String, ChatTranslationPolicy>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StoredPolicy {
        Current(ChatTranslationPolicy),
        Legacy(TranslationPolicy),
    }

    let stored = BTreeMap::<String, StoredPolicy>::deserialize(deserializer)?;
    stored
        .into_iter()
        .map(|(id, value)| {
            let policy = match value {
                StoredPolicy::Current(policy) => policy,
                StoredPolicy::Legacy(policy) => {
                    // Reject damaged/unsupported hidden fields before discarding
                    // the old full-clone implementation's implicit snapshots.
                    policy
                        .validate()
                        .map_err(|_| D::Error::custom("invalid stored translation policy"))?;
                    ChatTranslationPolicy::from_policy(&policy)
                }
            };
            policy
                .validate()
                .map_err(|_| D::Error::custom("invalid stored chat translation policy"))?;
            Ok((id, policy))
        })
        .collect()
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

pub fn is_telegram(platform: &str) -> bool {
    matches!(platform, "telegram-z" | "telegram-k")
}

pub fn is_line(platform: &str) -> bool {
    matches!(platform, "line" | "line-business")
}

/// Page rows that do not prove incoming direction or send time. Paid auto stays closed.
pub fn receive_is_manual_only(platform: &str) -> bool {
    matches!(platform, "messenger" | "instagram") || is_line(platform)
}

pub fn supports_receive(platform: &str) -> bool {
    matches!(
        platform,
        "whatsapp" | "whatsapp-pure" | "messenger" | "instagram"
    ) || is_telegram(platform)
        || is_line(platform)
}

pub fn supports_outgoing(platform: &str) -> bool {
    matches!(
        platform,
        "whatsapp"
            | "whatsapp-pure"
            | "telegram-k"
            | "telegram-z"
            | "messenger"
            | "instagram"
            | "line"
            | "line-business"
    )
}

pub fn valid_send_chat_id(platform: &str, id: &str) -> bool {
    supports_outgoing(platform) && valid_receive_chat_id(platform, id)
}

pub fn validate_send_text(platform: &str, text: &str) -> Result<()> {
    validate_text(text)?;
    if matches!(platform, "telegram-k" | "telegram-z") && text.encode_utf16().count() > 4096 {
        return Err(AppError::TranslationInvalid);
    }
    Ok(())
}

/// Negative Telegram peers include groups and channels. Requiring groupAuto
/// for both is conservative; the guest additionally rejects nonordinary chats.
pub fn receive_requires_group_auto(id: &str) -> bool {
    id.ends_with("@g.us") || (valid_telegram_chat_id(id) && id.starts_with("tg:-"))
}

/// A separate Telegram namespace. Never accepted by WhatsApp send/broadcast IDs.
pub fn valid_telegram_chat_id(id: &str) -> bool {
    id.strip_prefix("tg:").is_some_and(|peer| {
        peer.parse::<i64>()
            .is_ok_and(|value| value != 0 && value.to_string() == peer)
    })
}

fn valid_segment(id: &str) -> bool {
    let bytes = id.as_bytes();
    (1..=128).contains(&bytes.len())
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

pub fn valid_messenger_chat_id(id: &str) -> bool {
    [
        "/messages/t/",
        "/messages/e2ee/t/",
        "/messages/marketplace/t/",
        "/messages/requests/t/",
    ]
    .iter()
    .any(|prefix| id.strip_prefix(prefix).is_some_and(valid_segment))
}

pub fn valid_instagram_chat_id(id: &str) -> bool {
    id.strip_prefix("/direct/t/").is_some_and(valid_segment)
}

/// Opaque LINE `data-mid`, kept out of the WhatsApp and Telegram namespaces.
pub fn valid_line_chat_id(id: &str) -> bool {
    id.strip_prefix("ln:").is_some_and(|raw| {
        let bytes = raw.as_bytes();
        (8..=128).contains(&bytes.len())
            && bytes[0].is_ascii_alphanumeric()
            && bytes.iter().all(|byte| {
                byte.is_ascii_alphanumeric()
                    || matches!(byte, b'+' | b'/' | b'=' | b'_' | b'-' | b'.')
            })
    })
}

pub fn valid_stored_chat_id(id: &str) -> bool {
    valid_chat_id(id)
        || valid_telegram_chat_id(id)
        || valid_messenger_chat_id(id)
        || valid_instagram_chat_id(id)
        || valid_line_chat_id(id)
}

pub fn valid_receive_chat_id(platform: &str, id: &str) -> bool {
    match platform {
        "whatsapp" | "whatsapp-pure" => valid_chat_id(id),
        "telegram-z" | "telegram-k" => valid_telegram_chat_id(id),
        "messenger" => valid_messenger_chat_id(id),
        "instagram" => valid_instagram_chat_id(id),
        "line" | "line-business" => valid_line_chat_id(id),
        _ => false,
    }
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
            || !valid_stored_chat_id(&self.chat_id)
            || !(1..=10_000).contains(&self.attempt)
            || self.message_id.is_empty()
            || self.message_id.len() > 256
            || self.message_id.chars().any(char::is_control)
        {
            return Err(AppError::TranslationInvalid);
        }
        validate_text(&self.text)
    }

    pub fn validate_for_platform(&self, platform: &str) -> Result<()> {
        self.validate()?;
        if !valid_receive_chat_id(platform, &self.chat_id)
            || (is_telegram(platform)
                && !self.message_id.parse::<u64>().is_ok_and(|value| {
                    value > 0 && value <= i64::MAX as u64 && value.to_string() == self.message_id
                }))
        {
            return Err(AppError::TranslationInvalid);
        }
        Ok(())
    }
}
