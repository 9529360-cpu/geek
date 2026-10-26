use super::doubles::fixture;
use crate::domain::{account::Settings, error::AppError};

#[test]
fn switching_only_changes_visibility_and_reuses_identity() {
    let (mut desktop, _, host, a, b) = fixture();
    desktop.activate(&a).unwrap();
    desktop.activate(&b).unwrap();
    let snapshot = desktop.activate(&a).unwrap();
    assert_eq!(snapshot.active_id.as_deref(), Some(a.as_str()));
    assert_eq!(snapshot.opened_ids.len(), 2);
    let state = host.0.lock().unwrap();
    assert_eq!(state.visible.len(), 1);
    assert!(state.visible.contains(&a));
    assert_eq!(state.calls.iter().filter(|(op, _)| op == "open").count(), 2);
}

#[test]
fn failed_activation_restores_the_previous_owner() {
    for step in ["fit", "show", "focus"] {
        let (mut desktop, _, host, a, b) = fixture();
        desktop.activate(&a).unwrap();
        host.fail(step, &b);
        assert!(matches!(desktop.activate(&b), Err(AppError::WebviewFailed)));
        assert_eq!(desktop.snapshot().active_id.as_deref(), Some(a.as_str()));
        let state = host.0.lock().unwrap();
        assert_eq!(state.visible.len(), 1);
        assert!(state.visible.contains(&a));
    }
}

#[test]
fn failed_first_open_keeps_metadata_without_inventing_an_active_view() {
    let (mut desktop, _, host, a, _) = fixture();
    host.fail("open", &a);
    assert!(desktop.activate(&a).is_err());
    let snapshot = desktop.snapshot();
    assert!(snapshot.active_id.is_none());
    assert!(snapshot.opened_ids.is_empty());
    assert_eq!(snapshot.accounts.len(), 2);
}

#[test]
fn archive_is_owned_by_rust_and_never_targets_the_active_neighbor() {
    let (mut desktop, _, host, a, b) = fixture();
    desktop.activate(&b).unwrap();
    desktop.activate(&a).unwrap();
    let snapshot = desktop.set_archived(&b, true).unwrap();
    assert_eq!(snapshot.active_id.as_deref(), Some(a.as_str()));
    assert!(!snapshot.opened_ids.contains(&b));
    assert!(snapshot.accounts[1].archived);
    assert!(!snapshot.accounts[0].archived);
    assert!(matches!(
        desktop.activate(&b),
        Err(AppError::AccountArchived)
    ));
    let restored = desktop.set_archived(&b, false).unwrap();
    assert!(!restored.accounts[1].archived);
    assert!(!restored.opened_ids.contains(&b));
    assert!(host.0.lock().unwrap().visible.contains(&a));
}

#[test]
fn failed_close_prevents_archiving_and_disk_write() {
    let (mut desktop, repository, host, a, _) = fixture();
    desktop.activate(&a).unwrap();
    let writes = repository.0.lock().unwrap().saves;
    host.fail("close", &a);
    assert!(desktop.set_archived(&a, true).is_err());
    assert!(!desktop.snapshot().accounts[0].archived);
    assert_eq!(desktop.snapshot().active_id.as_deref(), Some(a.as_str()));
    assert_eq!(repository.0.lock().unwrap().saves, writes);
}

#[test]
fn failed_archive_commit_leaves_a_closed_recoverable_account() {
    let (mut desktop, repository, _, a, _) = fixture();
    desktop.activate(&a).unwrap();
    repository.0.lock().unwrap().fail_save = true;
    assert!(matches!(
        desktop.set_archived(&a, true),
        Err(AppError::StoreIo)
    ));
    let snapshot = desktop.snapshot();
    assert!(snapshot.active_id.is_none());
    assert!(!snapshot.opened_ids.contains(&a));
    assert!(!snapshot.accounts[0].archived);
    assert_eq!(snapshot.accounts[0].id, a);
}

#[test]
fn settings_effects_are_published_only_after_persistence() {
    let (mut desktop, repository, host, _, _) = fixture();
    assert!(matches!(
        desktop.set_settings(Settings {
            close_to_tray: true,
            ..Settings::default()
        }),
        Err(AppError::TrayUnavailable)
    ));
    host.0.lock().unwrap().tray = true;
    repository.0.lock().unwrap().fail_save = true;
    assert!(desktop
        .set_settings(Settings {
            close_to_tray: true,
            ..Settings::default()
        })
        .is_err());
    assert!(!desktop.snapshot().settings.close_to_tray);
    assert!(!host.0.lock().unwrap().close_to_tray);
    repository.0.lock().unwrap().fail_save = false;
    desktop
        .set_settings(Settings {
            close_to_tray: true,
            ..Settings::default()
        })
        .unwrap();
    assert!(host.0.lock().unwrap().close_to_tray);
}

#[test]
fn unknown_accounts_never_reach_the_host() {
    let (mut desktop, repository, host, _, _) = fixture();
    // Fixture initialization legitimately focuses the shell. Invalid account
    // operations must add no native effects or durable writes after that baseline.
    let calls = host.0.lock().unwrap().calls.clone();
    let saves = repository.0.lock().unwrap().saves;
    for id in ["../shell", "shell", "00000000-0000-4000-8000-000000000000"] {
        assert!(desktop.activate(id).is_err());
        assert!(desktop.close(id).is_err());
        assert!(desktop.reload(id).is_err());
        assert!(desktop.set_archived(id, true).is_err());
        assert!(desktop.rename(id, "Invalid owner").is_err());
        assert!(desktop
            .update_display(id, "Invalid owner", 16, "#18A058")
            .is_err());
        assert!(desktop.set_proxy(id, Default::default()).is_err());
        assert_eq!(host.0.lock().unwrap().calls, calls);
        assert_eq!(repository.0.lock().unwrap().saves, saves);
    }
}

#[test]
fn error_codes_keep_the_existing_string_wire_format() {
    for error in [
        AppError::DpapiFailed,
        AppError::StoreIo,
        AppError::AccountUnknown,
    ] {
        assert_eq!(serde_json::to_value(error).unwrap(), error.code());
        assert_eq!(error.to_string(), error.code());
    }
}
