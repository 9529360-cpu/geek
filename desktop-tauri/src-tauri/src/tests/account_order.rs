use super::doubles::fixture;
use crate::{application::accounts::Accounts, domain::error::AppError, infrastructure::catalog};
use std::collections::HashSet;

#[test]
fn moving_down_and_up_preserves_other_records_and_live_account_owners() {
    let (mut workspace, disk, host, a, b) = fixture();
    let telegram = workspace
        .create("T", "telegram-z", None, Default::default())
        .unwrap()
        .accounts[2]
        .id
        .clone();
    let archived = workspace
        .create("Archived", "whatsapp", None, Default::default())
        .unwrap()
        .accounts[3]
        .id
        .clone();
    let c = workspace
        .create("C", "whatsapp-pure", None, Default::default())
        .unwrap()
        .accounts[4]
        .id
        .clone();
    workspace.set_archived(&archived, true).unwrap();
    workspace.activate(&b).unwrap();
    workspace.activate(&a).unwrap();
    let before = workspace.snapshot();
    let calls = host.0.lock().unwrap().calls.clone();
    let writes = disk.0.lock().unwrap().saves;

    let down = workspace.move_account(&a, &c).unwrap();
    assert_eq!(
        down.accounts
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        [&b, &telegram, &archived, &c, &a].map(String::as_str)
    );
    assert_eq!(down.active_id, before.active_id);
    assert_eq!(
        down.opened_ids.iter().collect::<HashSet<_>>(),
        before.opened_ids.iter().collect::<HashSet<_>>()
    );
    for previous in &before.accounts {
        assert_eq!(
            down.accounts.iter().find(|item| item.id == previous.id),
            Some(previous)
        );
    }
    assert_eq!(
        disk.0.lock().unwrap().document.as_ref().unwrap().accounts,
        down.accounts
    );
    assert_eq!(host.0.lock().unwrap().calls, calls);

    let up = workspace.move_account(&a, &b).unwrap();
    assert_eq!(up.accounts, before.accounts);
    assert_eq!(up.active_id, before.active_id);
    assert_eq!(up.opened_ids, before.opened_ids);
    assert_eq!(host.0.lock().unwrap().calls, calls);
    assert_eq!(disk.0.lock().unwrap().saves, writes + 2);
}

#[test]
fn invalid_archived_and_cross_family_moves_have_no_effect() {
    let (mut workspace, disk, host, a, b) = fixture();
    let telegram = workspace
        .create("T", "telegram-k", None, Default::default())
        .unwrap()
        .accounts[2]
        .id
        .clone();
    workspace.set_archived(&b, true).unwrap();
    let before = serde_json::to_value(workspace.snapshot()).unwrap();
    let writes = disk.0.lock().unwrap().saves;
    let calls = host.0.lock().unwrap().calls.clone();
    for unknown in ["../shell", "00000000-0000-4000-8000-000000000000"] {
        assert!(matches!(
            workspace.move_account(unknown, &a),
            Err(AppError::AccountUnknown)
        ));
        assert!(matches!(
            workspace.move_account(&a, unknown),
            Err(AppError::AccountUnknown)
        ));
    }
    for (source, target) in [(&a, &b), (&b, &a), (&b, &b)] {
        assert!(matches!(
            workspace.move_account(source, target),
            Err(AppError::AccountArchived)
        ));
    }
    for (source, target) in [(&a, &telegram), (&telegram, &a)] {
        assert!(matches!(
            workspace.move_account(source, target),
            Err(AppError::AccountOrderInvalid)
        ));
    }
    assert_eq!(serde_json::to_value(workspace.snapshot()).unwrap(), before);
    assert_eq!(disk.0.lock().unwrap().saves, writes);
    assert_eq!(host.0.lock().unwrap().calls, calls);
}

#[test]
fn self_move_is_a_noop_even_if_persistence_is_unavailable() {
    let (mut workspace, disk, host, a, _) = fixture();
    let before = serde_json::to_value(workspace.snapshot()).unwrap();
    let writes = disk.0.lock().unwrap().saves;
    let calls = host.0.lock().unwrap().calls.clone();
    disk.0.lock().unwrap().fail_save = true;
    assert!(workspace.move_account(&a, &a).is_ok());
    assert_eq!(serde_json::to_value(workspace.snapshot()).unwrap(), before);
    assert_eq!(disk.0.lock().unwrap().saves, writes);
    assert_eq!(host.0.lock().unwrap().calls, calls);
}

#[test]
fn failed_move_keeps_disk_memory_and_native_state_recoverable() {
    let (mut workspace, disk, host, a, b) = fixture();
    workspace.activate(&a).unwrap();
    let before = serde_json::to_value(workspace.snapshot()).unwrap();
    let stored = serde_json::to_value(&disk.0.lock().unwrap().document).unwrap();
    let writes = disk.0.lock().unwrap().saves;
    let calls = host.0.lock().unwrap().calls.clone();
    disk.0.lock().unwrap().fail_save = true;
    assert!(matches!(
        workspace.move_account(&a, &b),
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
    let after = workspace.move_account(&a, &b).unwrap();
    assert_eq!(
        after
            .accounts
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        [b.as_str(), a.as_str()]
    );
    assert_eq!(after.active_id.as_deref(), Some(a.as_str()));
    assert_eq!(host.0.lock().unwrap().calls, calls);
    let reopened = Accounts::open(disk, catalog::load().unwrap()).unwrap();
    assert_eq!(reopened.accounts(), after.accounts);
}
