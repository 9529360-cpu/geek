use super::doubles::{fixture, MemoryRepository};
use crate::{
    application::accounts::Accounts,
    domain::{account, document::Document, error::AppError},
    infrastructure::catalog,
};
use serde_json::json;

#[test]
fn display_settings_commit_together_only_for_the_named_account() {
    let (mut workspace, disk, host, a, b) = fixture();
    workspace.activate(&a).unwrap();
    let before = workspace.snapshot();
    let calls = host.0.lock().unwrap().calls.clone();
    let writes = disk.0.lock().unwrap().saves;
    let after = workspace
        .update_display(&b, "  Team B  ", 28, "#a1b2c3")
        .unwrap();
    assert_eq!(after.accounts[0], before.accounts[0]);
    let edited = &after.accounts[1];
    assert_eq!(edited.id, b);
    assert_eq!(edited.name, "Team B");
    assert_eq!(edited.font_size, 28);
    assert_eq!(edited.font_color, "#A1B2C3");
    assert_eq!(edited.platform_id, before.accounts[1].platform_id);
    assert_eq!(edited.proxy, before.accounts[1].proxy);
    assert_eq!(edited.website_url, before.accounts[1].website_url);
    assert_eq!(after.active_id, before.active_id);
    assert_eq!(after.opened_ids, before.opened_ids);
    assert_eq!(after.settings, before.settings);
    assert_eq!(host.0.lock().unwrap().calls, calls);
    let disk = disk.0.lock().unwrap();
    assert_eq!(disk.saves, writes + 1);
    assert_eq!(disk.document.as_ref().unwrap().accounts, after.accounts);
}

#[test]
fn failed_display_write_keeps_all_fields_and_native_state_unchanged() {
    let (mut workspace, disk, host, a, b) = fixture();
    workspace.activate(&a).unwrap();
    let before = serde_json::to_value(workspace.snapshot()).unwrap();
    let stored = serde_json::to_value(&disk.0.lock().unwrap().document).unwrap();
    let calls = host.0.lock().unwrap().calls.clone();
    let writes = disk.0.lock().unwrap().saves;
    disk.0.lock().unwrap().fail_save = true;
    assert!(matches!(
        workspace.update_display(&b, "Changed", 10, "#000000"),
        Err(AppError::StoreIo)
    ));
    assert_eq!(serde_json::to_value(workspace.snapshot()).unwrap(), before);
    assert_eq!(
        serde_json::to_value(&disk.0.lock().unwrap().document).unwrap(),
        stored
    );
    assert_eq!(disk.0.lock().unwrap().saves, writes);
    assert_eq!(host.0.lock().unwrap().calls, calls);
    disk.0.lock().unwrap().fail_save = false;
    let saved = workspace
        .update_display(&b, "Changed", 10, "#000000")
        .unwrap();
    assert_eq!(saved.accounts[1].name, "Changed");
    assert_eq!(saved.accounts[1].font_size, 10);
    assert_eq!(saved.accounts[1].font_color, "#000000");
}

#[test]
fn invalid_display_fields_cannot_partially_rename_or_save_an_account() {
    let (mut workspace, disk, host, a, _) = fixture();
    let before = serde_json::to_value(workspace.snapshot()).unwrap();
    let writes = disk.0.lock().unwrap().saves;
    let calls = host.0.lock().unwrap().calls.clone();
    for size in [0, 9, 29, 255] {
        assert!(matches!(
            workspace.update_display(&a, "Must not rename", size, "#ABCDEF"),
            Err(AppError::AppearanceInvalid)
        ));
    }
    for color in [
        "", "red", "#FFF", "#1234567", "#GGGGGG", " #123456", "#123456;", "#12é34",
    ] {
        assert!(matches!(
            workspace.update_display(&a, "Must not rename", 16, color),
            Err(AppError::AppearanceInvalid)
        ));
    }
    for name in ["", "   ", "Bad\nName"] {
        assert!(matches!(
            workspace.update_display(&a, name, 20, "#FFFFFF"),
            Err(AppError::NameInvalid)
        ));
    }
    assert!(matches!(
        workspace.update_display(&a, &"a".repeat(65), 20, "#FFFFFF"),
        Err(AppError::NameInvalid)
    ));
    for id in ["../shell", "00000000-0000-4000-8000-000000000000"] {
        assert!(matches!(
            workspace.update_display(id, "Unknown", 20, "#FFFFFF"),
            Err(AppError::AccountUnknown)
        ));
    }
    assert_eq!(serde_json::to_value(workspace.snapshot()).unwrap(), before);
    assert_eq!(disk.0.lock().unwrap().saves, writes);
    assert_eq!(host.0.lock().unwrap().calls, calls);
}

#[test]
fn unchanged_display_does_not_write_and_legacy_rename_preserves_appearance() {
    let (mut workspace, disk, _, a, _) = fixture();
    workspace
        .update_display(&a, "Styled", 10, "#abcdef")
        .unwrap();
    let writes = disk.0.lock().unwrap().saves;
    disk.0.lock().unwrap().fail_save = true;
    assert!(workspace
        .update_display(&a, " Styled ", 10, "#abcdef")
        .is_ok());
    assert_eq!(disk.0.lock().unwrap().saves, writes);
    disk.0.lock().unwrap().fail_save = false;
    let renamed = workspace.rename(&a, "Compatibility").unwrap();
    assert_eq!(renamed.accounts[0].name, "Compatibility");
    assert_eq!(renamed.accounts[0].font_size, 10);
    assert_eq!(renamed.accounts[0].font_color, "#ABCDEF");
}

#[test]
fn account_wire_defaults_are_bounded_and_invalid_present_fields_fail_closed() {
    let (_, _, _, a, _) = fixture();
    let legacy = json!({"id":a, "name":"Synthetic", "platformId":"whatsapp"});
    let account: account::Account = serde_json::from_value(legacy.clone()).unwrap();
    assert_eq!(account.font_size, 16);
    assert_eq!(account.font_color, "#18A058");
    let wire = serde_json::to_value(account).unwrap();
    assert_eq!(wire["fontSize"], 16);
    assert_eq!(wire["fontColor"], "#18A058");
    for invalid in [json!(-1), json!(16.5), json!(256), json!("16"), json!(null)] {
        let mut record = legacy.clone();
        record["fontSize"] = invalid;
        assert!(serde_json::from_value::<account::Account>(record).is_err());
    }
    for (field, value) in [
        ("fontSize", json!(9)),
        ("fontSize", json!(29)),
        ("fontColor", json!("red")),
    ] {
        let mut record = legacy.clone();
        record[field] = value;
        let document: Document =
            serde_json::from_value(json!({"schemaVersion":4, "accounts":[record]})).unwrap();
        let disk = MemoryRepository::default();
        disk.0.lock().unwrap().document = Some(document);
        assert!(matches!(
            Accounts::open(disk, catalog::load().unwrap()),
            Err(AppError::AppearanceInvalid)
        ));
    }
}
