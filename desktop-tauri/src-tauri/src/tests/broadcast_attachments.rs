use super::broadcast_support::*;
use crate::{
    domain::{
        broadcast::*,
        broadcast_attachment::{
            validate_attachments, BroadcastAttachment, MAX_ATTACHMENT_BYTES,
            MAX_ATTACHMENT_TOTAL_BYTES,
        },
        broadcast_validation::validate_draft,
        error::AppError,
    },
    infrastructure::broadcast_attachment_source::NativeAttachmentIo,
};
use std::{fs, sync::Arc};
use uuid::Uuid;

pub(super) fn select(
    service: &Service,
    owner: &BroadcastAccount,
) -> (tempfile::TempDir, Vec<BroadcastAttachment>) {
    let directory = tempfile::tempdir().unwrap();
    let paths = [
        directory.path().join("first.png"),
        directory.path().join("last.txt"),
    ];
    fs::write(&paths[0], b"Synthetic image fixture").unwrap();
    fs::write(&paths[1], b"Synthetic document fixture").unwrap();
    let metadata = service
        .register_attachments(&owner.id, &paths, false, &NativeAttachmentIo, &|| Ok(()))
        .unwrap();
    (directory, metadata)
}

pub(super) fn input(
    service: &Service,
    owner: &BroadcastAccount,
    attachments: &[BroadcastAttachment],
    count: usize,
) -> BroadcastDraft {
    let mut request = draft(owner, count);
    let ids: Vec<_> = attachments.iter().map(|file| file.id.clone()).collect();
    request.attachments = service
        .resolve_attachments(&owner.id, &request.id, &ids)
        .unwrap();
    request
}

#[test]
fn attachment_selection_and_job_creation_share_one_durable_commit_and_safe_retries() {
    let (service, repository, _) = setup();
    let owner = account("Attachment owner");
    let (directory, selected) = select(&service, &owner);
    assert_eq!(repository.0.lock().unwrap().successful_writes, 0);
    let request = input(&service, &owner, &selected, 1);
    let ids: Vec<_> = selected.iter().map(|file| file.id.clone()).collect();
    let other = account("Other account");
    assert!(service
        .resolve_attachments(&other.id, &request.id, &ids)
        .is_err());
    assert!(service.release_attachments(&other.id, &ids).is_err());
    repository.0.lock().unwrap().fail_at = Some(FailAt::Any);
    assert!(matches!(
        service.submit(owner.clone(), request.clone(), NOW),
        Err(AppError::BroadcastPersistence)
    ));
    assert!(service.snapshot().unwrap().jobs.is_empty());
    assert_eq!(
        service
            .resolve_attachments(&owner.id, &request.id, &ids)
            .unwrap(),
        selected
    );
    let created = service.submit(owner.clone(), request.clone(), NOW).unwrap();
    let document = repository.0.lock().unwrap().document.clone().unwrap();
    assert_eq!(document.schema_version, 2);
    assert_eq!(document.attachment_sources.len(), 2);
    assert!(document
        .attachment_sources
        .iter()
        .all(|source| source.account_id == owner.id && source.job_id == request.id));
    let public = serde_json::to_string(&service.snapshot().unwrap()).unwrap();
    assert!(!public.contains("canonicalPath"));
    assert!(!public.contains("sha256"));
    assert!(!public.contains(directory.path().to_str().unwrap()));
    assert!(!format!("{document:?}").contains(directory.path().to_str().unwrap()));
    service.release_attachments(&owner.id, &ids).unwrap();
    service.release_attachments(&owner.id, &ids).unwrap();
    assert_eq!(
        service
            .resolve_attachments(&owner.id, &request.id, &ids)
            .unwrap(),
        selected
    );
    assert_eq!(
        service
            .submit(owner.clone(), request.clone(), NOW + 1)
            .unwrap(),
        created
    );
    assert_eq!(repository.0.lock().unwrap().successful_writes, 1);
    let mut another = request.clone();
    another.id = Uuid::new_v4().to_string();
    assert!(matches!(
        service.submit(owner.clone(), another, NOW + 1),
        Err(AppError::BroadcastAttachmentUnavailable)
    ));
    let mut changed = request;
    changed.attachments.reverse();
    assert!(matches!(
        service.submit(owner, changed, NOW + 2),
        Err(AppError::BroadcastConflict)
    ));
}

#[test]
fn unsupported_or_forged_attachment_drafts_fail_before_consuming_the_selection() {
    let (service, repository, _) = setup();
    let owner = account("Validation");
    let (_directory, selected) = select(&service, &owner);
    let original = input(&service, &owner, &selected, 1);
    let mut forged = original.clone();
    forged.attachments[0].name = "forged.png".into();
    assert!(matches!(
        service.submit(owner.clone(), forged, NOW),
        Err(AppError::BroadcastAttachmentUnavailable)
    ));
    let mut tagged = original.clone();
    tagged.tag_all = true;
    assert_eq!(
        validate_draft(&owner, &tagged),
        Err(AppError::BroadcastUnsupported)
    );
    let mut unsupported = owner.clone();
    unsupported.capabilities.attachments = false;
    assert_eq!(
        validate_draft(&unsupported, &original),
        Err(AppError::BroadcastUnsupported)
    );
    let mut duplicate = original.clone();
    duplicate.attachments.push(duplicate.attachments[0].clone());
    assert_eq!(
        validate_draft(&owner, &duplicate),
        Err(AppError::BroadcastAttachmentLimit)
    );
    assert_eq!(repository.0.lock().unwrap().successful_writes, 0);
    let mut attachment_only = original;
    attachment_only.message.clear();
    assert!(service.submit(owner, attachment_only, NOW).is_ok());
}

#[test]
fn attachment_limits_keep_the_original_practical_file_and_total_sizes() {
    let (service, _, _) = setup();
    let owner = account("Limits");
    let (_directory, selected) = select(&service, &owner);
    let mut first = selected[0].clone();
    first.size = MAX_ATTACHMENT_BYTES;
    let mut second = first.clone();
    second.id = Uuid::new_v4().to_string();
    assert_eq!(first.size + second.size, MAX_ATTACHMENT_TOTAL_BYTES);
    assert!(validate_attachments(&[first.clone(), second.clone()]).is_ok());
    let mut extra = selected[1].clone();
    extra.size = 1;
    assert_eq!(
        validate_attachments(&[first.clone(), second, extra]),
        Err(AppError::BroadcastAttachmentLimit)
    );
    first.size += 1;
    assert!(validate_attachments(&[first]).is_err());
    let eleven: Vec<_> = (0..11)
        .map(|_| BroadcastAttachment {
            id: Uuid::new_v4().to_string(),
            size: 0,
            ..selected[0].clone()
        })
        .collect();
    assert_eq!(
        validate_attachments(&eleven),
        Err(AppError::BroadcastAttachmentLimit)
    );
}

#[test]
fn stopping_a_live_attachment_attempt_retires_sources_only_with_its_durable_terminal_state() {
    let (service, repository, platform) = setup();
    let owner = account("Cancellation");
    let (directory, selected) = select(&service, &owner);
    let request = input(&service, &owner, &selected, 1);
    let item = service.submit(owner.clone(), request, NOW).unwrap();
    let gate = Arc::new(Gate::default());
    *platform.before_commit.lock().unwrap() = Some(Arc::clone(&gate));
    service.tick(NOW).unwrap();
    platform.await_calls(1);
    let attempt = platform.calls.lock().unwrap()[0].request.clone();
    assert_eq!(
        attempt
            .attachments
            .iter()
            .map(|source| source.attachment.clone())
            .collect::<Vec<_>>(),
        selected
    );
    assert_eq!(
        service
            .dispatch_sources(&owner.id, &item.id, &attempt.attempt_id)
            .unwrap(),
        attempt.attachments
    );
    assert!(service
        .dispatch_sources(&account("Wrong").id, &item.id, &attempt.attempt_id)
        .is_err());
    assert!(service
        .dispatch_sources(&owner.id, &item.id, &Uuid::new_v4().to_string())
        .is_err());
    repository.0.lock().unwrap().fail_at = Some(FailAt::Any);
    assert!(matches!(
        service.control(&item.id, BroadcastAction::Stop, NOW + 1),
        Err(AppError::BroadcastPersistence)
    ));
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
    service
        .control(&item.id, BroadcastAction::Stop, NOW + 2)
        .unwrap();
    assert_eq!(job(&service, &item.id).state, BroadcastState::Stopping);
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
    gate.release();
    idle(&service);
    assert_eq!(*platform.commits.lock().unwrap(), 0);
    assert_eq!(job(&service, &item.id).state, BroadcastState::Stopped);
    assert_eq!(job(&service, &item.id).attachments, selected);
    assert!(repository
        .0
        .lock()
        .unwrap()
        .document
        .as_ref()
        .unwrap()
        .attachment_sources
        .is_empty());
    assert!(directory.path().join("first.png").is_file());
    assert!(service
        .dispatch_sources(&owner.id, &item.id, &attempt.attempt_id)
        .is_err());
}
