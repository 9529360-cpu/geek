use super::broadcast_support::{account, draft, FakePlatform, NOW};
use crate::{
    application::{broadcast::BroadcastService, ports::BroadcastRepository},
    domain::{broadcast::BroadcastDocument, error::AppError},
    infrastructure::{
        broadcast_attachment_source::NativeAttachmentIo,
        broadcast_repository::EncryptedBroadcastRepository, dpapi, repository::EncryptedRepository,
    },
};
use std::{fs, sync::Arc};

#[test]
fn broadcast_dpapi_restart_shares_instance_owner_without_exposing_message_plaintext() {
    let root = tempfile::tempdir().unwrap();
    let _account_owner = EncryptedRepository::open(root.path().to_path_buf()).unwrap();
    let repository = EncryptedBroadcastRepository::open(root.path().to_path_buf()).unwrap();
    let platform = Arc::new(FakePlatform::default());
    let service = BroadcastService::open_at(repository, Arc::clone(&platform), NOW).unwrap();
    let owner = account("Encrypted synthetic owner");
    let mut input = draft(&owner, 1);
    input.message = "ConfidentialSyntheticMessage".into();
    input.scheduled_at = Some(NOW + 100_000);
    let source_path = root.path().join("native-private-source.txt");
    fs::write(&source_path, b"Synthetic attachment content").unwrap();
    input.attachments = service
        .register_attachments(
            &owner.id,
            std::slice::from_ref(&source_path),
            false,
            &NativeAttachmentIo,
            &|| Ok(()),
        )
        .unwrap();
    let expected = service.submit(owner, input, NOW).unwrap();
    let bytes = fs::read(root.path().join("broadcast.dpapi")).unwrap();
    assert!(!bytes
        .windows(b"ConfidentialSyntheticMessage".len())
        .any(|value| value == b"ConfidentialSyntheticMessage"));
    assert!(!bytes
        .windows(b"native-private-source.txt".len())
        .any(|value| value == b"native-private-source.txt"));
    drop(service);
    // Reopening the feature store works while the original process lock is held.
    let reopened = BroadcastService::open_at(
        EncryptedBroadcastRepository::open(root.path().to_path_buf()).unwrap(),
        platform,
        NOW + 1,
    )
    .unwrap();
    assert_eq!(reopened.list().unwrap(), vec![expected]);
    assert!(source_path.is_file());
    assert!(root.path().join("instance.lock").is_file());
}

#[test]
fn failed_atomic_replace_preserves_the_previous_broadcast_document() {
    let root = tempfile::tempdir().unwrap();
    let mut repository = EncryptedBroadcastRepository::open(root.path().to_path_buf()).unwrap();
    repository.save(&BroadcastDocument::default()).unwrap();
    let path = root.path().join("broadcast.dpapi");
    let backup = root.path().join("synthetic-previous");
    let before = fs::read(&path).unwrap();
    fs::rename(&path, &backup).unwrap();
    fs::create_dir(&path).unwrap();
    let candidate = BroadcastDocument {
        revision: 1,
        ..BroadcastDocument::default()
    };
    assert!(repository.save(&candidate).is_err());
    assert_eq!(fs::read(&backup).unwrap(), before);
    fs::remove_dir(&path).unwrap();
    fs::rename(&backup, &path).unwrap();
    assert_eq!(
        repository.load().unwrap().unwrap(),
        BroadcastDocument::default()
    );
}

#[test]
fn damaged_or_future_broadcast_store_is_never_silently_reset() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("broadcast.dpapi");
    fs::write(&path, b"corrupt synthetic ciphertext").unwrap();
    let open = || {
        BroadcastService::open_at(
            EncryptedBroadcastRepository::open(root.path().to_path_buf()).unwrap(),
            Arc::new(FakePlatform::default()),
            NOW,
        )
    };
    assert!(open().is_err());
    assert_eq!(fs::read(&path).unwrap(), b"corrupt synthetic ciphertext");
    let future = BroadcastDocument {
        schema_version: 3,
        ..BroadcastDocument::default()
    };
    let encrypted = dpapi::encrypt(&serde_json::to_vec(&future).unwrap()).unwrap();
    fs::write(&path, &encrypted[..]).unwrap();
    assert!(matches!(open(), Err(AppError::StoreVersion)));
    assert_eq!(fs::read(path).unwrap(), encrypted[..]);
}
