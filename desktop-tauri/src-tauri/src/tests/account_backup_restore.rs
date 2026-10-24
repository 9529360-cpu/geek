use super::{
    broadcast_preset_support::{id, Repository},
    doubles::MemoryRepository,
};
use crate::{
    application::{accounts::Accounts, broadcast_presets::BroadcastPresets},
    domain::{
        account_backup::{BackupAudience, BackupMessage, PresetBackup, TranslationBackup},
        error::AppError,
        translation::{ChatTranslationPolicy, TranslationPolicy},
    },
    infrastructure::catalog,
};

fn text_backup(message: &str) -> PresetBackup {
    PresetBackup {
        messages: Some(vec![BackupMessage {
            name: "Greeting".into(),
            message: message.into(),
        }]),
        audiences: None,
    }
}

fn translation_backup(target: &str) -> TranslationBackup {
    TranslationBackup {
        global: Some(TranslationPolicy {
            target: target.into(),
            ..Default::default()
        }),
        chats: Some(
            [(
                "12@c.us".into(),
                ChatTranslationPolicy::from_policy(&TranslationPolicy {
                    target: "es".into(),
                    ..Default::default()
                }),
            )]
            .into_iter()
            .collect(),
        ),
    }
}

fn accounts() -> (Accounts<MemoryRepository>, MemoryRepository, String, String) {
    let repository = MemoryRepository::default();
    let mut owner = Accounts::open(repository.clone(), catalog::load().unwrap()).unwrap();
    owner
        .create("Target A", "whatsapp", None, Default::default())
        .unwrap();
    owner
        .create("Neighbor B", "whatsapp", None, Default::default())
        .unwrap();
    let a = owner.accounts()[0].id.clone();
    let b = owner.accounts()[1].id.clone();
    (owner, repository, a, b)
}

#[test]
fn preset_restore_is_one_commit_preserves_missing_components_and_local_message_identity() {
    let repository = Repository::default();
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    let first = owner.save_message(&id(1), 0, "Greeting", "old").unwrap();
    let before = owner
        .save_audience(&id(1), 1, "Customers", vec!["12@c.us".into()])
        .unwrap();
    let neighbor = owner.save_message(&id(2), 0, "Other", "keep").unwrap();
    let saves = repository.0.lock().unwrap().saves;
    owner
        .validate_restore(&id(1), 2, &text_backup("new"))
        .unwrap();
    assert!(owner.snapshot(&id(1)).unwrap() == before);
    assert_eq!(repository.0.lock().unwrap().saves, saves);
    let restored = owner.restore(&id(1), 2, &text_backup("new")).unwrap();
    assert_eq!(restored.revision, 3);
    assert_eq!(restored.messages[0].id, first.messages[0].id);
    assert_eq!(restored.messages[0].message, "new");
    assert!(restored.audiences == before.audiences);
    assert!(owner.snapshot(&id(2)).unwrap() == neighbor);
    assert_eq!(repository.0.lock().unwrap().saves, saves + 1);
    assert!(
        BroadcastPresets::open(repository)
            .unwrap()
            .snapshot(&id(1))
            .unwrap()
            == restored
    );
}

#[test]
fn preset_cas_precedes_noop_and_disk_failure_does_not_change_revision_or_memory() {
    let repository = Repository::default();
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    let original = owner.restore(&id(1), 0, &text_backup("one")).unwrap();
    repository.0.lock().unwrap().fail = true;
    let saves = repository.0.lock().unwrap().saves;
    assert!(owner.restore(&id(1), 1, &text_backup("one")).unwrap() == original);
    assert!(matches!(
        owner.restore(&id(1), 0, &text_backup("one")),
        Err(AppError::BroadcastPresetConflict)
    ));
    assert!(matches!(
        owner.validate_restore(&id(1), 0, &text_backup("one")),
        Err(AppError::BroadcastPresetConflict)
    ));
    assert!(matches!(
        owner.restore(&id(1), 1, &text_backup("two")),
        Err(AppError::BroadcastPresetPersistence)
    ));
    assert!(owner.snapshot(&id(1)).unwrap() == original);
    assert_eq!(repository.0.lock().unwrap().saves, saves);
    assert!(
        BroadcastPresets::open(repository.clone())
            .unwrap()
            .snapshot(&id(1))
            .unwrap()
            == original
    );
    repository.0.lock().unwrap().fail = false;
    let retried = owner.restore(&id(1), 1, &text_backup("two")).unwrap();
    assert_eq!(retried.revision, 2);
    assert_eq!(retried.messages[0].message, "two");
}

#[test]
fn duplicate_audience_rows_keep_distinct_local_ids_and_explicit_clear_retains_revision() {
    let repository = Repository::default();
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    let audience = BackupAudience {
        name: "Customers".into(),
        recipient_ids: vec!["12@c.us".into()],
    };
    let backup = PresetBackup {
        messages: None,
        audiences: Some(vec![audience.clone(), audience]),
    };
    let restored = owner.restore(&id(1), 0, &backup).unwrap();
    assert_ne!(restored.audiences[0].id, restored.audiences[1].id);
    let saves = repository.0.lock().unwrap().saves;
    assert!(owner.restore(&id(1), 1, &backup).unwrap() == restored);
    assert_eq!(repository.0.lock().unwrap().saves, saves);
    let clear = PresetBackup {
        messages: Some(Vec::new()),
        audiences: Some(Vec::new()),
    };
    let empty = owner.restore(&id(1), 1, &clear).unwrap();
    assert_eq!(empty.revision, 2);
    assert!(empty.messages.is_empty() && empty.audiences.is_empty());
    let mut reopened = BroadcastPresets::open(repository).unwrap();
    assert!(reopened.snapshot(&id(1)).unwrap() == empty);
    assert!(matches!(
        reopened.restore(&id(1), 0, &backup),
        Err(AppError::BroadcastPresetConflict)
    ));
}

#[test]
fn invalid_preset_section_preflight_and_restore_leave_both_accounts_unchanged() {
    let repository = Repository::default();
    let mut owner = BroadcastPresets::open(repository.clone()).unwrap();
    let before = owner.restore(&id(1), 0, &text_backup("current")).unwrap();
    let neighbor = owner.restore(&id(2), 0, &text_backup("neighbor")).unwrap();
    let saves = repository.0.lock().unwrap().saves;
    for invalid in [
        PresetBackup::default(),
        PresetBackup {
            messages: Some(vec![BackupMessage {
                name: "X".into(),
                message: "".into(),
            }]),
            audiences: None,
        },
        PresetBackup {
            messages: None,
            audiences: Some(vec![BackupAudience {
                name: "X".into(),
                recipient_ids: vec!["12@c.us".into(), "12@c.us".into()],
            }]),
        },
        PresetBackup {
            messages: Some(
                (0..101)
                    .map(|index| BackupMessage {
                        name: format!("M{index}"),
                        message: "hello".into(),
                    })
                    .collect(),
            ),
            audiences: None,
        },
    ] {
        assert!(owner.validate_restore(&id(1), 1, &invalid).is_err());
        assert!(owner.restore(&id(1), 1, &invalid).is_err());
        assert!(owner.snapshot(&id(1)).unwrap() == before);
        assert!(owner.snapshot(&id(2)).unwrap() == neighbor);
        assert_eq!(repository.0.lock().unwrap().saves, saves);
    }
}

#[test]
fn global_and_chat_restore_share_one_accounts_commit_without_changing_neighbor_or_identity() {
    let (mut owner, repository, a, b) = accounts();
    let before = owner.account(&a).unwrap();
    let neighbor = owner.account(&b).unwrap();
    let saves = repository.0.lock().unwrap().saves;
    let backup = translation_backup("it");
    owner.validate_restore_translation(&a, 0, &backup).unwrap();
    assert_eq!(owner.account(&a).unwrap(), before);
    assert_eq!(repository.0.lock().unwrap().saves, saves);
    owner.restore_translation(&a, 0, &backup).unwrap();
    let restored = owner.account(&a).unwrap();
    assert_eq!(restored.translation.revision, 1);
    assert_eq!(restored.translation.global.target, "it");
    assert_eq!(restored.translation.chats["12@c.us"].target, "es");
    let mut expected = before;
    expected.translation = restored.translation.clone();
    assert_eq!(restored, expected);
    assert_eq!(owner.account(&b).unwrap(), neighbor);
    assert_eq!(repository.0.lock().unwrap().saves, saves + 1);
    assert_eq!(
        Accounts::open(repository, catalog::load().unwrap())
            .unwrap()
            .account(&a)
            .unwrap(),
        restored
    );
}

#[test]
fn translation_missing_component_preserves_current_values_and_empty_map_clears_only_overrides() {
    let (mut owner, _, a, _) = accounts();
    owner
        .restore_translation(&a, 0, &translation_backup("it"))
        .unwrap();
    let before = owner.account(&a).unwrap().translation;
    let global_only = TranslationBackup {
        global: Some(TranslationPolicy {
            target: "fr".into(),
            ..Default::default()
        }),
        chats: None,
    };
    owner.restore_translation(&a, 1, &global_only).unwrap();
    let changed = owner.account(&a).unwrap().translation;
    assert_eq!(changed.revision, 2);
    assert_eq!(changed.global.target, "fr");
    assert_eq!(changed.chats, before.chats);
    owner
        .restore_translation(
            &a,
            2,
            &TranslationBackup {
                global: None,
                chats: Some(Default::default()),
            },
        )
        .unwrap();
    let cleared = owner.account(&a).unwrap().translation;
    assert_eq!(cleared.revision, 3);
    assert_eq!(cleared.global, changed.global);
    assert!(cleared.chats.is_empty());
}

#[test]
fn translation_restore_failure_is_atomic_and_noop_or_conflict_never_requires_disk() {
    let (mut owner, repository, a, _) = accounts();
    let backup = translation_backup("it");
    owner.restore_translation(&a, 0, &backup).unwrap();
    let before = owner.account(&a).unwrap();
    let saves = repository.0.lock().unwrap().saves;
    repository.0.lock().unwrap().fail_save = true;
    owner.restore_translation(&a, 1, &backup).unwrap();
    assert_eq!(
        owner.restore_translation(&a, 0, &backup).unwrap_err(),
        AppError::TranslationSettingsConflict
    );
    assert_eq!(
        owner
            .validate_restore_translation(&a, 0, &backup)
            .unwrap_err(),
        AppError::TranslationSettingsConflict
    );
    assert_eq!(
        owner
            .restore_translation(&a, 1, &translation_backup("fr"))
            .unwrap_err(),
        AppError::StoreIo
    );
    assert_eq!(owner.account(&a).unwrap(), before);
    assert_eq!(repository.0.lock().unwrap().saves, saves);
    assert_eq!(
        Accounts::open(repository.clone(), catalog::load().unwrap())
            .unwrap()
            .account(&a)
            .unwrap(),
        before
    );
    repository.0.lock().unwrap().fail_save = false;
    owner
        .restore_translation(&a, 1, &translation_backup("fr"))
        .unwrap();
    assert_eq!(owner.account(&a).unwrap().translation.revision, 2);
}

#[test]
fn translation_restore_rejects_archived_accounts_cross_platform_chats_and_unsupported_policy() {
    let (mut owner, repository, a, _) = accounts();
    let before = owner.account(&a).unwrap();
    let saves = repository.0.lock().unwrap().saves;
    for invalid in [
        TranslationBackup::default(),
        TranslationBackup {
            global: Some(TranslationPolicy {
                translate_history: true,
                ..Default::default()
            }),
            chats: None,
        },
        TranslationBackup {
            global: None,
            chats: Some(
                [(
                    "tg:42".into(),
                    ChatTranslationPolicy::from_policy(&TranslationPolicy::default()),
                )]
                .into_iter()
                .collect(),
            ),
        },
    ] {
        assert!(owner.validate_restore_translation(&a, 0, &invalid).is_err());
        assert!(owner.restore_translation(&a, 0, &invalid).is_err());
        assert_eq!(owner.account(&a).unwrap(), before);
        assert_eq!(repository.0.lock().unwrap().saves, saves);
    }
    owner.set_archived(&a, true).unwrap();
    assert_eq!(
        owner
            .restore_translation(&a, 0, &translation_backup("it"))
            .unwrap_err(),
        AppError::AccountArchived
    );
}
