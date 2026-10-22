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

fn safe_https(url: &Url) -> bool {
    url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
        && url.port_or_known_default() == Some(443)
}

impl Platform {
    pub fn enabled(&self) -> bool {
        !self.needs_extension && matches!(self.id.as_str(),
            "whatsapp" | "whatsapp-pure" | "telegram-z" | "telegram-k" |
            "messenger" | "instagram" | "website")
    }

    pub fn allows(&self, url: &Url) -> bool {
        if !self.enabled() || !safe_https(url) { return false; }
        let Some(host) = url.host_str() else { return false; };
        self.hostnames.iter().any(|h| h == host) || self.allow_suffix.as_ref()
            .is_some_and(|suffix| suffix.starts_with('.') && host.ends_with(suffix))
    }

    pub fn info(&self) -> PlatformInfo {
        PlatformInfo { id: self.id.clone(), name: self.name.clone(), enabled: self.enabled() }
    }
}

// Account-owned policy; Website A never inherits Website B's origins.
#[derive(Clone)]
pub struct NavigationPolicy {
    platform: Platform,
    start: Url,
}

impl NavigationPolicy {
    pub fn new(platform: &Platform, website_url: Option<&str>) -> Result<Self> {
        if !platform.enabled() { return Err("PLATFORM_UNAVAILABLE"); }
        let start = if platform.id == "website" {
            normalize_website_url(website_url.ok_or("WEBSITE_URL_INVALID")?)?
        } else {
            if website_url.is_some() { return Err("WEBSITE_URL_UNEXPECTED"); }
            platform.url.as_ref().ok_or("CATALOG_INVALID")?.parse::<Url>()
                .map_err(|_| "CATALOG_INVALID")?
        };
        let policy = Self { platform: platform.clone(), start };
        if !policy.allows(&policy.start) { return Err("CATALOG_INVALID"); }
        Ok(policy)
    }

    pub fn start(&self) -> &Url { &self.start }

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
        return Err("WEBSITE_URL_INVALID");
    }
    let url = Url::parse(value.trim()).map_err(|_| "WEBSITE_URL_INVALID")?;
    let host = url.host_str().ok_or("WEBSITE_URL_INVALID")?;
    // Do not persist temporary authentication links or credentials. This is a
    // browser navigation boundary, not a DNS-rebinding/network firewall.
    if !safe_https(&url) || url.query().is_some() || url.fragment().is_some()
        || host == "localhost" || host.ends_with(".localhost") || host.ends_with('.')
        || host.trim_matches(&['[', ']'][..]).parse::<std::net::IpAddr>().is_ok()
    {
        return Err("WEBSITE_URL_INVALID");
    }
    Ok(url)
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
    !name.is_empty() && name == name.trim() && name.chars().count() <= 64
        && !name.chars().any(char::is_control)
}

pub fn shell_url(url: &Url) -> bool {
    safe_https(url) && url.host_str() == Some("tauri.localhost")
        && matches!(url.path(), "/" | "/index.html") && url.query().is_none()
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
    fn line_stays_disabled_and_catalog_entries_remain_valid() {
        let all = catalog().unwrap();
        for id in ["line", "line-business", "unknown"] {
            assert!(platform(&all, id).is_err());
        }
        for p in all.iter().filter(|p| p.enabled() && p.id != "website") {
            assert!(NavigationPolicy::new(p, None).is_ok());
            assert!(NavigationPolicy::new(p, Some("https://example.com/")).is_err());
        }
    }

    #[test]
    fn website_navigation_is_exact_host_and_account_owned() {
        let all = catalog().unwrap();
        let website = platform(&all, "website").unwrap();
        let a = NavigationPolicy::new(website, Some("https://EXAMPLE.com/inbox")).unwrap();
        let b = NavigationPolicy::new(website, Some("https://other.example.com/")).unwrap();
        assert_eq!(a.start().as_str(), "https://example.com/inbox");
        assert!(a.allows(&Url::parse("https://example.com/messages?cursor=synthetic#next").unwrap()));
        assert!(!a.allows(b.start()));
        assert!(!b.allows(a.start()));
        for input in ["http://example.com/", "https://example.com:8443/",
            "https://example.com.evil.invalid/", "https://user@example.com/",
            "https://tauri.localhost/", "file:///C:/Windows/win.ini"] {
            assert!(!a.allows(&Url::parse(input).unwrap()), "{input}");
        }
    }

    #[test]
    fn website_entry_rejects_secrets_local_schemes_and_ambiguous_inputs() {
        for input in ["", "http://example.com", "javascript:alert(1)", "file:///C:/test",
            "https://user:pass@example.com", "https://example.com/?token=synthetic",
            "https://example.com/#token", "https://tauri.localhost", "https://ipc.localhost",
            "https://localhost", "https://127.0.0.1", "https://[::1]", "https://example.com.",
            "https://example.com:8443", "https://exam\nple.com"] {
            assert!(normalize_website_url(input).is_err(), "{input}");
        }
        assert!(normalize_website_url(&format!("https://example.com/{}", "a".repeat(2048))).is_err());
        assert!(normalize_website_url("https://example.com/path").is_ok());
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
