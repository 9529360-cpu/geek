use super::doubles::fixture;
use crate::{
    application::accounts::Accounts,
    domain::{document::Document, error::AppError, proxy::ProxyConfig},
    infrastructure::{catalog, dpapi, repository::EncryptedRepository},
};
use std::fs;

fn http() -> ProxyConfig {
    ProxyConfig::Http {
        host: "127.0.0.1".into(),
        port: 8080,
    }
}

#[test]
fn routing_accepts_only_typed_system_http_and_socks5_endpoints() {
    assert!(ProxyConfig::System.endpoint().unwrap().is_none());
    assert_eq!(
        http().endpoint().unwrap().unwrap().as_str(),
        "http://127.0.0.1:8080/"
    );
    for (host, expected) in [
        ("localhost", "socks5://localhost:1080"),
        ("proxy.example.com", "socks5://proxy.example.com:1080"),
        ("[::1]", "socks5://[::1]:1080"),
    ] {
        let proxy = ProxyConfig::Socks5 {
            host: host.into(),
            port: 1080,
        };
        assert_eq!(proxy.endpoint().unwrap().unwrap().as_str(), expected);
    }
    for host in [
        "",
        "user:password@proxy.example.com",
        "https://proxy.example.com",
        "host/path",
        "host?token=synthetic",
        "host#x",
        "host --no-sandbox",
        "host;direct://",
        "host,other",
        "host\n",
        "host%20",
        ".host",
        "host.",
        "-host",
        "host-",
        "host..invalid",
        "::1",
        "2130706433",
        "127.0.0.01",
    ] {
        let proxy = ProxyConfig::Http {
            host: host.into(),
            port: 8080,
        };
        assert_eq!(proxy.validate(), Err(AppError::ProxyInvalid));
    }
    assert!(ProxyConfig::Http {
        host: "host".into(),
        port: 0
    }
    .validate()
    .is_err());
    assert!(ProxyConfig::Http {
        host: "a".repeat(254),
        port: 80
    }
    .validate()
    .is_err());
}

#[test]
fn proxy_payloads_cannot_smuggle_credentials_or_browser_arguments() {
    for value in [
        serde_json::json!({"mode":"direct"}),
        serde_json::json!({"mode":"http", "host":"host", "port":65536}),
        serde_json::json!({"mode":"http", "host":"host", "port":-1}),
        serde_json::json!({"mode":"http", "host":"host", "port":80, "password":"synthetic"}),
        serde_json::json!({"mode":"socks5", "host":"host", "port":1080, "args":"--no-sandbox"}),
        serde_json::json!({"mode":"system", "host":"host"}),
        serde_json::json!({"mode":"system", "host":null}),
        serde_json::json!({"mode":"system", "port":8080}),
        serde_json::json!({"mode":"system", "password":"synthetic"}),
    ] {
        assert!(serde_json::from_value::<ProxyConfig>(value).is_err());
    }
}

#[test]
fn changing_b_closes_only_b_and_reopen_uses_its_saved_route() {
    let (mut workspace, disk, host, a, b) = fixture();
    workspace.activate(&b).unwrap();
    workspace.activate(&a).unwrap();
    let result = workspace.set_proxy(&b, http()).unwrap();
    assert_eq!(result.active_id.as_deref(), Some(a.as_str()));
    assert_eq!(result.opened_ids, vec![a.clone()]);
    assert_eq!(result.accounts[0].proxy, ProxyConfig::System);
    assert_eq!(result.accounts[1].proxy, http());
    assert_eq!(
        disk.0.lock().unwrap().document.as_ref().unwrap().accounts[1].proxy,
        http()
    );
    workspace.activate(&b).unwrap();
    assert_eq!(host.0.lock().unwrap().routes[&b], http());
    assert_eq!(host.0.lock().unwrap().routes[&a], ProxyConfig::System);
}

#[test]
fn validation_and_noop_happen_before_native_side_effects() {
    let (mut workspace, disk, host, a, _) = fixture();
    workspace.activate(&a).unwrap();
    let calls = host.0.lock().unwrap().calls.len();
    let saves = disk.0.lock().unwrap().saves;
    workspace.set_proxy(&a, ProxyConfig::System).unwrap();
    let invalid = ProxyConfig::Http {
        host: "user@host".into(),
        port: 80,
    };
    assert!(workspace.set_proxy(&a, invalid).is_err());
    assert!(workspace.set_proxy("../other", http()).is_err());
    assert_eq!(host.0.lock().unwrap().calls.len(), calls);
    assert_eq!(disk.0.lock().unwrap().saves, saves);
    assert_eq!(workspace.snapshot().active_id.as_deref(), Some(a.as_str()));
}

#[test]
fn failed_or_pending_close_never_commits_routing_or_archive() {
    let (mut workspace, disk, host, a, _) = fixture();
    workspace.activate(&a).unwrap();
    let saves = disk.0.lock().unwrap().saves;
    host.0.lock().unwrap().fail = Some(("close", a.clone()));
    assert!(workspace.set_proxy(&a, http()).is_err());
    host.0.lock().unwrap().fail = None;
    host.0.lock().unwrap().close_pending = true;
    assert!(matches!(
        workspace.set_proxy(&a, http()),
        Err(AppError::AccountStillOpen)
    ));
    assert!(matches!(
        workspace.set_archived(&a, true),
        Err(AppError::AccountStillOpen)
    ));
    assert_eq!(disk.0.lock().unwrap().saves, saves);
    assert_eq!(workspace.snapshot().active_id.as_deref(), Some(a.as_str()));
    assert_eq!(workspace.snapshot().accounts[0].proxy, ProxyConfig::System);
    assert!(!workspace.snapshot().accounts[0].archived);
}

#[test]
fn disk_failure_after_close_keeps_old_route_without_automatic_reconnect() {
    let (mut workspace, disk, host, a, _) = fixture();
    workspace.activate(&a).unwrap();
    disk.0.lock().unwrap().fail_save = true;
    assert!(matches!(
        workspace.set_proxy(&a, http()),
        Err(AppError::StoreIo)
    ));
    let result = workspace.snapshot();
    assert!(result.active_id.is_none());
    assert!(!result.opened_ids.contains(&a));
    assert_eq!(result.accounts[0].proxy, ProxyConfig::System);
    assert_eq!(
        disk.0.lock().unwrap().document.as_ref().unwrap().accounts[0].proxy,
        ProxyConfig::System
    );
    assert_eq!(
        host.0.lock().unwrap().calls.last().unwrap(),
        &("close".into(), a)
    );
}

#[test]
fn creation_binds_proxy_before_first_open_and_open_failure_keeps_configuration() {
    let (mut workspace, _, host, _, _) = fixture();
    let result = workspace
        .create("Proxied", "whatsapp", None, http())
        .unwrap();
    let id = result.accounts.last().unwrap().id.clone();
    assert!(!result.opened_ids.contains(&id));
    host.0.lock().unwrap().fail = Some(("open", id.clone()));
    assert!(workspace.activate(&id).is_err());
    assert_eq!(workspace.snapshot().accounts.last().unwrap().proxy, http());
    assert_eq!(
        host.0
            .lock()
            .unwrap()
            .calls
            .iter()
            .filter(|(op, owner)| op == "open" && owner == &id)
            .count(),
        1
    );
    host.0.lock().unwrap().fail = None;
    workspace.activate(&id).unwrap();
    assert_eq!(host.0.lock().unwrap().routes[&id], http());
}

#[test]
fn encrypted_proxy_restart_and_legacy_migration_preserve_account_identity() {
    let root = tempfile::tempdir().unwrap();
    let open = || {
        Accounts::open(
            EncryptedRepository::open(root.path().into()).unwrap(),
            catalog::load().unwrap(),
        )
        .unwrap()
    };
    let mut accounts = open();
    accounts
        .create("Synthetic", "whatsapp", None, http())
        .unwrap();
    let id = accounts.accounts()[0].id.clone();
    drop(accounts);
    let ciphertext = fs::read(root.path().join("accounts.dpapi")).unwrap();
    assert!(!ciphertext.windows(9).any(|part| part == b"127.0.0.1"));
    assert_eq!(open().accounts()[0].proxy, http());
    for version in [1, 2] {
        let legacy = serde_json::json!({"schemaVersion":version, "accounts":[
            {"id":id, "name":"Synthetic", "platformId":"whatsapp"}
        ]});
        let encrypted = dpapi::encrypt(&serde_json::to_vec(&legacy).unwrap()).unwrap();
        fs::write(root.path().join("accounts.dpapi"), &encrypted[..]).unwrap();
        let mut accounts = open();
        assert_eq!(accounts.accounts()[0].id, id);
        assert_eq!(accounts.accounts()[0].proxy, ProxyConfig::System);
        assert_eq!(
            fs::read(root.path().join("accounts.dpapi")).unwrap(),
            encrypted[..]
        );
        accounts.set_proxy(&id, http()).unwrap();
        drop(accounts);
        let plain = dpapi::decrypt(&fs::read(root.path().join("accounts.dpapi")).unwrap()).unwrap();
        let document: Document = serde_json::from_slice(&plain).unwrap();
        assert_eq!(document.schema_version, 3);
        assert_eq!(document.accounts[0].id, id);
        assert_eq!(document.accounts[0].proxy, http());
    }
}

#[test]
fn strict_proxy_wire_roundtrips_without_changing_schema() {
    for proxy in [
        ProxyConfig::System,
        http(),
        ProxyConfig::Socks5 {
            host: "localhost".into(),
            port: 1080,
        },
    ] {
        let value = serde_json::to_value(&proxy).unwrap();
        assert_eq!(serde_json::from_value::<ProxyConfig>(value).unwrap(), proxy);
    }
    assert_eq!(
        serde_json::to_value(ProxyConfig::System).unwrap(),
        serde_json::json!({"mode":"system"})
    );
}
