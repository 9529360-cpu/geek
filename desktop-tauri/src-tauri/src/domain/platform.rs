use super::{
    error::{AppError, Result},
    url_policy::safe_https,
};
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Platform {
    pub id: String,
    pub name: String,
    pub family: String,
    pub family_label: String,
    pub url: Option<String>,
    pub hostnames: Vec<String>,
    pub allow_suffix: Option<String>,
    pub needs_extension: bool,
    #[serde(default)]
    pub extension_id: Option<String>,
}

pub const LINE_EXTENSION_ID: &str = "ophjlpahpchlmihnnnihgmmeilfjmjjc";

pub fn line_family(id: &str) -> bool {
    matches!(id, "line" | "line-business")
}

pub fn line_entry_url(platform: &Platform) -> Result<Url> {
    if !line_family(&platform.id) || platform.extension_id.as_deref() != Some(LINE_EXTENSION_ID) {
        return Err(AppError::CatalogInvalid);
    }
    Url::parse(&format!(
        "chrome-extension://{LINE_EXTENSION_ID}/index.html"
    ))
    .map_err(|_| AppError::CatalogInvalid)
}

fn extension_navigation(url: &Url) -> bool {
    url.scheme() == "chrome-extension"
        && url.host_str() == Some(LINE_EXTENSION_ID)
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.path().starts_with('/')
        && !url
            .path()
            .split('/')
            .any(|segment| segment == "." || segment == "..")
}

pub fn line_extension_document(url: &Url) -> bool {
    extension_navigation(url) && matches!(url.path(), "/index.html" | "/index.html/")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub id: String,
    pub name: String,
    pub family: String,
    pub family_label: String,
    pub enabled: bool,
}

impl Platform {
    pub fn enabled(&self) -> bool {
        let known = matches!(
            self.id.as_str(),
            "whatsapp"
                | "whatsapp-pure"
                | "telegram-z"
                | "telegram-k"
                | "messenger"
                | "instagram"
                | "line"
                | "line-business"
                | "website"
        );
        // LINE stays an extension platform. Every other enabled platform must not be one.
        known && line_family(&self.id) == self.needs_extension
    }

    fn https_host_allowed(&self, url: &Url) -> bool {
        if !safe_https(url) {
            return false;
        }
        let Some(host) = url.host_str() else {
            return false;
        };
        self.hostnames.iter().any(|item| item == host)
            || self
                .allow_suffix
                .as_ref()
                .is_some_and(|suffix| suffix.starts_with('.') && host.ends_with(suffix))
    }

    pub fn allows(&self, url: &Url) -> bool {
        if !self.enabled() {
            return false;
        }
        if line_family(&self.id) {
            return extension_navigation(url) || self.https_host_allowed(url);
        }
        self.https_host_allowed(url)
    }

    pub fn info(&self) -> PlatformInfo {
        PlatformInfo {
            id: self.id.clone(),
            name: self.name.clone(),
            family: self.family.clone(),
            family_label: self.family_label.clone(),
            enabled: self.enabled(),
        }
    }
}

pub fn document_matches(platform: &str, url: &Url) -> bool {
    if line_family(platform) {
        return line_extension_document(url);
    }
    if !safe_https(url) {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    match platform {
        "whatsapp" | "whatsapp-pure" => host == "web.whatsapp.com",
        "telegram-k" => {
            host == "web.telegram.org"
                && matches!(url.path(), "/k" | "/k/")
                && url.query().is_none()
        }
        "telegram-z" => {
            host == "web.telegram.org"
                && matches!(url.path(), "/a" | "/a/")
                && url.query().is_none()
        }
        "messenger" => {
            matches!(host, "www.facebook.com" | "facebook.com")
                && url.path().starts_with("/messages")
        }
        "instagram" => {
            matches!(host, "www.instagram.com" | "instagram.com")
                && url.path().starts_with("/direct")
        }
        _ => false,
    }
}

pub fn platform<'a>(catalog: &'a [Platform], id: &str) -> Result<&'a Platform> {
    catalog
        .iter()
        .find(|p| p.id == id && p.enabled())
        .ok_or(AppError::PlatformUnavailable)
}
