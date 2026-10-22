use crate::{
    desktop::security::shell_url,
    domain::{
        account::{valid_id, valid_name},
        navigation::{normalize_website_url, NavigationPolicy},
        platform::platform,
    },
    infrastructure::catalog::load as catalog,
};
use url::Url;
use uuid::Uuid;

#[test]
fn platform_boundary_is_not_a_global_allowlist() {
    let all = catalog().unwrap();
    let wa = platform(&all, "whatsapp").unwrap();
    for input in ["https://web.whatsapp.com/", "https://www.whatsapp.com/"] {
        assert!(wa.allows(&Url::parse(input).unwrap()));
    }
    for input in [
        "http://web.whatsapp.com/",
        "https://web.telegram.org/",
        "https://web.whatsapp.com.evil.invalid/",
        "https://evilwhatsapp.com/",
        "https://user@web.whatsapp.com/",
        "https://web.whatsapp.com:8443/",
        "file:///C:/Windows/win.ini",
        "https://tauri.localhost/",
    ] {
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
    for input in [
        "http://example.com/",
        "https://example.com:8443/",
        "https://example.com.evil.invalid/",
        "https://user@example.com/",
        "https://tauri.localhost/",
        "file:///C:/Windows/win.ini",
    ] {
        assert!(!a.allows(&Url::parse(input).unwrap()), "{input}");
    }
}

#[test]
fn website_entry_rejects_secrets_local_schemes_and_ambiguous_inputs() {
    for input in [
        "",
        "http://example.com",
        "javascript:alert(1)",
        "file:///C:/test",
        "https://user:pass@example.com",
        "https://example.com/?token=synthetic",
        "https://example.com/#token",
        "https://tauri.localhost",
        "https://ipc.localhost",
        "https://localhost",
        "https://127.0.0.1",
        "https://[::1]",
        "https://example.com.",
        "https://example.com:8443",
        "https://exam\nple.com",
    ] {
        assert!(normalize_website_url(input).is_err(), "{input}");
    }
    assert!(normalize_website_url(&format!("https://example.com/{}", "a".repeat(2048))).is_err());
    assert!(normalize_website_url("https://example.com/path").is_ok());
}

#[test]
fn identifiers_and_names_are_bounded() {
    assert!(valid_id(&Uuid::new_v4().to_string()));
    for id in [
        "../shell",
        "C:\\Users",
        "",
        "shell",
        "00000000-0000-0000-0000-000000000000",
    ] {
        assert!(!valid_id(id));
    }
    assert!(valid_name("Test account"));
    for name in ["", " ", " name", "name\n"] {
        assert!(!valid_name(name));
    }
    assert!(!valid_name(&"a".repeat(65)));
}

#[test]
fn shell_origin_is_exact() {
    assert!(shell_url(
        &Url::parse("https://tauri.localhost/index.html").unwrap()
    ));
    for s in [
        "http://tauri.localhost/",
        "https://tauri.localhost.evil.invalid/",
        "https://web.whatsapp.com/",
        "https://tauri.localhost/?redirect=x",
        "https://tauri.localhost/other.html",
    ] {
        assert!(!shell_url(&Url::parse(s).unwrap()));
    }
}
