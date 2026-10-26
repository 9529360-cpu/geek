//! Interactive text submission identity; no platform or network authority lives here.
use super::{
    account::valid_id,
    error::{AppError, Result},
    send_mentions::{validate_mentions, SendMention},
    translation::{
        valid_chat_id, valid_send_chat_id, valid_stored_chat_id, valid_telegram_chat_id,
        validate_send_text, validate_text,
    },
};
use serde::{Deserialize, Serialize};

/// Frozen composer semantics. Missing or unknown context must never become plain text.
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum SendContext {
    Plain {},
    Reply {
        #[serde(rename = "messageId")]
        message_id: String,
        #[serde(rename = "chatId")]
        chat_id: String,
    },
    Mentions {
        mentions: Vec<SendMention>,
    },
    ReplyMentions {
        #[serde(rename = "messageId")]
        message_id: String,
        #[serde(rename = "chatId")]
        chat_id: String,
        mentions: Vec<SendMention>,
    },
    Attachment {
        #[serde(rename = "attachmentId")]
        attachment_id: String,
    },
}

impl SendContext {
    fn valid_for(&self, expected_chat: &str, text: &str) -> bool {
        match self {
            Self::Plain {} => true,
            Self::Reply {
                message_id,
                chat_id,
            } => {
                chat_id == expected_chat
                    && if valid_telegram_chat_id(chat_id) {
                        valid_telegram_reply_key(message_id, chat_id)
                    } else {
                        valid_chat_id(chat_id) && valid_reply_key(message_id, chat_id)
                    }
            }
            Self::Mentions { mentions } => {
                valid_chat_id(expected_chat)
                    && expected_chat.ends_with("@g.us")
                    && validate_mentions(text, mentions).is_ok()
            }
            Self::ReplyMentions {
                message_id,
                chat_id,
                mentions,
            } => {
                chat_id == expected_chat
                    && valid_chat_id(expected_chat)
                    && expected_chat.ends_with("@g.us")
                    && valid_reply_key(message_id, expected_chat)
                    && validate_mentions(text, mentions).is_ok()
            }
            Self::Attachment { attachment_id } => {
                valid_chat_id(expected_chat)
                    && valid_id(attachment_id)
                    && text.chars().count() <= 1024
            }
        }
    }
}

fn valid_telegram_reply_key(value: &str, chat_id: &str) -> bool {
    let Some(id) = value
        .strip_prefix(chat_id)
        .and_then(|value| value.strip_prefix(':'))
    else {
        return false;
    };
    // The peer namespace is already validated. TL reply_to_msg_id is a signed
    // 32-bit server ID, never K's fractional pending ID or encoded local mid.
    id.parse::<i32>()
        .is_ok_and(|parsed| parsed > 0 && parsed.to_string() == id)
}

fn valid_reply_key(value: &str, chat_id: &str) -> bool {
    if value.is_empty()
        || value.len() > 500
        || value.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return false;
    }
    // Pinned MsgKey binds direction, remote chat and the opaque message ID;
    // a group message may also include its user participant. The guest additionally
    // requires a canonical MsgKey and a loaded, replyable same-chat MsgModel.
    let mut parts = value.split('_');
    if !matches!(parts.next(), Some("true" | "false")) || parts.next() != Some(chat_id) {
        return false;
    }
    if !parts
        .next()
        .is_some_and(|id| !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_alphanumeric()))
    {
        return false;
    }
    if let Some(participant) = parts.next() {
        let Some((number, server)) = participant.split_once('@') else {
            return false;
        };
        if !chat_id.ends_with("@g.us")
            || number.is_empty()
            || number.len() > 40
            || !number.bytes().all(|byte| byte.is_ascii_digit())
            || !matches!(server, "c.us" | "lid")
        {
            return false;
        }
    }
    parts.next().is_none()
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutgoingSend {
    pub id: String,
    pub chat_id: String,
    pub text: String,
    pub context: SendContext,
    pub composer_revision: u64,
    pub policy_revision: u64,
    pub attempt: u32,
}

impl OutgoingSend {
    pub fn validate(&self) -> Result<()> {
        if !valid_id(&self.id)
            || !valid_stored_chat_id(&self.chat_id)
            || !self.context.valid_for(&self.chat_id, &self.text)
            || self.composer_revision == 0
            || self.policy_revision == 0
            || !(1..=10_000).contains(&self.attempt)
        {
            return Err(AppError::SendIntentInvalid);
        }
        validate_text(&self.text).map_err(|_| AppError::SendIntentInvalid)
    }

    pub fn validate_for_platform(&self, platform: &str) -> Result<()> {
        self.validate()?;
        if !valid_send_chat_id(platform, &self.chat_id)
            || (platform == "telegram-k"
                && !matches!(
                    self.context,
                    SendContext::Plain {} | SendContext::Reply { .. }
                ))
            || (matches!(platform, "telegram-z" | "messenger" | "instagram")
                && !matches!(self.context, SendContext::Plain {}))
        {
            return Err(AppError::SendIntentInvalid);
        }
        validate_send_text(platform, &self.text).map_err(|_| AppError::SendIntentInvalid)
    }

    pub fn validate_output(&self, platform: &str, text: &str) -> Result<()> {
        validate_send_text(platform, text).map_err(|_| AppError::TranslationOutputInvalid)?;
        if matches!(self.context, SendContext::Attachment { .. }) && text.chars().count() > 1024 {
            return Err(AppError::TranslationOutputInvalid);
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SendState {
    Transforming,
    Ready,
    Committing,
    Confirmed,
    Failed,
    Cancelled,
    Uncertain,
}

impl SendState {
    pub fn active(self) -> bool {
        matches!(self, Self::Transforming | Self::Ready | Self::Committing)
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SendStatus {
    pub id: String,
    pub attempt: u32,
    pub state: SendState,
    pub issue: Option<AppError>,
    pub retryable: bool,
    pub receipt: Option<String>,
    pub draft_cleared: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase", deny_unknown_fields)]
pub enum SendOutcome {
    Confirmed {
        receipt: String,
        #[serde(rename = "draftCleared")]
        draft_cleared: bool,
    },
    NotSubmitted {
        #[serde(rename = "code")]
        issue: AppError,
    },
    Uncertain {
        #[serde(rename = "code")]
        issue: AppError,
    },
}
