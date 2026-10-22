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
        !self.needs_extension
            && matches!(
                self.id.as_str(),
                "whatsapp"
                    | "whatsapp-pure"
                    | "telegram-z"
                    | "telegram-k"
                    | "messenger"
                    | "instagram"
                    | "website"
            )
    }

    pub fn allows(&self, url: &Url) -> bool {
        if !self.enabled() || !safe_https(url) {
            return false;
        }
        let Some(host) = url.host_str() else {
            return false;
        };
        self.hostnames.iter().any(|h| h == host)
            || self
                .allow_suffix
                .as_ref()
                .is_some_and(|suffix| suffix.starts_with('.') && host.ends_with(suffix))
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

pub fn platform<'a>(catalog: &'a [Platform], id: &str) -> Result<&'a Platform> {
    catalog
        .iter()
        .find(|p| p.id == id && p.enabled())
        .ok_or(AppError::PlatformUnavailable)
}
