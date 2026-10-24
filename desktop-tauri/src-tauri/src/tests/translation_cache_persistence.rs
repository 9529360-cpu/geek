use super::{
    session_support::{server_user, FakeSessionTransport},
    translation_support::{account, incoming, token, translated, FakeGateway, Operation},
};
use crate::{
    application::{
        session::SessionService,
        translation::TranslationService,
        translation_ports::{SystemTranslationCacheClock, TranslationCacheRepository},
    },
    domain::{error::AppError, proxy::ProxyConfig, translation_cache::TranslationCacheDocument},
    infrastructure::{
        dpapi, repository::EncryptedRepository, session_repository::EncryptedSessionRepository,
        translation_cache_repository::EncryptedTranslationCacheRepository,
    },
};
use std::{fs, fs::OpenOptions, os::windows::fs::OpenOptionsExt, path::Path, sync::Arc};
use uuid::Uuid;

type Session = SessionService<EncryptedSessionRepository, FakeSessionTransport>;
type Engine = TranslationService<EncryptedSessionRepository, FakeSessionTransport, FakeGateway>;

fn open_session(root: &Path, auth: &Arc<FakeSessionTransport>) -> Arc<Session> {
    Arc::new(
        Session::open(
            EncryptedSessionRepository::open(root.to_path_buf()).unwrap(),
            Arc::clone(auth),
        )
        .unwrap(),
    )
}

fn engine(root: &Path, session: &Arc<Session>, gateway: &Arc<FakeGateway>) -> Engine {
    Engine::new_with_cache(
        Arc::clone(session),
        Arc::clone(gateway),
        Box::new(EncryptedTranslationCacheRepository::new(root.to_path_buf())),
        Arc::new(SystemTranslationCacheClock),
    )
}

fn signed_in(root: &Path) -> (Arc<Session>, Arc<FakeSessionTransport>) {
    let auth = Arc::new(FakeSessionTransport::default());
    let session = open_session(root, &auth);
    auth.authenticated_reply(1, 100);
    session
        .login(&server_user(1).email, "synthetic-password".into())
        .unwrap();
    (session, auth)
}

#[test]
fn encrypted_receive_result_survives_full_session_restart_but_requires_fresh_quota() {
    let root = tempfile::tempdir().unwrap();
    let _instance = EncryptedRepository::open(root.path().to_path_buf()).unwrap();
    let jobs = root.path().join("broadcast.dpapi");
    let presets = root.path().join("broadcast-presets.dpapi");
    fs::write(&jobs, b"synthetic independent jobs").unwrap();
    fs::write(&presets, b"synthetic independent presets").unwrap();
    let path = root.path().join("translation-cache.dpapi");
    let (session, auth) = signed_in(root.path());
    let old_generation = session.capture_lease().unwrap().generation;
    let gateway = Arc::new(FakeGateway::default());
    let original = engine(root.path(), &session, &gateway);
    assert!(!path.exists());
    let account = account(ProxyConfig::Socks5 {
        host: "synthetic-proxy.example.test".into(),
        port: 1080,
    });
    let message = incoming("persisted-native-result");
    gateway.token_reply(Ok(token("first")), None);
    gateway.translation_reply(Ok(translated("SyntheticSecretTranslation", Some(90))), None);
    let first = original.prepare(account.clone(), message.clone()).unwrap();
    assert_eq!(
        original.execute(&first).unwrap(),
        "SyntheticSecretTranslation"
    );
    let ciphertext = fs::read(&path).unwrap();
    for secret in ["SyntheticSecretTranslation", account.id.as_str()] {
        assert!(!ciphertext
            .windows(secret.len())
            .any(|part| part == secret.as_bytes()));
    }
    drop(original);
    drop(session);

    let session = open_session(root.path(), &auth);
    assert_ne!(session.capture_lease().unwrap().generation, old_generation);
    assert!(!session.snapshot().unwrap().quota_fresh);
    let gateway = Arc::new(FakeGateway::default());
    let restored = engine(root.path(), &session, &gateway);
    let mut new_request = message;
    new_request.id = Uuid::new_v4().to_string();
    let work = restored.prepare(account.clone(), new_request).unwrap();
    assert_ne!(work.incoming.id, first.incoming.id);
    gateway.quota_reply(Ok(0), None);
    assert!(matches!(
        restored.execute(&work),
        Err(AppError::TranslationQuotaExhausted)
    ));
    assert!(gateway.calls(Operation::Token).is_empty());
    assert!(gateway.calls(Operation::Translate).is_empty());

    // A new authenticated positive balance is still mandatory for a disk hit.
    auth.refresh_reply(Ok(super::session_support::server_refresh(1, 80)), None);
    session.refresh().unwrap();
    assert_eq!(
        restored.execute(&work).unwrap(),
        "SyntheticSecretTranslation"
    );
    let quota_calls = gateway.calls(Operation::Quota);
    assert_eq!(quota_calls.len(), 1);
    assert_eq!(quota_calls[0].proxy, account.proxy);
    assert!(gateway.calls(Operation::Token).is_empty());
    assert!(gateway.calls(Operation::Translate).is_empty());
    assert_eq!(session.snapshot().unwrap().remaining_chars, Some(80));
    assert_eq!(fs::read(&path).unwrap(), ciphertext);
    assert_eq!(fs::read(jobs).unwrap(), b"synthetic independent jobs");
    assert_eq!(fs::read(presets).unwrap(), b"synthetic independent presets");
    assert!(root.path().join("instance.lock").is_file());
}

#[test]
fn windows_replace_failure_preserves_old_cache_and_does_not_fail_the_paid_result() {
    let root = tempfile::tempdir().unwrap();
    let (session, _auth) = signed_in(root.path());
    let gateway = Arc::new(FakeGateway::default());
    let translator = engine(root.path(), &session, &gateway);
    let account = account(ProxyConfig::System);
    gateway.token_reply(Ok(token("cache-write")), None);
    gateway.translation_reply(Ok(translated("previous completed result", Some(90))), None);
    let first = translator
        .prepare(account.clone(), incoming("old"))
        .unwrap();
    translator.execute(&first).unwrap();
    let path = root.path().join("translation-cache.dpapi");
    let before = fs::read(&path).unwrap();
    let held = OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&path)
        .unwrap();
    gateway.translation_reply(
        Ok(translated("paid despite unavailable cache", Some(80))),
        None,
    );
    let second = translator.prepare(account, incoming("new")).unwrap();
    assert_eq!(
        translator.execute(&second).unwrap(),
        "paid despite unavailable cache"
    );
    assert_eq!(
        translator.execute(&second).unwrap(),
        "paid despite unavailable cache"
    );
    assert_eq!(gateway.calls(Operation::Translate).len(), 2);
    assert_eq!(session.snapshot().unwrap().remaining_chars, Some(80));
    assert_eq!(fs::read(&path).unwrap(), before);
    drop(held);
    let reloaded = EncryptedTranslationCacheRepository::new(root.path().to_path_buf())
        .load()
        .unwrap()
        .unwrap();
    assert_eq!(reloaded.entries.len(), 1);
    assert_eq!(reloaded.entries[0].text, "previous completed result");
}

#[test]
fn unreadable_or_future_cache_is_preserved_and_cannot_block_authorized_translation() {
    let root = tempfile::tempdir().unwrap();
    let (session, _auth) = signed_in(root.path());
    let path = root.path().join("translation-cache.dpapi");
    let mut examples = vec![b"corrupt synthetic cache ciphertext".to_vec()];
    for value in [
        serde_json::json!({"schemaVersion":2,"entries":[]}),
        serde_json::json!({"schemaVersion":1,"entries":[],"unexpected":true}),
        serde_json::json!({"schemaVersion":1,"entries":"wrong-shape"}),
    ] {
        examples.push(
            dpapi::encrypt(&serde_json::to_vec(&value).unwrap())
                .unwrap()
                .to_vec(),
        );
    }
    for (index, bytes) in examples.into_iter().enumerate() {
        fs::write(&path, &bytes).unwrap();
        let repository = EncryptedTranslationCacheRepository::new(root.path().to_path_buf());
        assert!(repository.load().is_err());
        let gateway = Arc::new(FakeGateway::default());
        let translator = engine(root.path(), &session, &gateway);
        gateway.token_reply(Ok(token("optional-cache")), None);
        gateway.translation_reply(
            Ok(translated("authorized completed result", Some(50))),
            None,
        );
        let work = translator
            .prepare(
                account(ProxyConfig::System),
                incoming(&format!("cache-{index}")),
            )
            .unwrap();
        assert_eq!(
            translator.execute(&work).unwrap(),
            "authorized completed result"
        );
        assert_eq!(
            translator.execute(&work).unwrap(),
            "authorized completed result"
        );
        assert_eq!(gateway.calls(Operation::Translate).len(), 1);
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}

#[test]
fn cache_io_is_bounded_and_invalid_save_never_replaces_the_previous_bytes() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("translation-cache.dpapi");
    let mut repository = EncryptedTranslationCacheRepository::new(root.path().to_path_buf());
    assert!(repository.load().unwrap().is_none());
    assert!(!path.exists());
    let oversized = vec![1; 2 * 1024 * 1024 + 1];
    fs::write(&path, &oversized).unwrap();
    assert!(matches!(repository.load(), Err(AppError::StoreInvalid)));
    let invalid = TranslationCacheDocument {
        schema_version: 2,
        entries: vec![],
    };
    assert!(repository.save(&invalid).is_err());
    assert_eq!(fs::read(&path).unwrap(), oversized);
    let absent = root.path().join("absent");
    let optional = EncryptedTranslationCacheRepository::new(absent.clone());
    assert!(optional.load().unwrap().is_none());
    assert!(!absent.exists());
}
