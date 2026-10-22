use super::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use url::Url;

/// Account-owned browser routing. No passwords, PAC, bypass list or raw flags.
/// System means the OS policy, not a promise of a direct connection.
#[derive(Clone, Default, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase", deny_unknown_fields)]
pub enum ProxyConfig {
    #[default]
    System,
    Http { host: String, port: u16 },
    Socks5 { host: String, port: u16 },
}

impl ProxyConfig {
    pub fn endpoint(&self) -> Result<Option<Url>> {
        let (scheme, host, port) = match self {
            Self::System => return Ok(None),
            Self::Http { host, port } => ("http", host, *port),
            Self::Socks5 { host, port } => ("socks5", host, *port),
        };
        if port == 0 || host.is_empty() || host.len() > 253 || !host.is_ascii() {
            return Err(AppError::ProxyInvalid);
        }
        // Never interpolate credentials, flags, separators, paths or control bytes.
        if !host.bytes().all(|b| b.is_ascii_alphanumeric() || b".-:[]".contains(&b)) {
            return Err(AppError::ProxyInvalid);
        }
        let parsed = Url::parse(&format!("http://{host}:{port}/"))
            .map_err(|_| AppError::ProxyInvalid)?;
        let canonical = parsed.host_str().ok_or(AppError::ProxyInvalid)?;
        if canonical != host.to_ascii_lowercase() {
            return Err(AppError::ProxyInvalid);
        }
        if !canonical.starts_with('[')
            && canonical.split('.').any(|part| {
                part.is_empty()
                    || part.len() > 63
                    || part.starts_with('-')
                    || part.ends_with('-')
            })
        {
            return Err(AppError::ProxyInvalid);
        }
        Url::parse(&format!("{scheme}://{canonical}:{port}"))
            .map(Some)
            .map_err(|_| AppError::ProxyInvalid)
    }

    pub fn validate(&self) -> Result<()> {
        self.endpoint().map(|_| ())
    }
}
