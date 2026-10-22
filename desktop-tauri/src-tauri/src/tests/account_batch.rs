use super::doubles::fixture;
use crate::{
    application::accounts::Accounts,
    domain::{account, account_batch, error::AppError, proxy::ProxyConfig},
    infrastructure::{catalog, profiles::account_profile, repository::EncryptedRepository},
};
use std::collections::HashSet;

fn proxy() -> ProxyConfig {
    ProxyConfig::Http {
        host: "127.0.0.1".into(),
        port: 8080,
    }
}

#[test]
fn batch_names_preserve_original_count_suffixes_and_default_numbering() {
    assert_eq!(
        account_batch::names(" Team ", "WA", 2, 1).unwrap(),
        ["Team"]
    );
    assert_eq!(
        account_batch::names("Team", "WA", 2, 3).unwrap(),
        ["Team 1", "Team 2", "Team 3"]
    );
    assert_eq!(
        account_batch::names(" ", "WA", 2, 2).unwrap(),
        ["WA 3", "WA 4"]
    );
    assert!(account_batch::names(&"a".repeat(62), "WA", 0, 9).is_ok());
    assert_eq!(
        account_batch::names(&"a".repeat(62), "WA", 0, 10),
        Err(AppError::NameInvalid)
    );
    assert!(account_batch::names(&"\u{8d26}".repeat(62), "WA", 0, 2).is_ok());
    assert!(account_batch::names("name\ninside", "WA", 0, 2).is_err());
}

#[test]
fn batch_commits_once_with_distinct_ids_and_no_native_effects() {
    let (mut workspace, disk, host, a, _) = fixture();
    workspace.activate(&a).unwrap();
    let calls = host.0.lock().unwrap().calls.clone();
    let writes = disk.0.lock().unwrap().saves;
    let created = workspace
        .create_batch("Team", "whatsapp", None, proxy(), 3)
        .unwrap();
    assert_eq!(created.created_ids.len(), 3);
    assert_eq!(created.snapshot.accounts.len(), 5);
    assert_eq!(created.snapshot.active_id.as_deref(), Some(a.as_str()));
    assert_eq!(created.snapshot.opened_ids, vec![a]);
    assert_eq!(disk.0.lock().unwrap().saves, writes + 1);
    assert_eq!(host.0.lock().unwrap().calls, calls);
    let ids: HashSet<_> = created.created_ids.iter().collect();
    assert_eq!(ids.len(), 3);
    for (index, item) in created.snapshot.accounts[2..].iter().enumerate() {
        assert!(account::valid_id(&item.id));
        assert_eq!(item.id, created.created_ids[index]);
        assert_eq!(item.proxy, proxy());
        assert_eq!(item.name, format!("Team {}", index + 1));
        assert!(!item.archived);
    }
    let wire = serde_json::to_value(&created).unwrap();
    assert!(wire.get("createdIds").is_some());
    assert!(wire.get("snapshot").is_some());
}

#[test]
fn failed_batch_write_leaves_memory_disk_and_native_views_unchanged() {
    let (mut workspace, disk, host, a, _) = fixture();
    workspace.activate(&a).unwrap();
    let before = serde_json::to_value(workspace.snapshot()).unwrap();
    let calls = host.0.lock().unwrap().calls.clone();
    let stored = serde_json::to_value(&disk.0.lock().unwrap().document).unwrap();
    let writes = disk.0.lock().unwrap().saves;
    disk.0.lock().unwrap().fail_save = true;
    assert!(matches!(
        workspace.create_batch("Team", "whatsapp", None, proxy(), 3),
        Err(AppError::StoreIo)
    ));
    assert_eq!(serde_json::to_value(workspace.snapshot()).unwrap(), before);
    assert_eq!(
        serde_json::to_value(&disk.0.lock().unwrap().document).unwrap(),
        stored
    );
    assert_eq!(disk.0.lock().unwrap().saves, writes);
    assert_eq!(host.0.lock().unwrap().calls, calls);
}

#[test]
fn invalid_batch_rejects_every_member_before_any_write_or_native_effect() {
    let (mut workspace, disk, host, _, _) = fixture();
    let before = serde_json::to_value(workspace.snapshot()).unwrap();
    let calls = host.0.lock().unwrap().calls.clone();
    let writes = disk.0.lock().unwrap().saves;
    for count in [0, 11, 255] {
        assert!(matches!(
            workspace.create_batch("Team", "whatsapp", None, proxy(), count),
            Err(AppError::BatchInvalid)
        ));
    }
    // The tenth suffix would overflow the limit; the first nine must not commit.
    assert!(matches!(
        workspace.create_batch(&"a".repeat(62), "whatsapp", None, proxy(), 10),
        Err(AppError::NameInvalid)
    ));
    assert!(workspace
        .create_batch("Bad", "website", Some("http://example.com"), proxy(), 2)
        .is_err());
    assert!(workspace
        .create_batch("Bad", "line", None, proxy(), 2)
        .is_err());
    let invalid_proxy = ProxyConfig::Http {
        host: "user:password@host".into(),
        port: 80,
    };
    assert!(workspace
        .create_batch("Bad", "whatsapp", None, invalid_proxy, 2)
        .is_err());
    assert_eq!(serde_json::to_value(workspace.snapshot()).unwrap(), before);
    assert_eq!(disk.0.lock().unwrap().saves, writes);
    assert_eq!(host.0.lock().unwrap().calls, calls);
}

#[test]
fn capacity_counts_archives_and_rejects_the_whole_batch() {
    let (mut workspace, disk, _, a, _) = fixture();
    workspace
        .create_batch("Team", "whatsapp", None, proxy(), 10)
        .unwrap();
    workspace
        .create_batch("Team", "whatsapp", None, proxy(), 7)
        .unwrap();
    workspace.set_archived(&a, true).unwrap();
    let writes = disk.0.lock().unwrap().saves;
    assert!(matches!(
        workspace.create_batch("Overflow", "whatsapp", None, proxy(), 2),
        Err(AppError::AccountLimit)
    ));
    assert_eq!(workspace.snapshot().accounts.len(), 19);
    assert_eq!(disk.0.lock().unwrap().saves, writes);
    workspace
        .create_batch("Last", "whatsapp", None, proxy(), 1)
        .unwrap();
    assert_eq!(workspace.snapshot().accounts.len(), 20);
}

#[test]
fn first_open_failure_keeps_the_complete_batch_without_opening_neighbors() {
    let (mut workspace, _, host, a, _) = fixture();
    workspace.activate(&a).unwrap();
    let created = workspace
        .create_batch("Team", "whatsapp", None, proxy(), 3)
        .unwrap();
    let first = &created.created_ids[0];
    host.fail("open", first);
    assert!(workspace.activate(first).is_err());
    assert_eq!(workspace.snapshot().accounts.len(), 5);
    assert_eq!(workspace.snapshot().active_id.as_deref(), Some(a.as_str()));
    assert!(created
        .created_ids
        .iter()
        .all(|id| !host.0.lock().unwrap().opened.contains(id)));
    host.recover();
    workspace.activate(first).unwrap();
    assert_eq!(workspace.snapshot().opened_ids.len(), 2);
    assert!(created.created_ids[1..]
        .iter()
        .all(|id| !host.0.lock().unwrap().opened.contains(id)));
}

#[test]
fn batch_survives_encrypted_restart_with_distinct_website_profiles() {
    let root = tempfile::tempdir().unwrap();
    let open = || {
        Accounts::open(
            EncryptedRepository::open(root.path().into()).unwrap(),
            catalog::load().unwrap(),
        )
        .unwrap()
    };
    let mut accounts = open();
    let ids = accounts
        .create_batch(
            "Synthetic batch",
            "website",
            Some("https://example.com/inbox"),
            proxy(),
            2,
        )
        .unwrap();
    drop(accounts);
    let ciphertext = std::fs::read(root.path().join("accounts.dpapi")).unwrap();
    assert!(!ciphertext
        .windows(15)
        .any(|bytes| bytes == b"Synthetic batch"));
    let accounts = open();
    assert_eq!(accounts.accounts().len(), 2);
    for (item, id) in accounts.accounts().iter().zip(&ids) {
        assert_eq!(&item.id, id);
        assert_eq!(item.proxy, proxy());
        assert_eq!(
            item.website_url.as_deref(),
            Some("https://example.com/inbox")
        );
    }
    assert_ne!(
        account_profile(root.path(), &ids[0]).unwrap(),
        account_profile(root.path(), &ids[1]).unwrap()
    );
}
