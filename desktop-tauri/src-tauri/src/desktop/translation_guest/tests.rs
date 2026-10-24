use super::telegram_url_matches;
use url::Url;

#[test]
fn telegram_receive_routes_require_the_owned_variant_and_exact_https_origin() {
    for (platform, variant) in [("telegram-z", "a"), ("telegram-k", "k")] {
        for suffix in ["", "/", "/#123", "/#-100123"] {
            let url = Url::parse(&format!("https://web.telegram.org/{variant}{suffix}")).unwrap();
            assert!(telegram_url_matches(platform, &url));
        }
        for value in [
            "http://web.telegram.org/a/",
            "https://web.telegram.org.evil.invalid/a/",
            "https://web.telegram.org:444/a/",
            "https://user@web.telegram.org/a/",
            "https://web.telegram.org/a/other",
            "https://web.telegram.org/a/?test=1",
            "https://web.whatsapp.com/",
        ] {
            assert!(!telegram_url_matches(platform, &Url::parse(value).unwrap()));
        }
    }
    assert!(!telegram_url_matches(
        "telegram-z",
        &Url::parse("https://web.telegram.org/k/").unwrap()
    ));
    assert!(!telegram_url_matches(
        "telegram-k",
        &Url::parse("https://web.telegram.org/a/").unwrap()
    ));
    assert!(!telegram_url_matches(
        "whatsapp",
        &Url::parse("https://web.telegram.org/a/").unwrap()
    ));
}
