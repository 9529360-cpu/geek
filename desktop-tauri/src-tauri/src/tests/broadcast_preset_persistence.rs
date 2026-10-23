use super::broadcast_preset_support::id;
use crate::{
    application::{broadcast_presets::BroadcastPresets, ports::BroadcastPresetRepository},
    domain::{broadcast_presets::BroadcastPresetDocument, error::AppError},
    infrastructure::{
        broadcast_preset_repository::EncryptedBroadcastPresetRepository, dpapi,
        repository::EncryptedRepository,
    },
};
use std::{fs, fs::OpenOptions, os::windows::fs::OpenOptionsExt};

#[test]
fn encrypted_presets_restart_under_the_existing_instance_lock_and_never_touch_live_jobs() {
    let root = tempfile::tempdir().unwrap();
    let _instance = EncryptedRepository::open(root.path().to_path_buf()).unwrap();
    let path = root.path().join("broadcast-presets.dpapi");
    let jobs = root.path().join("broadcast.dpapi");
    fs::write(&jobs, b"synthetic separate live-job file").unwrap();
    let repository = EncryptedBroadcastPresetRepository::open(root.path().to_path_buf()).unwrap();
    let mut owner = BroadcastPresets::open(repository).unwrap();
    assert!(!path.exists());
    owner
        .save_message(&id(1), 0, "SyntheticSecretName", "SyntheticSecretBody")
        .unwrap();
    let a = owner
        .save_audience(
            &id(1),
            1,
            "SyntheticSecretAudience",
            vec!["99887766@c.us".into(), "123-456@g.us".into()],
        )
        .unwrap();
    let b = owner.save_message(&id(2), 0, "Other", "isolated").unwrap();
    let encrypted = fs::read(&path).unwrap();
    for secret in [
        "SyntheticSecretName",
        "SyntheticSecretBody",
        "SyntheticSecretAudience",
        "99887766@c.us",
    ] {
        assert!(!encrypted
            .windows(secret.len())
            .any(|window| window == secret.as_bytes()));
    }
    drop(owner);
    let reopened = BroadcastPresets::open(
        EncryptedBroadcastPresetRepository::open(root.path().to_path_buf()).unwrap(),
    )
    .unwrap();
    assert!(reopened.snapshot(&id(1)).unwrap() == a);
    assert!(reopened.snapshot(&id(2)).unwrap() == b);
    assert!(reopened.audience(&id(1), 2, &a.audiences[0].id).unwrap() == a.audiences[0]);
    assert_eq!(fs::read(path).unwrap(), encrypted);
    assert_eq!(fs::read(jobs).unwrap(), b"synthetic separate live-job file");
    assert!(root.path().join("instance.lock").is_file());
}

#[test]
fn failed_windows_atomic_replace_keeps_the_exact_old_ciphertext_memory_and_revision() {
    let root = tempfile::tempdir().unwrap();
    let mut owner = BroadcastPresets::open(
        EncryptedBroadcastPresetRepository::open(root.path().to_path_buf()).unwrap(),
    )
    .unwrap();
    let before = owner.save_message(&id(1), 0, "Original", "old").unwrap();
    let path = root.path().join("broadcast-presets.dpapi");
    let bytes = fs::read(&path).unwrap();
    // Permit reads, deny write/delete sharing. Atomic replacement must fail
    // against the existing file, without moving that authority out of the way.
    let held = OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&path)
        .unwrap();
    assert!(matches!(
        owner.save_message(&id(1), 1, "Original", "new"),
        Err(AppError::BroadcastPresetPersistence)
    ));
    assert!(owner.snapshot(&id(1)).unwrap() == before);
    assert_eq!(fs::read(&path).unwrap(), bytes);
    drop(held);
    let reopened = BroadcastPresets::open(
        EncryptedBroadcastPresetRepository::open(root.path().to_path_buf()).unwrap(),
    )
    .unwrap();
    assert!(reopened.snapshot(&id(1)).unwrap() == before);
    let retried = owner.save_message(&id(1), 1, "Original", "new").unwrap();
    assert_eq!(retried.revision, 2);
    assert_eq!(retried.messages[0].id, before.messages[0].id);
}

#[test]
fn corrupted_future_or_unrecognized_encrypted_documents_fail_without_reset_or_rewrite() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("broadcast-presets.dpapi");
    let open = || {
        BroadcastPresets::open(
            EncryptedBroadcastPresetRepository::open(root.path().to_path_buf()).unwrap(),
        )
    };
    fs::write(&path, b"corrupt synthetic ciphertext").unwrap();
    assert!(matches!(open(), Err(AppError::BroadcastPresetInvalid)));
    assert_eq!(fs::read(&path).unwrap(), b"corrupt synthetic ciphertext");
    for value in [
        serde_json::json!({"schemaVersion":2,"accounts":[]}),
        serde_json::json!({"schemaVersion":1,"accounts":[],"unexpected":true}),
        serde_json::json!({"schemaVersion":1,"accounts":[{"accountId":id(1),"revision":0,"messages":[],"audiences":[]}]}),
    ] {
        let encrypted = dpapi::encrypt(&serde_json::to_vec(&value).unwrap()).unwrap();
        fs::write(&path, &encrypted[..]).unwrap();
        assert!(matches!(open(), Err(AppError::BroadcastPresetInvalid)));
        assert_eq!(fs::read(&path).unwrap(), encrypted[..]);
    }
}

#[test]
fn repository_rejects_oversized_ciphertext_and_invalid_saves_without_touching_authority() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("broadcast-presets.dpapi");
    let mut repository =
        EncryptedBroadcastPresetRepository::open(root.path().to_path_buf()).unwrap();
    let oversized = vec![1; 2 * 1024 * 1024 + 1];
    fs::write(&path, &oversized).unwrap();
    assert!(matches!(
        repository.load(),
        Err(AppError::BroadcastPresetLimit)
    ));
    assert_eq!(fs::read(&path).unwrap(), oversized);
    let invalid = BroadcastPresetDocument {
        schema_version: 2,
        ..Default::default()
    };
    assert!(matches!(
        repository.save(&invalid),
        Err(AppError::BroadcastPresetInvalid)
    ));
    assert_eq!(fs::read(path).unwrap(), oversized);
}
