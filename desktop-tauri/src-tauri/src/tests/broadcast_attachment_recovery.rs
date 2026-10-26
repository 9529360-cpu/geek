use super::{
    broadcast_attachments::{input, select},
    broadcast_support::*,
};
use crate::domain::{broadcast::*, broadcast_validation::validate_document, error::AppError};
use std::sync::Arc;
use uuid::Uuid;

#[test]
fn source_failures_stop_the_job_before_submission_but_preserve_uncertain_submitted_effects() {
    for committed in [false, true] {
        for issue in [
            BroadcastIssue::AttachmentUnavailable,
            BroadcastIssue::AttachmentChanged,
        ] {
            let (service, repository, platform) = setup();
            let owner = account("Source failure");
            let (_directory, selected) = select(&service, &owner);
            let item = service
                .submit(owner.clone(), input(&service, &owner, &selected, 3), NOW)
                .unwrap();
            if committed {
                *platform.outcome.lock().unwrap() =
                    Some(DispatchOutcome::NotSubmitted { code: issue });
            } else {
                *platform.before_submission_issue.lock().unwrap() = Some(issue);
            }
            service.tick(NOW).unwrap();
            idle(&service);
            let current = job(&service, &item.id);
            assert_eq!(current.current, 1);
            assert_eq!(current.last_issue, Some(issue));
            assert_eq!(service.tick(NOW + 10_000).unwrap(), 0);
            if committed {
                assert_eq!(current.state, BroadcastState::Paused);
                assert_eq!(current.uncertain, 1);
                assert!(current.review_required);
                assert_eq!(
                    repository
                        .0
                        .lock()
                        .unwrap()
                        .document
                        .as_ref()
                        .unwrap()
                        .attachment_sources
                        .len(),
                    2
                );
            } else {
                assert_eq!(current.state, BroadcastState::Failed);
                assert_eq!(current.fail, 1);
                assert!(repository
                    .0
                    .lock()
                    .unwrap()
                    .document
                    .as_ref()
                    .unwrap()
                    .attachment_sources
                    .is_empty());
            }
            assert_eq!(*platform.commits.lock().unwrap(), usize::from(committed));
            assert_eq!(platform.calls.lock().unwrap().len(), 1);
        }
    }
}

#[test]
fn attachment_schedule_restarts_with_its_original_owner_and_cleans_sources_after_completion() {
    let (service, repository, platform) = setup();
    let owner = account("Scheduled owner");
    let (_directory, selected) = select(&service, &owner);
    let mut request = input(&service, &owner, &selected, 1);
    request.scheduled_at = Some(NOW + 1_000);
    let item = service.submit(owner.clone(), request, NOW).unwrap();
    let reopened = Service::open_at(repository.clone(), Arc::clone(&platform), NOW + 1).unwrap();
    assert_eq!(reopened.tick(NOW + 999).unwrap(), 0);
    assert_eq!(reopened.tick(NOW + 1_000).unwrap(), 1);
    idle(&reopened);
    let calls = platform.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].binding.account_id, owner.id);
    assert!(calls[0]
        .request
        .attachments
        .iter()
        .all(|source| source.account_id == owner.id && source.job_id == item.id));
    assert_eq!(job(&reopened, &item.id).attachments, selected);
    assert!(repository
        .0
        .lock()
        .unwrap()
        .document
        .as_ref()
        .unwrap()
        .attachment_sources
        .is_empty());
}

#[test]
fn failed_attachment_settlement_retains_sources_and_restart_never_replays_the_uncertain_target() {
    let (service, repository, platform) = setup();
    let owner = account("Recovery");
    let (_directory, selected) = select(&service, &owner);
    let item = service
        .submit(owner.clone(), input(&service, &owner, &selected, 2), NOW)
        .unwrap();
    repository.0.lock().unwrap().fail_at = Some(FailAt::Settle);
    service.tick(NOW).unwrap();
    idle(&service);
    let before = repository.0.lock().unwrap().document.clone().unwrap();
    assert!(before.jobs[0].checkpoint.is_some());
    assert_eq!(before.attachment_sources.len(), 2);
    service.shutdown().unwrap();
    let reopened =
        Service::open_at(repository.clone(), Arc::clone(&platform), NOW + 2_000).unwrap();
    assert_eq!(job(&reopened, &item.id).uncertain, 1);
    assert_eq!(job(&reopened, &item.id).current, 1);
    assert_eq!(reopened.tick(NOW + 3_000).unwrap(), 0);
    reopened
        .control(&item.id, BroadcastAction::Resume, NOW + 3_001)
        .unwrap();
    reopened.tick(NOW + 3_002).unwrap();
    idle(&reopened);
    let calls = platform.calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[1].request.target_id, "synthetic-1@c.us");
    assert_eq!(calls[1].request.attachments, before.attachment_sources);
    assert_eq!(job(&reopened, &item.id).state, BroadcastState::Completed);
    assert!(repository
        .0
        .lock()
        .unwrap()
        .document
        .as_ref()
        .unwrap()
        .attachment_sources
        .is_empty());
}

#[test]
fn old_job_documents_upgrade_only_on_commit_and_invalid_private_sources_never_load() {
    let (service, repository, platform) = setup();
    let owner = account("Schema");
    let (_directory, selected) = select(&service, &owner);
    let item = service
        .submit(owner.clone(), input(&service, &owner, &selected, 1), NOW)
        .unwrap();
    let valid = repository.0.lock().unwrap().document.clone().unwrap();
    for mutation in [
        "missing",
        "owner",
        "job",
        "metadata",
        "duplicate",
        "relative-path",
        "hash",
        "schema-one",
    ] {
        let mut broken = valid.clone();
        match mutation {
            "missing" => {
                broken.attachment_sources.pop();
            }
            "owner" => broken.attachment_sources[0].account_id = Uuid::new_v4().to_string(),
            "job" => broken.attachment_sources[0].job_id = Uuid::new_v4().to_string(),
            "metadata" => broken.attachment_sources[0].attachment.size += 1,
            "duplicate" => broken.attachment_sources[1] = broken.attachment_sources[0].clone(),
            "relative-path" => broken.attachment_sources[0].canonical_path = "relative.txt".into(),
            "hash" => broken.attachment_sources[0].sha256.clear(),
            "schema-one" => broken.schema_version = 1,
            _ => unreachable!(),
        }
        assert_eq!(
            validate_document(&broken),
            Err(AppError::StoreInvalid),
            "{mutation}"
        );
    }
    service
        .control(&item.id, BroadcastAction::Stop, NOW + 1)
        .unwrap();
    let mut old =
        serde_json::to_value(repository.0.lock().unwrap().document.clone().unwrap()).unwrap();
    old["schemaVersion"] = 1.into();
    old.as_object_mut().unwrap().remove("attachmentSources");
    old["jobs"][0]
        .as_object_mut()
        .unwrap()
        .remove("attachments");
    let document: BroadcastDocument = serde_json::from_value(old).unwrap();
    let old_repository = MemoryRepository::default();
    old_repository.0.lock().unwrap().document = Some(document);
    let reopened = Service::open_at(old_repository.clone(), platform, NOW + 2).unwrap();
    assert_eq!(old_repository.0.lock().unwrap().successful_writes, 0);
    reopened
        .control(&item.id, BroadcastAction::Stop, NOW + 3)
        .unwrap();
    assert_eq!(
        old_repository
            .0
            .lock()
            .unwrap()
            .document
            .as_ref()
            .unwrap()
            .schema_version,
        1
    );
    old_repository.0.lock().unwrap().fail_at = Some(FailAt::Any);
    assert!(reopened
        .control(&item.id, BroadcastAction::Dismiss, NOW + 4)
        .is_err());
    assert_eq!(
        old_repository
            .0
            .lock()
            .unwrap()
            .document
            .as_ref()
            .unwrap()
            .schema_version,
        1
    );
    reopened
        .control(&item.id, BroadcastAction::Dismiss, NOW + 5)
        .unwrap();
    assert_eq!(
        old_repository
            .0
            .lock()
            .unwrap()
            .document
            .as_ref()
            .unwrap()
            .schema_version,
        2
    );
}
