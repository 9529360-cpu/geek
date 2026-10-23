use super::session_support::*;
use crate::domain::{error::AppError, session::*};
use std::sync::{atomic::Ordering, Arc};

#[test]
fn login_validates_server_identity_and_publishes_only_a_durable_secret_free_snapshot() {
    let (service, repository, transport, _) = setup();
    assert_eq!(service.snapshot().unwrap().state, SessionState::SignedOut);
    transport.authenticated_reply(1, 400);
    let signed_in = service
        .login("  PERSON-1@EXAMPLE.TEST  ", "synthetic-password".into())
        .unwrap();
    assert_eq!(signed_in.state, SessionState::SignedIn);
    assert_eq!(signed_in.user, Some(server_user(1)));
    assert_eq!(signed_in.remaining_chars, Some(400));
    assert!(signed_in.quota_fresh);
    assert_eq!(
        *transport.emails.lock().unwrap(),
        vec!["person-1@example.test"]
    );
    assert_eq!(transport.refresh_calls.load(Ordering::Acquire), 1);
    let document = repository.0.lock().unwrap().document.clone().unwrap();
    let record = document.record.as_ref().unwrap();
    assert_eq!(record.user, server_user(1));
    assert_eq!(record.token.as_str(), "synthetic-session-token-1");
    assert!(!format!("{document:?}").contains("synthetic-session-token-1"));
    let published = serde_json::to_value(&signed_in).unwrap();
    assert!(published.get("token").is_none());
    assert_eq!(published["user"]["accountNo"], server_user(1).account_no);
    assert!(!published.to_string().contains("synthetic-session-token"));
    assert!(!serde_json::to_string(&document)
        .unwrap()
        .contains("synthetic-password"));
    let lease = service.capture_lease().unwrap();
    assert_eq!(service.authoritative_quota(&lease).unwrap(), Some(400));
}

#[test]
fn failed_login_save_keeps_the_previous_identity_and_leases_authoritative() {
    let (service, repository, transport, _) = setup();
    login(&service, &transport, 1, 100);
    let previous = repository.0.lock().unwrap().document.clone();
    let lease = service.capture_lease().unwrap();
    transport.authenticated_reply(2, 200);
    repository.0.lock().unwrap().fail_next = true;
    assert!(matches!(
        service.login(&server_user(2).email, "synthetic-password".into()),
        Err(AppError::SessionPersistence)
    ));
    assert_eq!(repository.0.lock().unwrap().document, previous);
    assert_eq!(service.snapshot().unwrap().user, Some(server_user(1)));
    assert_eq!(
        service.snapshot().unwrap().issue,
        Some(SessionIssue::PersistenceFailed)
    );
    assert!(!lease.cancel.load(Ordering::Acquire));
    service.validate_lease(&lease).unwrap();
    assert_eq!(service.authoritative_quota(&lease).unwrap(), Some(100));
}

#[test]
fn failed_logout_does_not_cancel_a_pending_login_or_claim_the_old_session_was_cleared() {
    let (service, repository, transport, _) = setup();
    login(&service, &transport, 1, 100);
    let old_lease = service.capture_lease().unwrap();
    let gate = Arc::new(Gate::default());
    transport.login_reply(Ok(server_login(2)), Some(Arc::clone(&gate)));
    transport.refresh_reply(Ok(server_refresh(2, 200)), None);
    let worker = service.clone();
    let pending = std::thread::spawn(move || {
        worker.login(&server_user(2).email, "synthetic-password".into())
    });
    gate.entered();
    repository.0.lock().unwrap().fail_next = true;
    assert!(matches!(
        service.logout(),
        Err(AppError::SessionPersistence)
    ));
    assert_eq!(service.snapshot().unwrap().user, Some(server_user(1)));
    service.validate_lease(&old_lease).unwrap();
    gate.release();
    assert_eq!(pending.join().unwrap().unwrap().user, Some(server_user(2)));
    assert!(old_lease.cancel.load(Ordering::Acquire));
}

#[test]
fn successful_logout_is_a_durable_barrier_against_a_late_pending_login() {
    let (service, repository, transport, _) = setup();
    let gate = Arc::new(Gate::default());
    transport.login_reply(Ok(server_login(1)), Some(Arc::clone(&gate)));
    let worker = service.clone();
    let pending = std::thread::spawn(move || {
        worker.login(&server_user(1).email, "synthetic-password".into())
    });
    gate.entered();
    let signed_out = service.logout().unwrap();
    assert_eq!(signed_out.state, SessionState::SignedOut);
    assert!(repository
        .0
        .lock()
        .unwrap()
        .document
        .as_ref()
        .unwrap()
        .record
        .is_none());
    gate.release();
    assert!(matches!(
        pending.join().unwrap(),
        Err(AppError::SessionChanged)
    ));
    assert_eq!(service.snapshot().unwrap(), signed_out);
    assert_eq!(transport.refresh_calls.load(Ordering::Acquire), 0);
}

#[test]
fn a_later_login_wins_even_when_the_first_login_response_arrives_last() {
    let (service, repository, transport, _) = setup();
    let gate = Arc::new(Gate::default());
    transport.login_reply(Ok(server_login(1)), Some(Arc::clone(&gate)));
    let worker = service.clone();
    let first = std::thread::spawn(move || {
        worker.login(&server_user(1).email, "synthetic-password".into())
    });
    gate.entered();
    let accepted = login(&service, &transport, 2, 200);
    gate.release();
    assert!(matches!(
        first.join().unwrap(),
        Err(AppError::SessionChanged)
    ));
    assert_eq!(service.snapshot().unwrap(), accepted);
    assert_eq!(repository.0.lock().unwrap().successful_writes, 1);
}

#[test]
fn a_late_unauthorized_response_cannot_clear_a_newer_session() {
    let (service, _, transport, _) = setup();
    login(&service, &transport, 1, 100);
    let old = service.capture_lease().unwrap();
    let gate = Arc::new(Gate::default());
    transport.refresh_reply(Err(AppError::SessionRequired), Some(Arc::clone(&gate)));
    let worker = service.clone();
    let pending = std::thread::spawn(move || worker.refresh());
    gate.entered();
    let current = login(&service, &transport, 2, 200);
    gate.release();
    assert!(matches!(
        pending.join().unwrap(),
        Err(AppError::SessionChanged)
    ));
    assert!(matches!(
        service.reject_unauthorized(&old),
        Err(AppError::SessionChanged)
    ));
    assert!(matches!(
        service.accept_quota(&old, Some(0)),
        Err(AppError::SessionChanged)
    ));
    assert!(matches!(
        service.accept_quota(&old, None),
        Err(AppError::SessionChanged)
    ));
    assert_eq!(service.snapshot().unwrap(), current);
}

#[test]
fn current_unauthorized_only_clears_identity_after_the_tokenless_record_saves() {
    let (service, repository, transport, _) = setup();
    login(&service, &transport, 1, 100);
    let lease = service.capture_lease().unwrap();
    transport.refresh_reply(Err(AppError::SessionRequired), None);
    let signed_out = service.refresh().unwrap();
    assert_eq!(signed_out.state, SessionState::SignedOut);
    assert_eq!(signed_out.issue, Some(SessionIssue::Unauthorized));
    assert!(lease.cancel.load(Ordering::Acquire));
    assert!(repository
        .0
        .lock()
        .unwrap()
        .document
        .as_ref()
        .unwrap()
        .record
        .is_none());
    assert!(matches!(
        service.capture_lease(),
        Err(AppError::SessionRequired)
    ));
}

#[test]
fn failed_unauthorized_save_preserves_the_record_but_blocks_runtime_authorization() {
    let (service, repository, transport, _) = setup();
    login(&service, &transport, 1, 100);
    let lease = service.capture_lease().unwrap();
    let durable = repository.0.lock().unwrap().document.clone();
    repository.0.lock().unwrap().fail_next = true;
    assert!(matches!(
        service.reject_auth(&lease, AppError::SessionAccountDisabled),
        Err(AppError::SessionPersistence)
    ));
    let blocked = service.snapshot().unwrap();
    assert_eq!(blocked.state, SessionState::SignedIn);
    assert_eq!(blocked.issue, Some(SessionIssue::PersistenceFailed));
    assert!(!blocked.quota_fresh);
    assert_eq!(repository.0.lock().unwrap().document, durable);
    assert!(lease.cancel.load(Ordering::Acquire));
    assert!(matches!(
        service.capture_lease(),
        Err(AppError::SessionRequired)
    ));
    assert!(matches!(
        service.validate_lease(&lease),
        Err(AppError::SessionRequired)
    ));
    assert!(matches!(
        service.accept_quota(&lease, Some(100)),
        Err(AppError::SessionRequired)
    ));
    let recovered = login(&service, &transport, 2, 200);
    assert_eq!(recovered.user, Some(server_user(2)));
    assert!(recovered.quota_fresh);
    service
        .validate_lease(&service.capture_lease().unwrap())
        .unwrap();
}

#[test]
fn a_mismatched_authenticated_profile_cannot_replace_the_previous_session() {
    let (service, repository, transport, _) = setup();
    login(&service, &transport, 1, 100);
    let before = repository.0.lock().unwrap().document.clone();
    transport.login_reply(Ok(server_login(2)), None);
    transport.refresh_reply(Ok(server_refresh(3, 300)), None);
    assert!(matches!(
        service.login(&server_user(2).email, "synthetic-password".into()),
        Err(AppError::NetworkResponseInvalid)
    ));
    assert_eq!(service.snapshot().unwrap().user, Some(server_user(1)));
    assert_eq!(repository.0.lock().unwrap().document, before);
    for token in [
        String::new(),
        "a\nb".into(),
        "非ASCII".into(),
        "x".repeat(8_193),
    ] {
        assert!(matches!(
            SessionToken::new(token),
            Err(AppError::NetworkResponseInvalid)
        ));
    }
}

#[test]
fn network_failure_changes_the_visible_revision_without_replacing_durable_identity() {
    let (service, repository, transport, _) = setup();
    let before = login(&service, &transport, 1, 100);
    let durable = repository.0.lock().unwrap().document.clone();
    transport.refresh_reply(Err(AppError::NetworkUnavailable), None);
    assert!(matches!(
        service.refresh(),
        Err(AppError::NetworkUnavailable)
    ));
    let snapshot = service.snapshot().unwrap();
    assert_eq!(snapshot.issue, Some(SessionIssue::NetworkUnavailable));
    assert!(snapshot.revision > before.revision);
    assert_eq!(snapshot.user, before.user);
    assert_eq!(repository.0.lock().unwrap().document, durable);
}
