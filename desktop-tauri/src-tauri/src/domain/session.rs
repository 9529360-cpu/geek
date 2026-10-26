//! Server-issued identity and encrypted session data. Passwords are never records.
use super::error::{AppError, Result};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use zeroize::Zeroizing;

pub const QUOTA_AUTHORITY_TTL_MS: u64 = 30_000;
pub const MAX_SESSION_PLAIN_BYTES: usize = 32 * 1024;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub struct SessionToken(Zeroizing<String>);

impl SessionToken {
    pub fn new(value: String) -> Result<Self> {
        let token = Self(Zeroizing::new(value));
        if !token.valid() {
            return Err(AppError::NetworkResponseInvalid);
        }
        Ok(token)
    }

    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }

    pub fn valid(&self) -> bool {
        !self.0.is_empty()
            && self.0.len() <= 8_192
            && self.0.bytes().all(|byte| byte.is_ascii_graphic())
    }
}

impl Clone for SessionToken {
    fn clone(&self) -> Self {
        Self(Zeroizing::new(self.as_str().to_owned()))
    }
}

impl PartialEq for SessionToken {
    fn eq(&self, other: &Self) -> bool {
        self.as_str() == other.as_str()
    }
}

impl Eq for SessionToken {}

impl fmt::Debug for SessionToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SessionToken([REDACTED])")
    }
}

impl Serialize for SessionToken {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for SessionToken {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        Self::new(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionUser {
    pub id: u64,
    pub email: String,
    pub account_no: String,
}

impl SessionUser {
    pub fn valid(&self) -> bool {
        let number = self.account_no.as_bytes();
        self.id > 0
            && self.id <= MAX_SAFE_INTEGER
            && valid_email(&self.email)
            && self.email == self.email.trim().to_lowercase()
            && number.len() == 35
            && number.starts_with(b"GK-")
            && number[3..]
                .iter()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    }
}

pub fn valid_email(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 320
        && value.contains('@')
        && !value
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
}

pub fn valid_quota(value: u64) -> bool {
    value <= MAX_SAFE_INTEGER
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionRecord {
    pub token: SessionToken,
    pub user: SessionUser,
    /// A UI mirror, never sufficient to authorize a translation after restart.
    pub remaining_chars: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionDocument {
    pub schema_version: u32,
    pub revision: u64,
    pub record: Option<SessionRecord>,
}

impl Default for SessionDocument {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            record: None,
        }
    }
}

impl SessionDocument {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1 {
            return Err(AppError::StoreVersion);
        }
        if self.record.as_ref().is_some_and(|record| {
            !record.token.valid()
                || !record.user.valid()
                || record
                    .remaining_chars
                    .is_some_and(|value| !valid_quota(value))
        }) {
            return Err(AppError::StoreInvalid);
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct LoginPayload {
    pub token: SessionToken,
    pub user: SessionUser,
}

#[derive(Clone, Debug)]
pub struct SessionRefresh {
    pub user: SessionUser,
    /// /api/status returns a number. Null is only a translation-result signal.
    pub remaining_chars: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionState {
    SignedOut,
    SignedIn,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SessionIssue {
    InvalidCredentials,
    AccountDisabled,
    PasswordResetRequired,
    RateLimited,
    Unauthorized,
    NetworkUnavailable,
    ResponseInvalid,
    PersistenceFailed,
    Cancelled,
    TimedOut,
}

impl SessionIssue {
    pub fn from_error(error: AppError) -> Option<Self> {
        Some(match error {
            AppError::SessionInvalidCredentials => Self::InvalidCredentials,
            AppError::SessionAccountDisabled => Self::AccountDisabled,
            AppError::SessionPasswordResetRequired => Self::PasswordResetRequired,
            AppError::SessionRateLimited => Self::RateLimited,
            AppError::SessionRequired => Self::Unauthorized,
            AppError::NetworkUnavailable => Self::NetworkUnavailable,
            AppError::NetworkResponseInvalid => Self::ResponseInvalid,
            AppError::SessionPersistence => Self::PersistenceFailed,
            AppError::TranslationCancelled => Self::Cancelled,
            AppError::TranslationTimeout => Self::TimedOut,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub revision: u64,
    pub state: SessionState,
    pub user: Option<SessionUser>,
    pub remaining_chars: Option<u64>,
    pub quota_fresh: bool,
    pub issue: Option<SessionIssue>,
}
