use super::request_control::RequestControl;
use crate::domain::{
    account::valid_id,
    error::{AppError, Result},
    proxy::ProxyConfig,
    session::SessionToken,
    translation::{valid_stored_chat_id, validate_text},
    translation_cache::TranslationCacheDocument,
};

/// Optional completed-result storage, owned by the existing translation service.
/// Load/save failures cannot grant quota or turn an already paid result into a retry.
pub trait TranslationCacheRepository: Send + 'static {
    fn load(&self) -> Result<Option<TranslationCacheDocument>>;
    fn save(&mut self, document: &TranslationCacheDocument) -> Result<()>;
}

/// Wall clock for durable age only. Request budgets continue to use monotonic time.
pub trait TranslationCacheClock: Send + Sync + 'static {
    fn now_secs(&self) -> u64;
}

pub struct SystemTranslationCacheClock;

impl TranslationCacheClock for SystemTranslationCacheClock {
    fn now_secs(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|time| time.as_secs())
            .unwrap_or(0)
    }
}

/// Native-owned service intent. This never admits arbitrary guest HTTP headers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TranslationIntent {
    MessageDisplay,
    OutgoingSend,
}

impl TranslationIntent {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MessageDisplay => "message-display",
            Self::OutgoingSend => "outgoing-send",
        }
    }
}

/// A transform within an already admitted SendIntent, with its stable billing ID.
/// Composer ownership, trusted gestures and submission remain with that owner.
#[derive(Clone)]
pub struct OutgoingTranslation {
    pub id: String,
    pub chat_id: String,
    pub text: String,
    pub policy_revision: u64,
}

impl OutgoingTranslation {
    pub fn validate(&self) -> Result<()> {
        if !valid_id(&self.id) || !valid_stored_chat_id(&self.chat_id) {
            return Err(AppError::TranslationInvalid);
        }
        validate_text(&self.text)
    }
}

pub struct TranslationToken {
    pub token: SessionToken,
    pub expires_at: u64,
}

#[derive(Clone)]
pub struct TranslationRequest {
    pub id: String,
    pub intent: TranslationIntent,
    pub text: String,
    pub source: String,
    pub target: String,
    pub provider: String,
    /// Frozen logical and physical route; retries never switch it.
    pub route: String,
}

#[derive(Clone)]
pub struct TranslationReply {
    pub text: String,
    /// Null revokes balance authority without turning a charged success into a retry.
    pub remaining_chars: Option<u64>,
}

pub trait TranslationGateway: Send + Sync + 'static {
    fn quota(
        &self,
        login_token: &str,
        proxy: &ProxyConfig,
        control: &RequestControl,
    ) -> Result<u64>;
    fn translation_token(
        &self,
        login_token: &str,
        proxy: &ProxyConfig,
        control: &RequestControl,
    ) -> Result<TranslationToken>;
    fn translate(
        &self,
        translation_token: &str,
        request: &TranslationRequest,
        proxy: &ProxyConfig,
        control: &RequestControl,
    ) -> Result<TranslationReply>;
}

/// A public, nonbillable GET. This port deliberately has no token, account,
/// message, route selection or quota arguments.
pub trait TranslationHealthGateway: Send + Sync + 'static {
    fn health(&self, control: &RequestControl) -> Result<bool>;
}
