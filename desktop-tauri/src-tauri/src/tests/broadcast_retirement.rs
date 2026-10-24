use super::broadcast_support::*;
use crate::domain::{broadcast::*, error::AppError};
use std::sync::Arc;
use uuid::Uuid;

fn closed_history(
    service: &Service,
    owner: &BroadcastAccount,
    dismiss: bool,
) -> Vec<BroadcastDraft> {
    (0..MAX_JOBS)
        .map(|index| {
            let input = draft(owner, 1);
            let at = NOW + index as u64 * 3;
            service.submit(owner.clone(), input.clone(), at).unwrap();
            service
                .control(&input.id, BroadcastAction::Stop, at + 1)
                .unwrap();
            if dismiss {
                service
                    .control(&input.id, BroadcastAction::Dismiss, at + 2)
                    .unwrap();
            }
            input
        })
        .collect()
}

#[test]
fn dismissed_history_compacts_at_capacity_and_retired_ids_never_submit_again() {
    let (service, repository, platform) = setup();
    let owner = account("History");
    let history = closed_history(&service, &owner, true);
    assert_eq!(service.snapshot().unwrap().jobs.len(), MAX_JOBS);
    assert!(repository
        .0
        .lock()
        .unwrap()
        .document
        .as_ref()
        .unwrap()
        .retired_ids
        .is_empty());
    let next_input = draft(&owner, 1);
    let next = service
        .submit(owner.clone(), next_input, NOW + 1_000)
        .unwrap();
    let snapshot = service.snapshot().unwrap();
    assert_eq!(snapshot.jobs.len(), MAX_JOBS);
    assert!(!snapshot.jobs.iter().any(|job| job.id == history[0].id));
    assert!(snapshot.jobs.iter().any(|job| job.id == history[1].id));
    assert_eq!(
        repository
            .0
            .lock()
            .unwrap()
            .document
            .as_ref()
            .unwrap()
            .retired_ids,
        vec![history[0].id.clone()]
    );
    let writes = repository.0.lock().unwrap().successful_writes;
    assert!(matches!(
        service.submit(owner.clone(), history[0].clone(), NOW + 1_001),
        Err(AppError::BroadcastRetired)
    ));
    assert_eq!(repository.0.lock().unwrap().successful_writes, writes);
    assert_eq!(service.tick(NOW + 1_002).unwrap(), 1);
    idle(&service);
    assert_eq!(job(&service, &next.id).ok, 1);
    service.shutdown().unwrap();
    let reopened =
        Service::open_at(repository.clone(), Arc::clone(&platform), NOW + 1_003).unwrap();
    assert!(matches!(
        reopened.submit(owner, history[0].clone(), NOW + 1_004),
        Err(AppError::BroadcastRetired)
    ));
    assert_eq!(reopened.tick(NOW + 100_000).unwrap(), 0);
    let calls = platform.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].request.job_id, next.id);
}

#[test]
fn compaction_and_new_job_roll_back_together_when_the_encrypted_write_fails() {
    let (service, repository, platform) = setup();
    let owner = account("Atomic history");
    let history = closed_history(&service, &owner, true);
    let before = repository.0.lock().unwrap().document.clone();
    let revision = service.snapshot().unwrap().revision;
    let next = draft(&owner, 1);
    repository.0.lock().unwrap().fail_at = Some(FailAt::Any);
    assert!(matches!(
        service.submit(owner.clone(), next.clone(), NOW + 1_000),
        Err(AppError::BroadcastPersistence)
    ));
    assert_eq!(repository.0.lock().unwrap().document, before);
    assert_eq!(service.snapshot().unwrap().revision, revision);
    assert_eq!(job(&service, &history[0].id).state, BroadcastState::Stopped);
    assert!(
        service
            .submit(owner.clone(), history[0].clone(), NOW + 1_001)
            .unwrap()
            .dismissed
    );
    assert!(platform.calls.lock().unwrap().is_empty());
    service.submit(owner.clone(), next, NOW + 1_002).unwrap();
    assert_eq!(service.snapshot().unwrap().jobs.len(), MAX_JOBS);
    assert!(matches!(
        service.submit(owner, history[0].clone(), NOW + 1_003),
        Err(AppError::BroadcastRetired)
    ));
}

#[test]
fn only_explicitly_dismissed_terminal_history_can_be_reclaimed() {
    let (service, repository, _) = setup();
    let owner = account("Visible history");
    let history = closed_history(&service, &owner, false);
    let next = draft(&owner, 1);
    let before = service.snapshot().unwrap();
    assert!(matches!(
        service.submit(owner.clone(), next.clone(), NOW + 1_000),
        Err(AppError::BroadcastLimit)
    ));
    assert_eq!(service.snapshot().unwrap().jobs, before.jobs);
    service
        .control(&history[50].id, BroadcastAction::Dismiss, NOW + 1_001)
        .unwrap();
    service.submit(owner, next, NOW + 1_002).unwrap();
    let snapshot = service.snapshot().unwrap();
    assert!(snapshot.jobs.iter().any(|job| job.id == history[0].id));
    assert!(!snapshot.jobs.iter().any(|job| job.id == history[50].id));
    assert_eq!(
        repository
            .0
            .lock()
            .unwrap()
            .document
            .as_ref()
            .unwrap()
            .retired_ids,
        vec![history[50].id.clone()]
    );
}

#[test]
fn the_retired_id_limit_never_discards_an_old_id_to_make_room() {
    let (service, repository, platform) = setup();
    let owner = account("Bounded identity history");
    closed_history(&service, &owner, true);
    {
        let mut state = repository.0.lock().unwrap();
        state.document.as_mut().unwrap().retired_ids = (0..MAX_RETIRED_IDS)
            .map(|_| Uuid::new_v4().to_string())
            .collect();
    }
    let before = repository.0.lock().unwrap().document.clone();
    let reopened = Service::open_at(repository.clone(), platform, NOW + 1_000).unwrap();
    assert!(matches!(
        reopened.submit(owner.clone(), draft(&owner, 1), NOW + 1_001),
        Err(AppError::BroadcastLimit)
    ));
    assert_eq!(repository.0.lock().unwrap().document, before);
    assert_eq!(reopened.snapshot().unwrap().jobs.len(), MAX_JOBS);
}

#[test]
fn old_documents_default_retired_ids_but_invalid_tombstones_fail_without_reset() {
    let (service, repository, platform) = setup();
    let owner = account("Schema");
    let item = service
        .submit(owner.clone(), draft(&owner, 1), NOW)
        .unwrap();
    service
        .control(&item.id, BroadcastAction::Stop, NOW + 1)
        .unwrap();
    let original = repository.0.lock().unwrap().document.clone().unwrap();
    let mut legacy = serde_json::to_value(&original).unwrap();
    legacy.as_object_mut().unwrap().remove("retiredIds");
    let loaded: BroadcastDocument = serde_json::from_value(legacy).unwrap();
    assert!(loaded.retired_ids.is_empty());
    assert_eq!(loaded.jobs, original.jobs);
    let valid_id = Uuid::new_v4().to_string();
    for invalid in [
        vec!["not-a-uuid".into()],
        vec![valid_id.clone(), valid_id],
        vec![item.id.clone()],
        (0..=MAX_RETIRED_IDS)
            .map(|_| Uuid::new_v4().to_string())
            .collect(),
    ] {
        let mut document = original.clone();
        document.retired_ids = invalid;
        repository.0.lock().unwrap().document = Some(document.clone());
        let writes = repository.0.lock().unwrap().successful_writes;
        assert!(matches!(
            Service::open_at(repository.clone(), Arc::clone(&platform), NOW + 2),
            Err(AppError::StoreInvalid)
        ));
        assert_eq!(repository.0.lock().unwrap().document, Some(document));
        assert_eq!(repository.0.lock().unwrap().successful_writes, writes);
    }
}
