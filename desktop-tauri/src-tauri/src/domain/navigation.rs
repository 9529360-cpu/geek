use super::{
    error::{AppError, Result},
    platform::{line_entry_url, line_family, Platform},
    url_policy::safe_https,
};
use url::Url;

// Account-owned policy; Website A never inherits Website B's origins.
#[derive(Clone)]
pub struct NavigationPolicy {
    platform: Platform,
    start: Url,
}

impl NavigationPolicy {
    pub fn new(platform: &Platform, website_url: Option<&str>) -> Result<Self> {
        if !platform.enabled() {
            return Err(AppError::PlatformUnavailable);
        }
        let start = if platform.id == "website" {
            normalize_website_url(website_url.ok_or(AppError::WebsiteUrlInvalid)?)?
        } else {
            if website_url.is_some() {
                return Err(AppError::WebsiteUrlUnexpected);
            }
            if line_family(&platform.id) {
                line_entry_url(platform)?
            } else {
                platform
                    .url
                    .as_ref()
                    .ok_or(AppError::CatalogInvalid)?
                    .parse::<Url>()
                    .map_err(|_| AppError::CatalogInvalid)?
            }
        };
        let policy = Self {
            platform: platform.clone(),
            start,
        };
        if !policy.allows(&policy.start) {
            return Err(AppError::CatalogInvalid);
        }
        Ok(policy)
    }

    pub fn start(&self) -> &Url {
        &self.start
    }

    pub fn allows(&self, url: &Url) -> bool {
        if self.platform.id == "website" {
            safe_https(url) && url.host_str() == self.start.host_str()
        } else {
            self.platform.allows(url)
        }
    }
}

pub fn normalize_website_url(value: &str) -> Result<Url> {
    if value.len() > 2048 || value.chars().any(char::is_control) {
        return Err(AppError::WebsiteUrlInvalid);
    }
    let url = Url::parse(value.trim()).map_err(|_| AppError::WebsiteUrlInvalid)?;
    let host = url.host_str().ok_or(AppError::WebsiteUrlInvalid)?;
    // Do not persist temporary authentication links or credentials. This is a
    // browser navigation boundary, not a DNS-rebinding/network firewall.
    if !safe_https(&url)
        || url.query().is_some()
        || url.fragment().is_some()
        || host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with('.')
        || host
            .trim_matches(&['[', ']'][..])
            .parse::<std::net::IpAddr>()
            .is_ok()
    {
        return Err(AppError::WebsiteUrlInvalid);
    }
    Ok(url)
}
