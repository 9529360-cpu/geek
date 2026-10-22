use serde::{Deserialize, Serialize};
use tauri::Url;
use uuid::Uuid;

pub type Result<T> = std::result::Result<T, &'static str>;
pub const MAX_ACCOUNTS: usize = 20;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Platform {
    pub id: String,
    pub name: String,
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
    pub enabled: bool,
}

impl Platform {
    pub fn enabled(&self) -> bool {
        !self.needs_extension && matches!(self.id.as_str(),
            "whatsapp" | "whatsapp-pure" | "telegram-z" | "telegram-k" |
            "messenger" | "instagram")
    }

    pub fn allows(&self, url: &Url) -> bool {
        if !self.enabled() || url.scheme() != "https" ||
            !url.username().is_empty() || url.password().is_some() ||
            url.port_or_known_default() != Some(443) {
            return false;
        }
        let Some(host) = url.host_str() else { return false; };
        self.hostnames.iter().any(|h| h == host) || self.allow_suffix.as_ref()
            .is_some_and(|suffix| suffix.starts_with('.') && host.ends_with(suffix))
    }

    pub fn info(&self) -> PlatformInfo {
        PlatformInfo { id: self.id.clone(), name: self.name.clone(), enabled: self.enabled() }
    }
}

pub fn catalog() -> Result<Vec<Platform>> {
    serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/platforms.json")))
        .map_err(|_| "CATALOG_INVALID")
}

pub fn platform<'a>(catalog: &'a [Platform], id: &str) -> Result<&'a Platform> {
    catalog.iter().find(|p| p.id == id && p.enabled()).ok_or("PLATFORM_UNAVAILABLE")
}

pub fn valid_id(id: &str) -> bool {
    Uuid::parse_str(id).is_ok_and(|uuid| uuid.get_version_num() == 4 && uuid.to_string() == id)
}

pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name == name.trim() && name.chars().count() <= 64 &&
        !name.chars().any(char::is_control)
}

pub fn shell_url(url: &Url) -> bool {
    url.scheme() == "https" && url.host_str() == Some("tauri.localhost") &&
        url.port_or_known_default() == Some(443) && url.username().is_empty() &&
        url.password().is_none() && matches!(url.path(), "/" | "/index.html") &&
        url.query().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_boundary_is_not_a_global_allowlist() {
        let all = catalog().unwrap();
        let wa = platform(&all, "whatsapp").unwrap();
        for input in ["https://web.whatsapp.com/", "https://www.whatsapp.com/"] {
            assert!(wa.allows(&Url::parse(input).unwrap()));
        }
        for input in ["http://web.whatsapp.com/", "https://web.telegram.org/",
            "https://web.whatsapp.com.evil.invalid/", "https://evilwhatsapp.com/",
            "https://user@web.whatsapp.com/", "https://web.whatsapp.com:8443/",
            "file:///C:/Windows/win.ini", "https://tauri.localhost/"] {
            assert!(!wa.allows(&Url::parse(input).unwrap()), "{input}");
        }
    }

    #[test]
    fn unsupported_platforms_fail_closed() {
        let all = catalog().unwrap();
        for id in ["line", "line-business", "website", "unknown"] {
            assert!(platform(&all, id).is_err());
        }
        for p in all.iter().filter(|p| p.enabled()) {
            assert!(p.allows(&Url::parse(p.url.as_ref().unwrap()).unwrap()));
        }
    }

    #[test]
    fn identifiers_and_names_are_bounded() {
        assert!(valid_id(&Uuid::new_v4().to_string()));
        for id in ["../shell", "C:\\Users", "", "shell", "00000000-0000-0000-0000-000000000000"] {
            assert!(!valid_id(id));
        }
        assert!(valid_name("Test account"));
        for name in ["", " ", " name", "name\n"] { assert!(!valid_name(name)); }
        assert!(!valid_name(&"a".repeat(65)));
    }

    #[test]
    fn shell_origin_is_exact() {
        assert!(shell_url(&Url::parse("https://tauri.localhost/index.html").unwrap()));
        for s in ["http://tauri.localhost/", "https://tauri.localhost.evil.invalid/",
            "https://web.whatsapp.com/", "https://tauri.localhost/?redirect=x",
            "https://tauri.localhost/other.html"] {
            assert!(!shell_url(&Url::parse(s).unwrap()));
        }
    }
}
