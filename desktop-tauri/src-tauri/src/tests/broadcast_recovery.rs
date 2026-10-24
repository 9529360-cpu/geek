use super::broadcast_support::*;
use crate::domain::{broadcast::*, error::AppError};
use std::sync::Arc;

#[test]
fn rejected_creation_and_control_never_publish_undurable_state() {
    let (service, repository, _) = setup();
    let owner = account("Atomic");
    let input = draft(&owner, 1);
    repository.0.lock().unwrap().fail_at = Some(FailAt::Any);
    assert!(matches!(
        service.submit(owner.clone(), input.clone(), NOW),
        Err(AppError::BroadcastPersistence)
    ));
    assert!(service.snapshot().unwrap().jobs.is_empty());
    assert_eq!(service.snapshot().unwrap().revision, 0);
    let item = service.submit(owner.clone(), input.clone(), NOW).unwrap();
    let before = service.snapshot().unwrap();
    let writes = repository.0.lock().unwrap().successful_writes;
    assert_eq!(
        service
            .submit(owner.clone(), input.clone(), NOW + 1)
            .unwrap(),
        item
    );
    assert_eq!(repository.0.lock().unwrap().successful_writes, writes);
    let mut changed = input;
    changed.message = "Different content".into();
    assert!(matches!(
        service.submit(owner, changed, NOW + 2),
        Err(AppError::BroadcastConflict)
    ));
    repository.0.lock().unwrap().fail_at = Some(FailAt::Any);
    assert!(matches!(
        service.control(&item.id, BroadcastAction::Stop, NOW + 3),
        Err(AppError::BroadcastPersistence)
    ));
    assert_eq!(service.snapshot().unwrap().jobs, before.jobs);
    assert_eq!(service.snapshot().unwrap().revision, before.revision);
}

#[test]
fn dispatch_checkpoint_failure_performs_zero_native_sends_and_stays_blocked() {
    let (service, repository, platform) = setup();
    let owner = account("Gate");
    let item = service
        .submit(owner.clone(), draft(&owner, 1), NOW)
        .unwrap();
    repository.0.lock().unwrap().fail_at = Some(FailAt::Enter);
    service.tick(NOW).unwrap();
    idle(&service);
    assert!(platform.calls.lock().unwrap().is_empty());
    assert_eq!(*platform.commits.lock().unwrap(), 0);
    assert!(job(&service, &item.id).storage_blocked);
    assert_eq!(service.tick(NOW + 10_000).unwrap(), 0);
    let reopened = Service::open_at(repository, Arc::clone(&platform), NOW + 20_000).unwrap();
    let restored = job(&reopened, &item.id);
    assert_eq!(restored.state, BroadcastState::Paused);
    assert_eq!((restored.current, restored.uncertain), (0, 0));
    assert!(restored.review_required);
}

#[test]
fn lost_settlement_keeps_durable_uncertainty_and_restart_skips_that_target() {
    let (service, repository, platform) = setup();
    let owner = account("Checkpoint");
    let item = service
        .submit(owner.clone(), draft(&owner, 2), NOW)
        .unwrap();
    repository.0.lock().unwrap().fail_at = Some(FailAt::Settle);
    service.tick(NOW).unwrap();
    idle(&service);
    let durable = repository.0.lock().unwrap().document.clone().unwrap();
    assert_eq!(durable.jobs[0].current, 0);
    assert!(durable.jobs[0].checkpoint.is_some());
    assert!(job(&service, &item.id).storage_blocked);
    assert_eq!(service.tick(NOW + 10_000).unwrap(), 0);
    assert_eq!(*platform.commits.lock().unwrap(), 1);
    service.shutdown().unwrap();
    let reopened = Service::open_at(repository, Arc::clone(&platform), NOW + 20_000).unwrap();
    let restored = job(&reopened, &item.id);
    assert_eq!(
        (restored.current, restored.ok, restored.uncertain),
        (1, 0, 1)
    );
    assert_eq!(
        restored.last_issue,
        Some(BroadcastIssue::InterruptedUncertain)
    );
    assert_eq!(reopened.tick(NOW + 30_000).unwrap(), 0);
    reopened
        .control(&item.id, BroadcastAction::Resume, NOW + 30_001)
        .unwrap();
    reopened.tick(NOW + 30_002).unwrap();
    idle(&reopened);
    let calls = platform.calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[1].request.target_id, "synthetic-1@c.us");
    assert_eq!(
        (
            job(&reopened, &item.id).ok,
            job(&reopened, &item.id).uncertain
        ),
        (1, 1)
    );
}

#[test]
fn pending_schedule_survives_restart_but_immediate_queue_requires_resume() {
    let (service, repository, platform) = setup();
    let owner = account("Schedule");
    let later = account("Later");
    let mut scheduled = draft(&owner, 1);
    scheduled.scheduled_at = Some(NOW + 10_000);
    let scheduled = service.submit(owner, scheduled, NOW).unwrap();
    let immediate = service
        .submit(later.clone(), draft(&later, 1), NOW + 1)
        .unwrap();
    let reopened = Service::open_at(repository, Arc::clone(&platform), NOW + 2).unwrap();
    assert_eq!(reopened.tick(NOW + 9_999).unwrap(), 0);
    assert_eq!(reopened.tick(NOW + 10_000).unwrap(), 1);
    idle(&reopened);
    assert_eq!(
        job(&reopened, &scheduled.id).state,
        BroadcastState::Completed
    );
    assert!(job(&reopened, &immediate.id).review_required);
    assert_eq!(reopened.tick(NOW + 20_000).unwrap(), 0);
    reopened
        .control(&immediate.id, BroadcastAction::Resume, NOW + 20_001)
        .unwrap();
    assert_eq!(reopened.tick(NOW + 20_002).unwrap(), 1);
    idle(&reopened);
    assert_eq!(job(&reopened, &immediate.id).ok, 1);
}

#[test]
fn scheduled_readiness_is_bounded_and_never_retries_a_send() {
    let (service, _, platform) = setup();
    let owner = account("Unavailable");
    platform
        .unavailable
        .lock()
        .unwrap()
        .insert(owner.id.clone());
    let mut input = draft(&owner, 1);
    input.scheduled_at = Some(NOW + 100);
    let item = service.submit(owner, input, NOW).unwrap();
    let mut clock = NOW + 100;
    for index in 1..=MAX_PREPARE_ATTEMPTS {
        assert_eq!(service.tick(clock).unwrap(), 1);
        idle(&service);
        let current = job(&service, &item.id);
        assert_eq!(current.prepare_attempts, index);
        if index < MAX_PREPARE_ATTEMPTS {
            let next = current.next_send_at.unwrap();
            assert_eq!(service.tick(next - 1).unwrap(), 0);
            clock = next;
        }
    }
    let failed = job(&service, &item.id);
    assert_eq!(failed.state, BroadcastState::Failed);
    assert_eq!(
        failed.last_issue,
        Some(BroadcastIssue::ScheduleAccountUnavailable)
    );
    assert!(platform.calls.lock().unwrap().is_empty());
    assert_eq!(platform.acquired.lock().unwrap().len(), 20);
}

#[test]
fn cancelled_schedule_stays_cancelled_and_corrupt_progress_never_resets() {
    let (service, repository, platform) = setup();
    let owner = account("Cancellation");
    let mut input = draft(&owner, 1);
    input.scheduled_at = Some(NOW + 1_000);
    let item = service.submit(owner, input, NOW).unwrap();
    service
        .control(&item.id, BroadcastAction::Stop, NOW + 1)
        .unwrap();
    let reopened =
        Service::open_at(repository.clone(), Arc::clone(&platform), NOW + 2_000).unwrap();
    assert_eq!(reopened.tick(NOW + 2_001).unwrap(), 0);
    assert_eq!(job(&reopened, &item.id).state, BroadcastState::Stopped);
    let mut state = repository.0.lock().unwrap();
    state.document.as_mut().unwrap().jobs[0].current = 99;
    let before = state.document.clone();
    drop(state);
    assert!(matches!(
        Service::open_at(repository.clone(), platform, NOW + 3_000),
        Err(AppError::StoreInvalid)
    ));
    assert_eq!(repository.0.lock().unwrap().document, before);
}

#[test]
fn failing_the_stop_write_keeps_the_live_executor_and_account_slot_authoritative() {
    let (service, repository, platform) = setup();
    let owner = account("Stop rollback");
    let item = service
        .submit(owner.clone(), draft(&owner, 1), NOW)
        .unwrap();
    let next = service
        .submit(owner.clone(), draft(&owner, 1), NOW + 1)
        .unwrap();
    let gate = Arc::new(Gate::default());
    *platform.before_commit.lock().unwrap() = Some(Arc::clone(&gate));
    service.tick(NOW + 2).unwrap();
    platform.await_calls(1);
    repository.0.lock().unwrap().fail_at = Some(FailAt::Any);
    assert!(matches!(
        service.control(&item.id, BroadcastAction::Stop, NOW + 3),
        Err(AppError::BroadcastPersistence)
    ));
    assert_eq!(job(&service, &item.id).state, BroadcastState::Running);
    assert_eq!(job(&service, &next.id).state, BroadcastState::Queued);
    assert_eq!(service.tick(NOW + 50_000).unwrap(), 0);
    gate.release();
    idle(&service);
    assert_eq!(job(&service, &item.id).ok, 1);
    assert_eq!(*platform.commits.lock().unwrap(), 1);
}

#[test]
fn an_oversized_document_is_rejected_without_saving_or_discarding_history() {
    let (service, repository, _) = setup();
    let owner = account("Bounded store");
    let first = service
        .submit(owner.clone(), draft(&owner, 1), NOW)
        .unwrap();
    let before = service.snapshot().unwrap();
    let writes = repository.0.lock().unwrap().successful_writes;
    let mut input = draft(&owner, MAX_TARGETS);
    for target in &mut input.targets {
        target.name = "n".repeat(512);
        target.real_name = "r".repeat(512);
    }
    assert!(matches!(
        service.submit(owner, input, NOW + 1),
        Err(AppError::BroadcastLimit)
    ));
    assert_eq!(service.snapshot().unwrap().jobs, vec![first]);
    assert_eq!(service.snapshot().unwrap().revision, before.revision);
    assert_eq!(repository.0.lock().unwrap().successful_writes, writes);
}
