use super::broadcast_support::*;
use crate::domain::broadcast::*;
use std::{
    sync::{mpsc, Arc},
    time::Duration,
};

fn hold_worker_exit(service: &Service) -> (mpsc::Receiver<()>, mpsc::SyncSender<()>) {
    let (arrived, waiting) = mpsc::sync_channel(1);
    let (release, released) = mpsc::sync_channel(1);
    *service.before_worker_exit.lock().unwrap() = Some(Box::new(move || {
        arrived.send(()).unwrap();
        released
            .recv_timeout(Duration::from_secs(5))
            .expect("test did not release the settled worker");
    }));
    (waiting, release)
}

#[test]
fn stop_after_settlement_releases_the_account_when_the_worker_exits() {
    let (service, _, platform) = setup();
    let owner = account("Late stop");
    let first = service
        .submit(owner.clone(), draft(&owner, 2), NOW)
        .unwrap();
    let next = service
        .submit(owner.clone(), draft(&owner, 1), NOW + 1)
        .unwrap();
    let (waiting, release) = hold_worker_exit(&service);
    service.tick(NOW + 2).unwrap();
    waiting.recv_timeout(Duration::from_secs(5)).unwrap();
    let settled = job(&service, &first.id);
    assert_eq!((settled.current, settled.ok), (1, 1));
    assert!(settled.checkpoint.is_none());
    assert_eq!(settled.state, BroadcastState::Running);
    assert_eq!(
        service
            .control(&first.id, BroadcastAction::Stop, NOW + 3)
            .unwrap()
            .state,
        BroadcastState::Stopping
    );
    assert_eq!(service.tick(NOW + 50_000).unwrap(), 0);
    release.send(()).unwrap();
    idle(&service);
    let stopped = job(&service, &first.id);
    assert_eq!((stopped.state, stopped.ok), (BroadcastState::Stopped, 1));
    assert_eq!(service.tick(NOW + 50_001).unwrap(), 1);
    idle(&service);
    assert_eq!(job(&service, &next.id).state, BroadcastState::Completed);
    let calls = platform.calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].request.job_id, first.id);
    assert_eq!(calls[1].request.job_id, next.id);
}

#[test]
fn invalidation_after_scheduled_prepare_failure_cannot_leave_a_stopping_owner() {
    let (service, _, platform) = setup();
    let owner = account("Late invalidation");
    platform
        .unavailable
        .lock()
        .unwrap()
        .insert(owner.id.clone());
    let mut input = draft(&owner, 1);
    input.scheduled_at = Some(NOW + 100);
    let first = service.submit(owner.clone(), input, NOW).unwrap();
    let (waiting, release) = hold_worker_exit(&service);
    service.tick(NOW + 100).unwrap();
    waiting.recv_timeout(Duration::from_secs(5)).unwrap();
    let prepared = job(&service, &first.id);
    assert_eq!(prepared.prepare_attempts, 1);
    assert_eq!(prepared.state, BroadcastState::Queued);
    service.invalidate_account(&owner.id, NOW + 101).unwrap();
    assert_eq!(job(&service, &first.id).state, BroadcastState::Stopping);
    release.send(()).unwrap();
    idle(&service);
    let stopped = job(&service, &first.id);
    assert_eq!(stopped.state, BroadcastState::Stopped);
    assert_eq!(stopped.last_issue, Some(BroadcastIssue::GuestChanged));
    assert_eq!((stopped.current, stopped.uncertain), (0, 0));
    assert_eq!(service.tick(NOW + 100_000).unwrap(), 0);
    platform.unavailable.lock().unwrap().clear();
    let next = service
        .submit(owner.clone(), draft(&owner, 1), NOW + 100_001)
        .unwrap();
    assert_eq!(service.tick(NOW + 100_002).unwrap(), 1);
    idle(&service);
    assert_eq!(job(&service, &next.id).ok, 1);
    assert_eq!(platform.calls.lock().unwrap().len(), 1);
}

#[test]
fn failed_late_stop_finalization_blocks_until_recovery_without_replaying_receipt() {
    let (service, repository, platform) = setup();
    let owner = account("Late stop persistence");
    let first = service
        .submit(owner.clone(), draft(&owner, 2), NOW)
        .unwrap();
    let next = service
        .submit(owner.clone(), draft(&owner, 1), NOW + 1)
        .unwrap();
    let (waiting, release) = hold_worker_exit(&service);
    service.tick(NOW + 2).unwrap();
    waiting.recv_timeout(Duration::from_secs(5)).unwrap();
    service
        .control(&first.id, BroadcastAction::Stop, NOW + 3)
        .unwrap();
    let before = service.snapshot().unwrap();
    repository.0.lock().unwrap().fail_at = Some(FailAt::Any);
    release.send(()).unwrap();
    idle(&service);
    let blocked = job(&service, &first.id);
    assert!(blocked.storage_blocked);
    assert_eq!(blocked.state, BroadcastState::Stopping);
    assert_eq!((blocked.current, blocked.ok, blocked.uncertain), (1, 1, 0));
    assert!(blocked.checkpoint.is_none());
    assert_eq!(service.snapshot().unwrap().revision, before.revision);
    assert_eq!(service.tick(NOW + 100_000).unwrap(), 0);
    service.shutdown().unwrap();
    let reopened = Service::open_at(repository, Arc::clone(&platform), NOW + 100_001).unwrap();
    let recovered = job(&reopened, &first.id);
    assert_eq!(recovered.state, BroadcastState::Stopped);
    assert_eq!(
        (recovered.current, recovered.ok, recovered.uncertain),
        (1, 1, 0)
    );
    assert_eq!(reopened.tick(NOW + 100_002).unwrap(), 0);
    reopened
        .control(&next.id, BroadcastAction::Resume, NOW + 100_003)
        .unwrap();
    assert_eq!(reopened.tick(NOW + 100_004).unwrap(), 1);
    idle(&reopened);
    let calls = platform.calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].request.job_id, first.id);
    assert_eq!(calls[1].request.job_id, next.id);
}

#[test]
fn failed_stop_finalization_can_finish_stopping_without_resuming_remaining_targets() {
    let (service, repository, platform) = setup();
    let owner = account("Explicit stop recovery");
    let first = service
        .submit(owner.clone(), draft(&owner, 2), NOW)
        .unwrap();
    let next = service
        .submit(owner.clone(), draft(&owner, 1), NOW + 1)
        .unwrap();
    let (waiting, release) = hold_worker_exit(&service);
    service.tick(NOW + 2).unwrap();
    waiting.recv_timeout(Duration::from_secs(5)).unwrap();
    service
        .control(&first.id, BroadcastAction::Stop, NOW + 3)
        .unwrap();
    repository.0.lock().unwrap().fail_at = Some(FailAt::Any);
    release.send(()).unwrap();
    idle(&service);
    assert!(job(&service, &first.id).storage_blocked);
    let stopped = service
        .control(&first.id, BroadcastAction::Stop, NOW + 4)
        .unwrap();
    assert_eq!(stopped.state, BroadcastState::Stopped);
    assert!(!stopped.storage_blocked);
    assert_eq!((stopped.current, stopped.ok, stopped.uncertain), (1, 1, 0));
    assert_eq!(service.tick(NOW + 5).unwrap(), 1);
    idle(&service);
    let calls = platform.calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].request.job_id, first.id);
    assert_eq!(calls[1].request.job_id, next.id);
    assert_eq!(job(&service, &first.id).state, BroadcastState::Stopped);
}
