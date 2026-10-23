use super::session_support::*;
use crate::domain::{error::AppError, session::*};
use std::sync::{atomic::Ordering, Arc, Barrier};

#[test]
fn restart_keeps_a_quota_mirror_but_never_restores_authority() {
    let (service, repository, transport, clock) = setup();
    login(&service, &transport, 1, 100);
    let original = service.capture_lease().unwrap();
    let reopened = Service::open_with_clock(repository, Arc::clone(&transport), clock).unwrap();
    let snapshot = reopened.snapshot().unwrap();
    assert_eq!(snapshot.state, SessionState::SignedIn);
    assert_eq!(snapshot.remaining_chars, Some(100));
    assert!(!snapshot.quota_fresh);
    let lease = reopened.capture_lease().unwrap();
    assert_ne!(lease.generation, original.generation);
    assert_eq!(reopened.authoritative_quota(&lease).unwrap(), None);
    assert_eq!(transport.refresh_calls.load(Ordering::Acquire), 1);
    let refreshed = reopened.accept_quota(&lease, Some(80)).unwrap();
    assert!(refreshed.quota_fresh);
    assert_eq!(refreshed.remaining_chars, Some(80));
    assert!(refreshed.revision > snapshot.revision);
}

#[test]
fn explicit_refresh_recovers_a_fresh_zero_balance_without_clock_advance() {
    let (service, repository, transport, clock) = setup();
    login(&service, &transport, 1, 100);
    let lease = service.capture_lease().unwrap();
    service.accept_quota(&lease, Some(0)).unwrap();
    assert_eq!(service.authoritative_quota(&lease).unwrap(), Some(0));
    transport.refresh_reply(Ok(server_refresh(1, 80)), None);

    let refreshed = service.refresh().unwrap();
    assert_eq!(refreshed.remaining_chars, Some(80));
    assert!(refreshed.quota_fresh);
    assert_eq!(service.authoritative_quota(&lease).unwrap(), Some(80));
    assert_eq!(clock.0.load(Ordering::Acquire), NOW);
    assert_eq!(
        repository
            .0
            .lock()
            .unwrap()
            .document
            .as_ref()
            .unwrap()
            .record
            .as_ref()
            .unwrap()
            .remaining_chars,
        Some(80)
    );
}

#[test]
fn a_refresh_in_flight_cannot_undo_paid_same_value_null_invalid_or_aba_updates() {
    for observations in [
        vec![Some(0)],
        vec![Some(30)],
        vec![Some(100)],
        vec![None],
        vec![Some(u64::MAX)],
        vec![None, Some(100)],
    ] {
        let (service, repository, transport, clock) = setup();
        login(&service, &transport, 1, 100);
        let lease = service.capture_lease().unwrap();
        let gate = Arc::new(Gate::default());
        transport.refresh_reply(Ok(server_refresh(1, 180)), Some(Arc::clone(&gate)));
        let worker = service.clone();
        let pending = std::thread::spawn(move || worker.refresh());
        gate.entered();

        let outcomes = observations
            .iter()
            .map(|value| service.accept_quota(&lease, *value))
            .collect::<Vec<_>>();
        let current = service.snapshot().unwrap();
        let durable = repository.0.lock().unwrap().document.clone();
        let writes = repository.0.lock().unwrap().successful_writes;
        gate.release();
        let late = pending.join().unwrap().unwrap();

        for (observation, outcome) in observations.iter().zip(outcomes) {
            if *observation == Some(u64::MAX) {
                assert_eq!(outcome, Err(AppError::NetworkResponseInvalid));
            } else {
                assert!(outcome.is_ok());
            }
        }
        assert_eq!(late, current, "observations={observations:?}");
        assert_eq!(service.snapshot().unwrap(), current);
        assert_eq!(repository.0.lock().unwrap().document, durable);
        assert_eq!(repository.0.lock().unwrap().successful_writes, writes);
        assert_eq!(clock.0.load(Ordering::Acquire), NOW);
    }
}

#[test]
fn an_accepted_refresh_fences_older_refreshes_even_when_the_balance_did_not_change() {
    for new_balance in [0, 80] {
        let (service, repository, transport, _) = setup();
        login(&service, &transport, 1, 100);
        let lease = service.capture_lease().unwrap();
        service.accept_quota(&lease, Some(0)).unwrap();
        let gate = Arc::new(Gate::default());
        transport.refresh_reply(Ok(server_refresh(1, 200)), Some(Arc::clone(&gate)));
        let worker = service.clone();
        let pending = std::thread::spawn(move || worker.refresh());
        gate.entered();

        transport.refresh_reply(Ok(server_refresh(1, new_balance)), None);
        let current = service.refresh().unwrap();
        let writes = repository.0.lock().unwrap().successful_writes;
        gate.release();
        let late = pending.join().unwrap().unwrap();

        assert_eq!(current.remaining_chars, Some(new_balance));
        assert_eq!(late, current);
        assert_eq!(
            service.authoritative_quota(&lease).unwrap(),
            Some(new_balance)
        );
        assert_eq!(repository.0.lock().unwrap().successful_writes, writes);
    }
}

#[test]
fn current_identity_denial_is_still_authoritative_after_a_concurrent_quota_update() {
    for reason in [AppError::SessionRequired, AppError::SessionAccountDisabled] {
        let (service, repository, transport, _) = setup();
        login(&service, &transport, 1, 100);
        let lease = service.capture_lease().unwrap();
        let gate = Arc::new(Gate::default());
        transport.refresh_reply(Err(reason), Some(Arc::clone(&gate)));
        let worker = service.clone();
        let pending = std::thread::spawn(move || worker.refresh());
        gate.entered();
        service.accept_quota(&lease, Some(60)).unwrap();
        gate.release();

        let rejected = pending.join().unwrap().unwrap();
        assert_eq!(rejected.state, SessionState::SignedOut);
        assert!(!rejected.quota_fresh);
        assert!(lease.cancel.load(Ordering::Acquire));
        assert!(matches!(
            service.capture_lease(),
            Err(AppError::SessionRequired)
        ));
        assert!(repository
            .0
            .lock()
            .unwrap()
            .document
            .as_ref()
            .unwrap()
            .record
            .is_none());
    }
}

#[test]
fn a_replenishment_mirror_failure_keeps_authority_and_fences_an_older_refresh() {
    let (service, repository, transport, _) = setup();
    login(&service, &transport, 1, 100);
    let lease = service.capture_lease().unwrap();
    service.accept_quota(&lease, Some(0)).unwrap();
    let durable = repository.0.lock().unwrap().document.clone();
    let gate = Arc::new(Gate::default());
    transport.refresh_reply(Ok(server_refresh(1, 120)), Some(Arc::clone(&gate)));
    let worker = service.clone();
    let pending = std::thread::spawn(move || worker.refresh());
    gate.entered();

    transport.refresh_reply(Ok(server_refresh(1, 80)), None);
    repository.0.lock().unwrap().fail_next = true;
    let accepted = service.refresh().unwrap();
    gate.release();
    let late = pending.join().unwrap().unwrap();

    assert_eq!(accepted.remaining_chars, Some(80));
    assert!(accepted.quota_fresh);
    assert_eq!(accepted.issue, Some(SessionIssue::PersistenceFailed));
    assert_eq!(late, accepted);
    assert_eq!(service.authoritative_quota(&lease).unwrap(), Some(80));
    assert_eq!(repository.0.lock().unwrap().document, durable);

    transport.refresh_reply(Ok(server_refresh(1, 80)), None);
    let saved = service.refresh().unwrap();
    assert_eq!(saved.remaining_chars, Some(80));
    assert_eq!(saved.issue, None);
    assert_eq!(
        repository
            .0
            .lock()
            .unwrap()
            .document
            .as_ref()
            .unwrap()
            .record
            .as_ref()
            .unwrap()
            .remaining_chars,
        Some(80)
    );
}

#[test]
fn authority_expires_at_thirty_seconds_and_cannot_revive_after_clock_rollback() {
    let (service, _, transport, clock) = setup();
    let initial = login(&service, &transport, 1, 100);
    let lease = service.capture_lease().unwrap();
    clock.set(NOW + QUOTA_AUTHORITY_TTL_MS - 1);
    assert_eq!(service.authoritative_quota(&lease).unwrap(), Some(100));
    clock.set(NOW + QUOTA_AUTHORITY_TTL_MS);
    let expired = service.snapshot().unwrap();
    assert!(!expired.quota_fresh);
    assert_eq!(expired.remaining_chars, Some(100));
    assert!(expired.revision > initial.revision);
    clock.set(NOW + 1);
    assert_eq!(service.authoritative_quota(&lease).unwrap(), None);
    service.accept_quota(&lease, Some(90)).unwrap();
    clock.set(NOW);
    assert_eq!(service.authoritative_quota(&lease).unwrap(), None);
    assert_eq!(transport.refresh_calls.load(Ordering::Acquire), 1);
}

#[test]
fn concurrent_quota_results_in_the_same_generation_never_raise_the_current_balance() {
    let (service, repository, transport, _) = setup();
    login(&service, &transport, 1, 100);
    let lease = service.capture_lease().unwrap();
    let start = Arc::new(Barrier::new(3));
    let mut workers = Vec::new();
    for value in [70, 30] {
        let worker = service.clone();
        let lease = lease.clone();
        let start = Arc::clone(&start);
        workers.push(std::thread::spawn(move || {
            start.wait();
            worker.accept_quota(&lease, Some(value))
        }));
    }
    start.wait();
    for worker in workers {
        worker.join().unwrap().unwrap();
    }
    assert_eq!(service.authoritative_quota(&lease).unwrap(), Some(30));
    assert_eq!(
        service
            .accept_quota(&lease, Some(90))
            .unwrap()
            .remaining_chars,
        Some(30)
    );
    assert_eq!(
        repository
            .0
            .lock()
            .unwrap()
            .document
            .as_ref()
            .unwrap()
            .record
            .as_ref()
            .unwrap()
            .remaining_chars,
        Some(30)
    );
}

#[test]
fn null_revokes_authority_without_becoming_zero_or_an_unlimited_allowance() {
    let (service, _, transport, _) = setup();
    let before = login(&service, &transport, 1, 100);
    let lease = service.capture_lease().unwrap();
    let unknown = service.accept_quota(&lease, None).unwrap();
    assert_eq!(unknown.remaining_chars, Some(100));
    assert!(!unknown.quota_fresh);
    assert!(unknown.revision > before.revision);
    assert_eq!(service.authoritative_quota(&lease).unwrap(), None);
    let exhausted = service.accept_quota(&lease, Some(0)).unwrap();
    assert_eq!(exhausted.remaining_chars, Some(0));
    assert!(exhausted.quota_fresh);
    assert_eq!(service.authoritative_quota(&lease).unwrap(), Some(0));
}

#[test]
fn a_failed_quota_mirror_write_cannot_turn_a_paid_success_into_a_retry_error() {
    let (service, repository, transport, _) = setup();
    let before = login(&service, &transport, 1, 100);
    let lease = service.capture_lease().unwrap();
    let durable = repository.0.lock().unwrap().document.clone();
    repository.0.lock().unwrap().fail_next = true;
    let accepted = service.accept_quota(&lease, Some(60)).unwrap();
    assert_eq!(accepted.remaining_chars, Some(60));
    assert!(accepted.quota_fresh);
    assert_eq!(accepted.issue, Some(SessionIssue::PersistenceFailed));
    assert!(accepted.revision > before.revision);
    assert_eq!(repository.0.lock().unwrap().document, durable);
    assert_eq!(service.authoritative_quota(&lease).unwrap(), Some(60));
    let saved = service.accept_quota(&lease, Some(60)).unwrap();
    assert_eq!(saved.issue, None);
    assert!(saved.revision > accepted.revision);
    assert_eq!(transport.refresh_calls.load(Ordering::Acquire), 1);
}
