use super::broadcast_support::*;
use crate::domain::broadcast::*;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use uuid::Uuid;

#[test]
fn blocked_native_work_allows_other_accounts_but_never_the_same_account() {
    let (service, _, platform) = setup();
    let a = account("A");
    let b = account("B");
    let first = service.submit(a.clone(), draft(&a, 2), NOW).unwrap();
    let second = service.submit(a.clone(), draft(&a, 1), NOW + 1).unwrap();
    let other = service.submit(b.clone(), draft(&b, 1), NOW + 2).unwrap();
    let gate = Arc::new(Gate::default());
    *platform.after_commit.lock().unwrap() = Some(Arc::clone(&gate));
    assert_eq!(service.tick(NOW + 3).unwrap(), 2);
    platform.await_commits(2);
    assert_eq!(job(&service, &second.id).state, BroadcastState::Queued);
    assert_eq!(service.tick(NOW + 50_000).unwrap(), 0);
    let calls = platform.calls.lock().unwrap().clone();
    assert_eq!(calls.len(), 2);
    assert!(calls.iter().any(|call| call.binding.account_id == a.id));
    assert!(calls.iter().any(|call| call.binding.account_id == b.id));
    // A snapshot and control operation complete while both external sends block.
    service
        .control(&first.id, BroadcastAction::Pause, NOW + 4)
        .unwrap();
    gate.release();
    idle(&service);
    assert_eq!(job(&service, &first.id).state, BroadcastState::Paused);
    assert_eq!(job(&service, &other.id).state, BroadcastState::Completed);
    assert_eq!(service.tick(NOW + 60_000).unwrap(), 0);
    service
        .control(&first.id, BroadcastAction::Resume, NOW + 60_001)
        .unwrap();
    assert_eq!(service.tick(NOW + 60_002).unwrap(), 1);
    idle(&service);
    assert_eq!(job(&service, &first.id).state, BroadcastState::Completed);
    assert_eq!(service.tick(NOW + 60_003).unwrap(), 1);
    idle(&service);
    assert_eq!(job(&service, &second.id).state, BroadcastState::Completed);
    let for_a: Vec<_> = platform
        .calls
        .lock()
        .unwrap()
        .iter()
        .filter(|call| call.binding.account_id == a.id)
        .map(|call| call.request.job_id.clone())
        .collect();
    assert_eq!(for_a, vec![first.id.clone(), first.id, second.id]);
}

#[test]
fn global_concurrency_is_bounded_to_four_without_serializing_accounts() {
    let (service, _, platform) = setup();
    for index in 0..5 {
        let owner = account(&format!("Account {index}"));
        service
            .submit(owner.clone(), draft(&owner, 1), NOW + index)
            .unwrap();
    }
    let gate = Arc::new(Gate::default());
    *platform.after_commit.lock().unwrap() = Some(Arc::clone(&gate));
    assert_eq!(service.tick(NOW + 5).unwrap(), MAX_WORKERS);
    platform.await_commits(4);
    assert_eq!(service.tick(NOW + 100).unwrap(), 0);
    assert_eq!(platform.calls.lock().unwrap().len(), 4);
    gate.release();
    idle(&service);
    assert_eq!(service.tick(NOW + 101).unwrap(), 1);
    idle(&service);
    assert!(service
        .list()
        .unwrap()
        .iter()
        .all(|job| job.state == BroadcastState::Completed));
}

#[test]
fn pause_before_commit_cancels_that_attempt_without_skipping_its_target() {
    let (service, _, platform) = setup();
    let owner = account("Pause");
    let item = service
        .submit(owner.clone(), draft(&owner, 1), NOW)
        .unwrap();
    let gate = Arc::new(Gate::default());
    *platform.before_commit.lock().unwrap() = Some(Arc::clone(&gate));
    service.tick(NOW).unwrap();
    platform.await_calls(1);
    service
        .control(&item.id, BroadcastAction::Pause, NOW + 1)
        .unwrap();
    gate.release();
    idle(&service);
    let paused = job(&service, &item.id);
    assert_eq!(
        (paused.current, paused.ok, paused.fail, paused.uncertain),
        (0, 0, 0, 0)
    );
    assert!(paused.checkpoint.is_none());
    assert!(paused.prepared.is_some());
    assert_eq!(*platform.commits.lock().unwrap(), 0);
    platform.hour.store(19, Ordering::Release);
    service
        .control(&item.id, BroadcastAction::Resume, NOW + 2)
        .unwrap();
    service.tick(NOW + 3).unwrap();
    idle(&service);
    assert_eq!(job(&service, &item.id).ok, 1);
    assert_eq!(*platform.commits.lock().unwrap(), 1);
    let calls = platform.calls.lock().unwrap();
    assert_eq!(calls[0].request.target_id, calls[1].request.target_id);
    assert_ne!(calls[0].request.attempt_id, calls[1].request.attempt_id);
    assert_eq!(
        calls[0].request.rendered_text,
        calls[1].request.rendered_text
    );
}

#[test]
fn stop_during_submission_keeps_its_slot_until_the_receipt_settles() {
    let (service, _, platform) = setup();
    let owner = account("Stop");
    let first = service
        .submit(owner.clone(), draft(&owner, 2), NOW)
        .unwrap();
    let next = service
        .submit(owner.clone(), draft(&owner, 1), NOW + 1)
        .unwrap();
    let gate = Arc::new(Gate::default());
    *platform.after_commit.lock().unwrap() = Some(Arc::clone(&gate));
    service.tick(NOW + 2).unwrap();
    platform.await_commits(1);
    let stopping = service
        .control(&first.id, BroadcastAction::Stop, NOW + 3)
        .unwrap();
    assert_eq!(stopping.state, BroadcastState::Stopping);
    assert_eq!(service.tick(NOW + 10_000).unwrap(), 0);
    gate.release();
    idle(&service);
    let stopped = job(&service, &first.id);
    assert_eq!(
        (stopped.state, stopped.current, stopped.ok),
        (BroadcastState::Stopped, 1, 1)
    );
    assert_eq!(service.tick(NOW + 10_001).unwrap(), 1);
    idle(&service);
    assert_eq!(job(&service, &next.id).ok, 1);
    assert_eq!(
        platform
            .calls
            .lock()
            .unwrap()
            .iter()
            .filter(|call| call.request.job_id == first.id)
            .count(),
        1
    );
}

#[test]
fn binding_stays_frozen_across_targets_and_personalization_uses_its_local_hour() {
    let (service, _, platform) = setup();
    let owner = account("Identity");
    let mut input = draft(&owner, 2);
    input.tag_all = true;
    input.vcards.push(BroadcastVcard {
        id: "card@c.us".into(),
        name: "Card".into(),
    });
    let item = service.submit(owner.clone(), input, NOW).unwrap();
    service.tick(NOW).unwrap();
    idle(&service);
    let next = job(&service, &item.id).next_send_at.unwrap();
    assert_eq!(service.tick(next - 1).unwrap(), 0);
    *platform.generation.lock().unwrap() = Uuid::new_v4().to_string();
    service.tick(next).unwrap();
    idle(&service);
    let calls = platform.calls.lock().unwrap();
    assert_eq!(calls[0].binding, calls[1].binding);
    assert_eq!(platform.acquired.lock().unwrap().len(), 1);
    assert_eq!(
        calls[0].request.rendered_text,
        "Hello Person 0 / Real 0 / 下午好"
    );
    assert_eq!(
        calls[1].request.rendered_text,
        "Hello Person 1 / Real 1 / 下午好"
    );
    assert!(calls
        .iter()
        .all(|call| call.request.tag_all && call.request.vcards[0].name == "Card"));
}

#[test]
fn uncertain_submission_stops_until_explicit_resume_and_is_never_replayed() {
    let (service, _, platform) = setup();
    let owner = account("Uncertain");
    let item = service
        .submit(owner.clone(), draft(&owner, 2), NOW)
        .unwrap();
    *platform.outcome.lock().unwrap() = Some(DispatchOutcome::Uncertain {
        code: BroadcastIssue::TimedOut,
    });
    service.tick(NOW).unwrap();
    idle(&service);
    let paused = job(&service, &item.id);
    assert_eq!(
        (paused.state, paused.current, paused.uncertain),
        (BroadcastState::Paused, 1, 1)
    );
    assert!(paused.review_required);
    assert_eq!(service.tick(NOW + 100_000).unwrap(), 0);
    *platform.outcome.lock().unwrap() = None;
    service
        .control(&item.id, BroadcastAction::Resume, NOW + 101_000)
        .unwrap();
    service.tick(NOW + 101_001).unwrap();
    idle(&service);
    let calls = platform.calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[1].request.target_id, "synthetic-1@c.us");
    assert_eq!(job(&service, &item.id).uncertain, 1);
}

#[test]
fn changed_generation_pauses_the_job_instead_of_failing_every_remaining_target() {
    let (service, _, platform) = setup();
    platform.enforce_generation.store(true, Ordering::Release);
    let owner = account("Generation");
    let item = service
        .submit(owner.clone(), draft(&owner, 3), NOW)
        .unwrap();
    service.tick(NOW).unwrap();
    idle(&service);
    let next = job(&service, &item.id).next_send_at.unwrap();
    *platform.generation.lock().unwrap() = Uuid::new_v4().to_string();
    service.tick(next).unwrap();
    idle(&service);
    let paused = job(&service, &item.id);
    assert_eq!(paused.state, BroadcastState::Paused);
    assert!(paused.review_required);
    assert_eq!(paused.last_issue, Some(BroadcastIssue::GuestChanged));
    assert_eq!(*platform.commits.lock().unwrap(), 1);
    assert_eq!(service.tick(next + 100_000).unwrap(), 0);
    assert_eq!(platform.calls.lock().unwrap().len(), 2);
}

#[test]
fn cancelling_a_due_schedule_before_native_commit_prevents_the_send() {
    let (service, _, platform) = setup();
    let owner = account("Due cancellation");
    let mut input = draft(&owner, 2);
    input.scheduled_at = Some(NOW + 100);
    let item = service.submit(owner, input, NOW).unwrap();
    let gate = Arc::new(Gate::default());
    *platform.before_commit.lock().unwrap() = Some(Arc::clone(&gate));
    service.tick(NOW + 100).unwrap();
    platform.await_calls(1);
    service
        .control(&item.id, BroadcastAction::Stop, NOW + 101)
        .unwrap();
    gate.release();
    idle(&service);
    let stopped = job(&service, &item.id);
    assert_eq!(
        (stopped.state, stopped.current),
        (BroadcastState::Stopped, 0)
    );
    assert_eq!(*platform.commits.lock().unwrap(), 0);
    assert_eq!(service.tick(NOW + 100_000).unwrap(), 0);
}

#[test]
fn a_post_commit_not_submitted_claim_is_treated_as_uncertain() {
    let (service, _, platform) = setup();
    let owner = account("Defensive outcome");
    let item = service
        .submit(owner.clone(), draft(&owner, 2), NOW)
        .unwrap();
    *platform.outcome.lock().unwrap() = Some(DispatchOutcome::NotSubmitted {
        code: BroadcastIssue::TimedOut,
    });
    service.tick(NOW).unwrap();
    idle(&service);
    let current = job(&service, &item.id);
    assert_eq!(
        (current.uncertain, current.fail, current.state),
        (1, 0, BroadcastState::Paused)
    );
    assert_eq!(service.tick(NOW + 100_000).unwrap(), 0);
}

#[test]
fn readiness_loss_after_a_success_pauses_without_consuming_the_next_target() {
    let (service, _, platform) = setup();
    let owner = account("Readiness loss");
    let item = service
        .submit(owner.clone(), draft(&owner, 2), NOW)
        .unwrap();
    service.tick(NOW).unwrap();
    idle(&service);
    let next = job(&service, &item.id).next_send_at.unwrap();
    platform
        .unavailable
        .lock()
        .unwrap()
        .insert(owner.id.clone());
    service.tick(next).unwrap();
    idle(&service);
    let paused = job(&service, &item.id);
    assert_eq!(paused.state, BroadcastState::Paused);
    assert_eq!(
        (paused.current, paused.ok, paused.fail, paused.uncertain),
        (1, 1, 0, 0)
    );
    assert_eq!(paused.last_issue, Some(BroadcastIssue::AccountUnavailable));
    assert!(!paused.review_required);
    assert!(paused.checkpoint.is_none());
    assert_eq!(paused.prepared.as_ref().unwrap().index, 1);
    assert_eq!(service.tick(next + 100_000).unwrap(), 0);
    assert_eq!(*platform.commits.lock().unwrap(), 1);
    platform.unavailable.lock().unwrap().clear();
    platform.hour.store(19, Ordering::Release);
    service
        .control(&item.id, BroadcastAction::Resume, next + 100_001)
        .unwrap();
    service.tick(next + 100_002).unwrap();
    idle(&service);
    let completed = job(&service, &item.id);
    assert_eq!(
        (completed.state, completed.ok, completed.fail),
        (BroadcastState::Completed, 2, 0)
    );
    let calls = platform.calls.lock().unwrap();
    assert_eq!(calls.len(), 3);
    assert_eq!(calls[1].request.target_id, calls[2].request.target_id);
    assert_eq!(
        calls[1].request.rendered_text,
        calls[2].request.rendered_text
    );
    assert_eq!(calls[1].binding, calls[2].binding);
    assert_eq!(*platform.commits.lock().unwrap(), 2);
}
