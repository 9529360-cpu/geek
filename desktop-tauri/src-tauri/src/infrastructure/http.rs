//! Native-only fixed service transport. No renderer URL, headers or network fallback.
use crate::{
    application::ports::{RequestControl, TranslationIntent},
    domain::{
        error::{AppError, Result},
        proxy::ProxyConfig,
    },
};
use std::{sync::Arc, time::Duration};
use zeroize::Zeroizing;

#[cfg(test)]
mod tests;

pub const MAX_RESPONSE_BYTES: usize = 256 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Endpoint {
    Login,
    Me,
    Status,
    Quota,
    TranslationToken,
    Translate,
}

impl Endpoint {
    pub fn url(self) -> &'static str {
        match self {
            Self::Login => "https://geek-subscription.9529360.workers.dev/api/login",
            Self::Me => "https://geek-subscription.9529360.workers.dev/api/me",
            Self::Status => "https://geek-subscription.9529360.workers.dev/api/status",
            Self::Quota => "https://geek-subscription.9529360.workers.dev/api/quota",
            Self::TranslationToken => {
                "https://geek-subscription.9529360.workers.dev/api/translation-token"
            }
            Self::Translate => "https://geek-translate.9529360.workers.dev/v1/translate",
        }
    }

    pub fn method(self) -> &'static str {
        match self {
            Self::Me | Self::Status | Self::Quota => "GET",
            Self::Login | Self::TranslationToken | Self::Translate => "POST",
        }
    }
}

// Deliberately no Debug: these borrowed values can contain credentials or chat text.
pub struct FixedRequest<'a> {
    pub endpoint: Endpoint,
    pub bearer: Option<&'a str>,
    pub body: Option<&'a str>,
    pub request_id: Option<&'a str>,
    pub deadline_ms: Option<u64>,
    pub translation_intent: Option<TranslationIntent>,
}

impl FixedRequest<'_> {
    pub fn authenticated(endpoint: Endpoint, bearer: &str) -> FixedRequest<'_> {
        FixedRequest {
            endpoint,
            bearer: Some(bearer),
            body: None,
            request_id: None,
            deadline_ms: None,
            translation_intent: None,
        }
    }
}

pub struct HttpResponse {
    pub status: u16,
    pub body: Zeroizing<Vec<u8>>,
}

/// The runtime is independent from Workspace and used only on blocking feature workers.
pub struct HttpTransport {
    runtime: Arc<tokio::runtime::Runtime>,
}

impl HttpTransport {
    pub fn new() -> Result<Self> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|_| AppError::NetworkUnavailable)?;
        Ok(Self {
            runtime: Arc::new(runtime),
        })
    }

    pub fn request(
        &self,
        proxy: &ProxyConfig,
        request: &FixedRequest<'_>,
        control: &RequestControl,
    ) -> Result<HttpResponse> {
        control.check()?;
        proxy.validate()?;
        let endpoint = if matches!(proxy, ProxyConfig::System) {
            match super::system_http::resolve(request.endpoint, control)? {
                super::system_http::SystemRoute::Direct => None,
                super::system_http::SystemRoute::Proxy(endpoint) => Some(endpoint),
            }
        } else {
            Some(proxy_endpoint(proxy)?)
        };
        self.resolved_route(endpoint, request, control)
    }

    fn resolved_route(
        &self,
        endpoint: Option<String>,
        request: &FixedRequest<'_>,
        control: &RequestControl,
    ) -> Result<HttpResponse> {
        // A new client freezes one request's authorized route. Environment proxies,
        // NO_PROXY and stale pools can never override it. System Direct requires
        // affirmative Windows resolution; a resolver failure never reaches here.
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .https_only(true)
            .referer(false)
            .pool_max_idle_per_host(0)
            .connect_timeout(control.remaining()?.min(Duration::from_secs(10)))
            .timeout(control.remaining()?);
        if let Some(endpoint) = endpoint {
            builder =
                builder.proxy(reqwest::Proxy::all(endpoint).map_err(|_| AppError::ProxyInvalid)?);
        }
        let client = builder.build().map_err(|_| AppError::NetworkUnavailable)?;
        let outgoing = service_request(&client, request, control)?;
        self.runtime.block_on(async {
            let work = async {
                control.check()?;
                let mut response = outgoing.send().await.map_err(map_network)?;
                let status = response.status().as_u16();
                if response
                    .content_length()
                    .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
                {
                    return Err(AppError::NetworkResponseInvalid);
                }
                let mut body = Zeroizing::new(Vec::new());
                while let Some(chunk) = response.chunk().await.map_err(map_network)? {
                    control.check()?;
                    if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                        return Err(AppError::NetworkResponseInvalid);
                    }
                    body.extend_from_slice(&chunk);
                }
                control.check()?;
                Ok(HttpResponse { status, body })
            };
            tokio::pin!(work);
            loop {
                control.check()?;
                tokio::select! {
                    result = &mut work => return result,
                    _ = tokio::time::sleep(Duration::from_millis(25)) => control.check()?,
                }
            }
        })
    }
}

fn service_request(
    client: &reqwest::Client,
    request: &FixedRequest<'_>,
    control: &RequestControl,
) -> Result<reqwest::RequestBuilder> {
    control.check()?;
    if (request.endpoint == Endpoint::Translate) != request.translation_intent.is_some() {
        return Err(AppError::NetworkResponseInvalid);
    }
    let method = reqwest::Method::from_bytes(request.endpoint.method().as_bytes())
        .map_err(|_| AppError::NetworkUnavailable)?;
    let mut outgoing = client
        .request(method, request.endpoint.url())
        .header("Accept", "application/json");
    if let Some(token) = request.bearer {
        outgoing = outgoing.bearer_auth(token);
    }
    if let Some(body) = request.body {
        outgoing = outgoing
            .header("Content-Type", "application/json")
            .body(body.to_owned());
    }
    if let Some(id) = request.request_id {
        outgoing = outgoing.header("X-Request-ID", id);
    }
    if let Some(budget) = request.deadline_ms {
        outgoing = outgoing.header(
            "X-Geek-Deadline-Ms",
            budget
                .min(30_000)
                .min(control.remaining()?.as_millis() as u64),
        );
    }
    if let Some(intent) = request.translation_intent {
        outgoing = outgoing.header("X-Geek-Translation-Intent", intent.as_str());
    }
    Ok(outgoing)
}

fn map_network(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::TranslationTimeout
    } else {
        AppError::NetworkUnavailable
    }
}

pub fn proxy_endpoint(proxy: &ProxyConfig) -> Result<String> {
    let endpoint = proxy.endpoint()?.ok_or(AppError::ProxyInvalid)?;
    // Chromium SOCKS5 resolves target names at the proxy. reqwest's socks5://
    // means local DNS, so its independent adapter must explicitly use socks5h.
    if matches!(proxy, ProxyConfig::Socks5 { .. }) {
        Ok(endpoint.as_str().replacen("socks5://", "socks5h://", 1))
    } else {
        Ok(endpoint.to_string())
    }
}
