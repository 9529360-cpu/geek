use super::{broadcast_preset_support::Repository, doubles::MemoryRepository};
use crate::{
    application::{
        account_backup::{restore, RestorationStatus},
        accounts::Accounts,
        broadcast_presets::BroadcastPresets,
    },
    domain::{
        account_backup::{
            BackupAudience, BackupData, BackupMessage, PresetBackup, TranslationBackup,
        },
        error::AppError,
        translation::TranslationPolicy,
    },
    infrastructure::catalog,
};

struct Fixture {
    accounts: Accounts<MemoryRepository>,
    presets: BroadcastPresets<Repository>,
    account_repository: MemoryRepository,
    preset_repository: Repository,
    a: String,
    b: String,
}

fn fixture() -> Fixture {
    let account_repository = MemoryRepository::default();
    let preset_repository = Repository::default();
    let mut accounts =
        Accounts::open(account_repository.clone(), catalog::load().unwrap()).unwrap();
    accounts
        .create("A", "whatsapp", None, Default::default())
        .unwrap();
    accounts
        .create("B", "whatsapp", None, Default::default())
        .unwrap();
    let a = accounts.accounts()[0].id.clone();
    let b = accounts.accounts()[1].id.clone();
    Fixture {
        accounts,
        presets: BroadcastPresets::open(preset_repository.clone()).unwrap(),
        account_repository,
        preset_repository,
        a,
        b,
    }
}

fn backup() -> BackupData {
    BackupData {
        presets: Some(PresetBackup {
            messages: Some(vec![BackupMessage {
                name: "Greeting".into(),
                message: "hello".into(),
            }]),
            audiences: Some(vec![BackupAudience {
                name: "Customers".into(),
                recipient_ids: vec!["12@c.us".into()],
            }]),
            excluded_contact_ids: Some(vec!["34@c.us".into()]),
            excluded_group_ids: Some(vec!["56@g.us".into()]),
        }),
        translation: Some(TranslationBackup {
            global: Some(TranslationPolicy {
                target: "it".into(),
                ..Default::default()
            }),
            chats: Some(Default::default()),
        }),
    }
}

#[test]
fn complete_restore_reports_real_revisions_and_preserves_the_neighbor_account() {
    let mut f = fixture();
    let neighbor = f.accounts.account(&f.b).unwrap();
    let result = restore(&mut f.accounts, &mut f.presets, &f.a, 0, 0, &backup()).unwrap();
    assert_eq!(result.account_id, f.a);
    assert_eq!(result.presets.status, RestorationStatus::Restored);
    assert_eq!(result.translation.status, RestorationStatus::Restored);
    assert_eq!(result.presets.revision, 1);
    assert_eq!(result.translation.revision, 1);
    assert!(result.presets.code.is_none() && result.translation.code.is_none());
    assert_eq!(
        serde_json::to_value(&result).unwrap()["presets"]["status"],
        "restored"
    );
    assert_eq!(f.accounts.account(&f.b).unwrap(), neighbor);
    assert_eq!(f.presets.snapshot(&f.b).unwrap().revision, 0);
    assert_eq!(
        f.presets.snapshot(&f.a).unwrap().excluded_contact_ids,
        vec!["34@c.us"]
    );
    assert_eq!(
        f.presets.snapshot(&f.a).unwrap().excluded_group_ids,
        vec!["56@g.us"]
    );
    assert_eq!(f.preset_repository.0.lock().unwrap().saves, 1);
    assert_eq!(f.account_repository.0.lock().unwrap().saves, 3);
}

#[test]
fn later_translation_failure_keeps_the_saved_presets_and_retry_does_not_rewrite_them() {
    let mut f = fixture();
    f.account_repository.0.lock().unwrap().fail_save = true;
    let partial = restore(&mut f.accounts, &mut f.presets, &f.a, 0, 0, &backup()).unwrap();
    assert_eq!(partial.presets.status, RestorationStatus::Restored);
    assert_eq!(partial.presets.revision, 1);
    assert_eq!(partial.translation.status, RestorationStatus::Failed);
    assert_eq!(partial.translation.code, Some(AppError::StoreIo));
    assert_eq!(partial.translation.revision, 0);
    assert_eq!(
        f.presets.ensure_not_excluded(&f.a, &["34@c.us".into()]),
        Err(AppError::BroadcastExclusionConflict)
    );
    assert_eq!(
        f.presets.snapshot(&f.a).unwrap().messages[0].message,
        "hello"
    );
    assert_eq!(
        f.accounts.account(&f.a).unwrap().translation.global.target,
        "en"
    );
    f.account_repository.0.lock().unwrap().fail_save = false;
    let retry = restore(&mut f.accounts, &mut f.presets, &f.a, 1, 0, &backup()).unwrap();
    assert_eq!(retry.presets.status, RestorationStatus::Unchanged);
    assert_eq!(retry.translation.status, RestorationStatus::Restored);
    assert_eq!(f.preset_repository.0.lock().unwrap().saves, 1);
    assert_eq!(f.account_repository.0.lock().unwrap().saves, 3);
}

#[test]
fn first_preset_failure_does_not_prevent_the_independent_translation_commit() {
    let mut f = fixture();
    f.preset_repository.0.lock().unwrap().fail = true;
    let partial = restore(&mut f.accounts, &mut f.presets, &f.a, 0, 0, &backup()).unwrap();
    assert_eq!(partial.presets.status, RestorationStatus::Failed);
    assert_eq!(
        partial.presets.code,
        Some(AppError::BroadcastPresetPersistence)
    );
    assert_eq!(partial.presets.revision, 0);
    assert!(f
        .presets
        .snapshot(&f.a)
        .unwrap()
        .excluded_contact_ids
        .is_empty());
    assert_eq!(partial.translation.status, RestorationStatus::Restored);
    assert_eq!(partial.translation.revision, 1);
    f.preset_repository.0.lock().unwrap().fail = false;
    let retry = restore(&mut f.accounts, &mut f.presets, &f.a, 0, 1, &backup()).unwrap();
    assert_eq!(retry.presets.status, RestorationStatus::Restored);
    assert_eq!(retry.translation.status, RestorationStatus::Unchanged);
    assert_eq!(f.preset_repository.0.lock().unwrap().saves, 1);
    assert_eq!(f.account_repository.0.lock().unwrap().saves, 3);
}

#[test]
fn both_failures_are_visible_and_the_same_revisions_can_retry_after_reopening() {
    let mut f = fixture();
    f.preset_repository.0.lock().unwrap().fail = true;
    f.account_repository.0.lock().unwrap().fail_save = true;
    let result = restore(&mut f.accounts, &mut f.presets, &f.a, 0, 0, &backup()).unwrap();
    assert_eq!(result.presets.status, RestorationStatus::Failed);
    assert_eq!(result.translation.status, RestorationStatus::Failed);
    assert_eq!(result.presets.revision, 0);
    assert_eq!(result.translation.revision, 0);
    f.preset_repository.0.lock().unwrap().fail = false;
    f.account_repository.0.lock().unwrap().fail_save = false;
    let mut accounts =
        Accounts::open(f.account_repository.clone(), catalog::load().unwrap()).unwrap();
    let mut presets = BroadcastPresets::open(f.preset_repository.clone()).unwrap();
    let retried = restore(&mut accounts, &mut presets, &f.a, 0, 0, &backup()).unwrap();
    assert_eq!(retried.presets.status, RestorationStatus::Restored);
    assert_eq!(retried.translation.status, RestorationStatus::Restored);
    assert_eq!(f.preset_repository.0.lock().unwrap().saves, 1);
    assert_eq!(f.account_repository.0.lock().unwrap().saves, 3);
}

#[test]
fn every_preflight_finishes_before_either_owner_can_persist() {
    let mut f = fixture();
    let before = f.accounts.account(&f.a).unwrap();
    for (preset_revision, translation_revision, data) in [
        (1, 0, backup()),
        (0, 1, backup()),
        (
            0,
            0,
            BackupData {
                presets: Some(PresetBackup {
                    excluded_group_ids: Some(vec!["34@c.us".into()]),
                    ..Default::default()
                }),
                ..backup()
            },
        ),
        (
            0,
            0,
            BackupData {
                translation: Some(TranslationBackup {
                    global: Some(TranslationPolicy {
                        translate_history: true,
                        ..Default::default()
                    }),
                    chats: None,
                }),
                ..backup()
            },
        ),
        (
            0,
            0,
            BackupData {
                presets: Some(PresetBackup {
                    messages: None,
                    audiences: Some(vec![BackupAudience {
                        name: "Foreign".into(),
                        recipient_ids: vec!["tg:42".into()],
                    }]),
                    ..Default::default()
                }),
                ..backup()
            },
        ),
    ] {
        assert!(restore(
            &mut f.accounts,
            &mut f.presets,
            &f.a,
            preset_revision,
            translation_revision,
            &data
        )
        .is_err());
        assert_eq!(f.presets.snapshot(&f.a).unwrap().revision, 0);
        assert_eq!(f.accounts.account(&f.a).unwrap(), before);
        assert_eq!(f.preset_repository.0.lock().unwrap().saves, 0);
        assert_eq!(f.account_repository.0.lock().unwrap().saves, 2);
    }
}

#[test]
fn total_preset_store_limit_is_preflighted_before_an_independent_translation_update() {
    let mut f = fixture();
    let body = "界".repeat(8_000);
    let first_half = PresetBackup {
        messages: Some(
            (0..50)
                .map(|index| BackupMessage {
                    name: format!("N{index}"),
                    message: body.clone(),
                })
                .collect(),
        ),
        audiences: None,
        ..Default::default()
    };
    f.presets.restore(&f.b, 0, &first_half).unwrap();
    let data = BackupData {
        presets: Some(first_half),
        ..backup()
    };
    assert_eq!(
        restore(&mut f.accounts, &mut f.presets, &f.a, 0, 0, &data).unwrap_err(),
        AppError::BroadcastPresetLimit
    );
    assert_eq!(f.presets.snapshot(&f.a).unwrap().revision, 0);
    assert_eq!(f.accounts.account(&f.a).unwrap().translation.revision, 0);
    assert_eq!(f.preset_repository.0.lock().unwrap().saves, 1);
    assert_eq!(f.account_repository.0.lock().unwrap().saves, 2);
}

#[test]
fn missing_section_is_not_attempted_and_its_unused_revision_cannot_block_the_other_section() {
    let mut f = fixture();
    let data = BackupData {
        presets: None,
        ..backup()
    };
    let result = restore(&mut f.accounts, &mut f.presets, &f.a, 999, 0, &data).unwrap();
    assert_eq!(result.presets.status, RestorationStatus::NotAttempted);
    assert_eq!(result.presets.revision, 0);
    assert_eq!(result.translation.status, RestorationStatus::Restored);
    let data = BackupData {
        translation: None,
        ..backup()
    };
    let result = restore(&mut f.accounts, &mut f.presets, &f.a, 0, 999, &data).unwrap();
    assert_eq!(result.translation.status, RestorationStatus::NotAttempted);
    assert_eq!(result.translation.revision, 1);
    assert_eq!(result.presets.status, RestorationStatus::Restored);
    assert_eq!(
        restore(
            &mut f.accounts,
            &mut f.presets,
            &f.a,
            1,
            1,
            &BackupData::default()
        )
        .unwrap_err(),
        AppError::BackupInvalid
    );
}

#[test]
fn repeated_current_restore_is_noop_but_stale_or_archived_restore_never_writes() {
    let mut f = fixture();
    restore(&mut f.accounts, &mut f.presets, &f.a, 0, 0, &backup()).unwrap();
    f.preset_repository.0.lock().unwrap().fail = true;
    f.account_repository.0.lock().unwrap().fail_save = true;
    let noop = restore(&mut f.accounts, &mut f.presets, &f.a, 1, 1, &backup()).unwrap();
    assert_eq!(noop.presets.status, RestorationStatus::Unchanged);
    assert_eq!(noop.translation.status, RestorationStatus::Unchanged);
    assert_eq!(
        restore(&mut f.accounts, &mut f.presets, &f.a, 0, 1, &backup()).unwrap_err(),
        AppError::BroadcastPresetConflict
    );
    assert_eq!(
        restore(&mut f.accounts, &mut f.presets, &f.a, 1, 0, &backup()).unwrap_err(),
        AppError::TranslationSettingsConflict
    );
    f.account_repository.0.lock().unwrap().fail_save = false;
    f.accounts.set_archived(&f.a, true).unwrap();
    assert_eq!(
        restore(&mut f.accounts, &mut f.presets, &f.a, 1, 1, &backup()).unwrap_err(),
        AppError::AccountArchived
    );
    assert_eq!(f.preset_repository.0.lock().unwrap().saves, 1);
    assert_eq!(f.account_repository.0.lock().unwrap().saves, 4);
}
