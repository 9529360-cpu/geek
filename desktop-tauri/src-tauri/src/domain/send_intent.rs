//! Interactive text submission identity; no platform or network authority lives here.
use super::{
    account::valid_id,
    error::{AppError, Result},
    translation::{valid_chat_id, validate_text},
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutgoingSend {
    pub id: String,
    pub chat_id: String,
    pub text: String,
    pub composer_revision: u64,
    pub policy_revision: u64,
    pub attempt: u32,
}

impl OutgoingSend {
    pub fn validate(&self) -> Result<()> {
        if !valid_id(&self.id)
            || !valid_chat_id(&self.chat_id)
            || self.composer_revision == 0
            || self.policy_revision == 0
            || !(1..=10_000).contains(&self.attempt)
        {
            return Err(AppError::SendIntentInvalid);
        }
        validate_text(&self.text).map_err(|_| AppError::SendIntentInvalid)
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
