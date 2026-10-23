use super::session_support::{server_login, server_refresh, FakeSessionTransport};
use crate::{
    application::{session::SessionService, session_ports::SessionRepository},
    domain::{
        error::AppError,
        session::{SessionDocument, SessionState},
    },
    infrastructure::{
        dpapi, repository::EncryptedRepository, session_repository::EncryptedSessionRepository,
    },
};
use std::{fs, sync::Arc};

#[test]
fn session_dpapi_restart_hides_the_token_and_does_not_restore_quota_authority() {
    let root = tempfile::tempdir().unwrap();
    let _owner = EncryptedRepository::open(root.path().to_path_buf()).unwrap();
    let transport = Arc::new(FakeSessionTransport::default());
    transport.login_reply(Ok(server_login(1)), None);
    transport.refresh_reply(Ok(server_refresh(1, 100)), None);
    let service = SessionService::open(
        EncryptedSessionRepository::open(root.path().to_path_buf()).unwrap(),
        Arc::clone(&transport),
    )
    .unwrap();
    service
        .login("person-1@example.test", "synthetic-password".into())
        .unwrap();
    let encrypted = fs::read(root.path().join("session.dpapi")).unwrap();
    for secret in [
        b"synthetic-session-token-1".as_slice(),
        b"synthetic-password".as_slice(),
    ] {
        assert!(!encrypted.windows(secret.len()).any(|part| part == secret));
    }
    drop(service);
    let reopened = SessionService::open(
        EncryptedSessionRepository::open(root.path().to_path_buf()).unwrap(),
        transport,
    )
    .unwrap();
    let snapshot = reopened.snapshot().unwrap();
    assert_eq!(snapshot.state, SessionState::SignedIn);
    assert_eq!(snapshot.remaining_chars, Some(100));
    assert!(!snapshot.quota_fresh);
    let lease = reopened.capture_lease().unwrap();
    assert_eq!(reopened.authoritative_quota(&lease).unwrap(), None);
    reopened.logout().unwrap();
    let cleared = EncryptedSessionRepository::open(root.path().to_path_buf())
        .unwrap()
        .load()
        .unwrap()
        .unwrap();
    assert!(cleared.record.is_none());
    assert!(root.path().join("instance.lock").is_file());
}

#[test]
fn atomic_session_replace_failure_preserves_the_prior_ciphertext() {
    let root = tempfile::tempdir().unwrap();
    let mut repository = EncryptedSessionRepository::open(root.path().to_path_buf()).unwrap();
    repository.save(&SessionDocument::default()).unwrap();
    let path = root.path().join("session.dpapi");
    let backup = root.path().join("synthetic-previous-session");
    let original = fs::read(&path).unwrap();
    fs::rename(&path, &backup).unwrap();
    fs::create_dir(&path).unwrap();
    let candidate = SessionDocument {
        revision: 1,
        ..SessionDocument::default()
    };
    assert!(repository.save(&candidate).is_err());
    assert_eq!(fs::read(&backup).unwrap(), original);
    fs::remove_dir(&path).unwrap();
    fs::rename(&backup, &path).unwrap();
    assert_eq!(repository.load().unwrap(), Some(SessionDocument::default()));
}

#[test]
fn corrupt_or_future_session_files_fail_closed_without_erasing_credentials() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("session.dpapi");
    fs::write(&path, b"synthetic-invalid-ciphertext").unwrap();
    let repository = EncryptedSessionRepository::open(root.path().to_path_buf()).unwrap();
    assert!(repository.load().is_err());
    assert_eq!(fs::read(&path).unwrap(), b"synthetic-invalid-ciphertext");
    let future = SessionDocument {
        schema_version: 2,
        ..SessionDocument::default()
    };
    let encrypted = dpapi::encrypt(&serde_json::to_vec(&future).unwrap()).unwrap();
    fs::write(&path, &encrypted[..]).unwrap();
    assert!(matches!(repository.load(), Err(AppError::StoreVersion)));
    assert_eq!(fs::read(path).unwrap(), encrypted[..]);
}
