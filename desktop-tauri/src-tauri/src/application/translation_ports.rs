use super::request_control::RequestControl;
use crate::domain::{error::Result, proxy::ProxyConfig, session::SessionToken};

pub struct TranslationToken {
    pub token: SessionToken,
    pub expires_at: u64,
}

#[derive(Clone)]
pub struct TranslationRequest {
    pub id: String,
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
