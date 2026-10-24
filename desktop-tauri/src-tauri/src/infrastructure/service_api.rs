//! Fixed subscription and translation contracts. No retries, logging or guest secrets.
mod health;

use super::http::{Endpoint, FixedRequest, HttpResponse, HttpTransport, MAX_RESPONSE_BYTES};
use crate::{
    application::ports::{
        RequestControl, SessionTransport, TranslationGateway, TranslationReply, TranslationRequest,
        TranslationToken,
    },
    domain::{
        error::{AppError, Result},
        proxy::ProxyConfig,
        session::{
            valid_email, valid_quota, LoginPayload, SessionRefresh, SessionToken, SessionUser,
        },
    },
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{borrow::Cow, sync::Arc};
use zeroize::Zeroizing;

// Infrastructure-local seam: tests script the actual API adapter without network.
trait ServiceHttp: Send + Sync {
    fn request(
        &self,
        proxy: &ProxyConfig,
        request: &FixedRequest<'_>,
        control: &RequestControl,
    ) -> Result<HttpResponse>;
}

impl ServiceHttp for HttpTransport {
    fn request(
        &self,
        proxy: &ProxyConfig,
        request: &FixedRequest<'_>,
        control: &RequestControl,
    ) -> Result<HttpResponse> {
        HttpTransport::request(self, proxy, request, control)
    }
}

pub struct NativeApi {
    http: Arc<dyn ServiceHttp>,
}

impl NativeApi {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    fn call<T: DeserializeOwned>(
        &self,
        proxy: &ProxyConfig,
        request: &FixedRequest<'_>,
        control: &RequestControl,
    ) -> Result<T> {
        control.check()?;
        let response = self.http.request(proxy, request, control)?;
        control.check()?;
        if response.body.len() > MAX_RESPONSE_BYTES {
            return Err(AppError::NetworkResponseInvalid);
        }
        if response.status != 200 {
            return Err(response_error(request.endpoint, &response));
        }
        let result =
            serde_json::from_slice(&response.body).map_err(|_| AppError::NetworkResponseInvalid)?;
        control.check()?;
        Ok(result)
    }
}

impl SessionTransport for NativeApi {
    fn login(&self, email: &str, password: &str, control: &RequestControl) -> Result<LoginPayload> {
        let body = json_body(&LoginBody { email, password })?;
        let response: LoginWire = self.call(
            &ProxyConfig::System,
            &FixedRequest {
                endpoint: Endpoint::Login,
                bearer: None,
                body: Some(body.as_str()),
                request_id: None,
                deadline_ms: None,
                translation_intent: None,
            },
            control,
        )?;
        require_ok(response.ok)?;
        let user = response.user.identity()?;
        if user.email != email.trim().to_lowercase() {
            return Err(AppError::NetworkResponseInvalid);
        }
        Ok(LoginPayload {
            token: response.token,
            user,
        })
    }

    fn refresh(&self, token: &str, control: &RequestControl) -> Result<SessionRefresh> {
        let profile: ProfileWire = self.call(
            &ProxyConfig::System,
            &FixedRequest::authenticated(Endpoint::Me, token),
            control,
        )?;
        require_ok(profile.ok)?;
        let user = profile.user.identity()?;
        let status: StatusWire = self.call(
            &ProxyConfig::System,
            &FixedRequest::authenticated(Endpoint::Status, token),
            control,
        )?;
        require_ok(status.ok)?;
        require_quota(status.remaining_chars)?;
        if status.valid != (status.remaining_chars > 0) {
            return Err(AppError::NetworkResponseInvalid);
        }
        Ok(SessionRefresh {
            user,
            remaining_chars: status.remaining_chars,
        })
    }
}

impl TranslationGateway for NativeApi {
    fn quota(&self, token: &str, proxy: &ProxyConfig, control: &RequestControl) -> Result<u64> {
        let response: QuotaWire = self.call(
            proxy,
            &FixedRequest::authenticated(Endpoint::Quota, token),
            control,
        )?;
        require_ok(response.ok)?;
        if !valid_email(&response.email) || response.email != response.email.trim().to_lowercase() {
            return Err(AppError::NetworkResponseInvalid);
        }
        require_quota(response.remaining_chars)?;
        Ok(response.remaining_chars)
    }

    fn translation_token(
        &self,
        token: &str,
        proxy: &ProxyConfig,
        control: &RequestControl,
    ) -> Result<TranslationToken> {
        let response: TokenWire = self.call(
            proxy,
            &FixedRequest::authenticated(Endpoint::TranslationToken, token),
            control,
        )?;
        require_ok(response.ok)?;
        if response.expires_at == 0 || !valid_quota(response.expires_at) {
            return Err(AppError::NetworkResponseInvalid);
        }
        // Unix seconds stay seconds. The session-bound owner validates the TTL.
        Ok(TranslationToken {
            token: response.token,
            expires_at: response.expires_at,
        })
    }

    fn translate(
        &self,
        token: &str,
        request: &TranslationRequest,
        proxy: &ProxyConfig,
        control: &RequestControl,
    ) -> Result<TranslationReply> {
        let body = json_body(&TranslateBody {
            text: &request.text,
            source: &request.source,
            target: &request.target,
            provider: &request.provider,
            route: &request.route,
            operation_route: &request.route,
        })?;
        if body.len() > 32_768 {
            return Err(AppError::TranslationInvalid);
        }
        let response: TranslationWire = self.call(
            proxy,
            &FixedRequest {
                endpoint: Endpoint::Translate,
                bearer: Some(token),
                body: Some(body.as_str()),
                request_id: Some(&request.id),
                deadline_ms: Some((control.remaining()?.as_millis() as u64).min(30_000)),
                translation_intent: Some(request.intent),
            },
            control,
        )?;
        if response.source != request.source
            || response.target != request.target
            || response.route != request.route
            || response.engine.is_empty()
            || response.engine.len() > 64
            || !response.engine.bytes().all(|byte| byte.is_ascii_graphic())
        {
            return Err(AppError::NetworkResponseInvalid);
        }
        if let Some(quota) = response.remaining_chars.0 {
            require_quota(quota)?;
        }
        if response.text.trim().is_empty()
            || response.text.len() > 80_000
            || response
                .text
                .chars()
                .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
        {
            return Err(AppError::TranslationOutputInvalid);
        }
        Ok(TranslationReply {
            text: response.text,
            remaining_chars: response.remaining_chars.0,
        })
    }
}

fn json_body(value: &impl Serialize) -> Result<Zeroizing<String>> {
    serde_json::to_string(value)
        .map(Zeroizing::new)
        .map_err(|_| AppError::NetworkResponseInvalid)
}

fn require_ok(ok: bool) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(AppError::NetworkResponseInvalid)
    }
}

fn require_quota(value: u64) -> Result<()> {
    if valid_quota(value) {
        Ok(())
    } else {
        Err(AppError::NetworkResponseInvalid)
    }
}

fn response_error(endpoint: Endpoint, response: &HttpResponse) -> AppError {
    #[derive(Deserialize)]
    struct ErrorWire<'a> {
        #[serde(borrow)]
        error: Cow<'a, str>,
    }
    let Ok(body) = serde_json::from_slice::<ErrorWire<'_>>(&response.body) else {
        return AppError::NetworkResponseInvalid;
    };
    if endpoint == Endpoint::Translate {
        return match (response.status, body.error.as_ref()) {
            (401, "unauthorized") => AppError::TranslationUnauthorized,
            (403, "account_disabled") => AppError::SessionAccountDisabled,
            (402, "quota_exhausted") => AppError::TranslationQuotaExhausted,
            (409, "request_in_progress") => AppError::TranslationInProgress,
            (409, "request_conflict") => AppError::TranslationConflict,
            (409, "duplicate_request" | "completed_result_expired")
            | (502, "replay_unavailable") => AppError::TranslationResultUnavailable,
            (502, "translation_failed") | (503, "service_unavailable") => {
                AppError::NetworkUnavailable
            }
            (504, "deadline_exceeded") => AppError::TranslationTimeout,
            (499, "request_aborted") => AppError::TranslationCancelled,
            (
                400,
                "invalid_request_id"
                | "unsupported_provider"
                | "invalid_route"
                | "invalid_operation_route"
                | "empty_text"
                | "invalid_source"
                | "invalid_target",
            )
            | (413, "payload_too_large") => AppError::TranslationInvalid,
            _ => AppError::NetworkResponseInvalid,
        };
    }
    match (response.status, body.error.as_ref()) {
        (401, "invalid_credentials") if endpoint == Endpoint::Login => {
            AppError::SessionInvalidCredentials
        }
        (409, "password_reset_required") if endpoint == Endpoint::Login => {
            AppError::SessionPasswordResetRequired
        }
        (401, "unauthorized" | "session_revoked") | (404, "user_not_found") => {
            AppError::SessionRequired
        }
        (403, "account_disabled") => AppError::SessionAccountDisabled,
        (429, "rate_limited") => AppError::SessionRateLimited,
        (502 | 503, "service_unavailable") => AppError::NetworkUnavailable,
        _ => AppError::NetworkResponseInvalid,
    }
}

#[derive(Serialize)]
struct LoginBody<'a> {
    email: &'a str,
    password: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TranslateBody<'a> {
    text: &'a str,
    source: &'a str,
    target: &'a str,
    provider: &'a str,
    route: &'a str,
    operation_route: &'a str,
}

#[derive(Deserialize)]
struct UserWire {
    id: u64,
    email: String,
    account_no: String,
}

impl UserWire {
    fn identity(self) -> Result<SessionUser> {
        let user = SessionUser {
            id: self.id,
            email: self.email,
            account_no: self.account_no,
        };
        if user.valid() {
            Ok(user)
        } else {
            Err(AppError::NetworkResponseInvalid)
        }
    }
}

#[derive(Deserialize)]
struct LoginWire {
    ok: bool,
    token: SessionToken,
    user: UserWire,
}

#[derive(Deserialize)]
struct ProfileWire {
    ok: bool,
    user: UserWire,
}

#[derive(Deserialize)]
struct StatusWire {
    ok: bool,
    valid: bool,
    remaining_chars: u64,
}

#[derive(Deserialize)]
struct QuotaWire {
    ok: bool,
    email: String,
    remaining_chars: u64,
}

#[derive(Deserialize)]
struct TokenWire {
    ok: bool,
    token: SessionToken,
    expires_at: u64,
}

// A required nullable field: missing balance metadata is not the server's null signal.
#[derive(Deserialize)]
struct NullableQuota(Option<u64>);

#[derive(Deserialize)]
struct TranslationWire {
    text: String,
    source: String,
    target: String,
    engine: String,
    route: String,
    remaining_chars: NullableQuota,
}

#[cfg(test)]
mod tests;
