use super::{
    broadcast_attachments::{input, select},
    broadcast_support::*,
};
use crate::domain::{
    broadcast::*, broadcast_attachment::BroadcastAttachment, broadcast_validation::validate_draft,
    error::AppError,
};
use std::sync::Arc;

fn owner() -> BroadcastAccount {
    let mut owner = account("K attachment owner");
    owner.platform_id = "telegram-k".into();
    owner.capabilities.tag_all = false;
    owner.capabilities.vcards = false;
    owner
}

fn request(
    service: &Service,
    owner: &BroadcastAccount,
    selected: &[BroadcastAttachment],
    count: usize,
) -> BroadcastDraft {
    let mut request = input(service, owner, selected, count);
    for (index, target) in request.targets.iter_mut().enumerate() {
        target.id = format!("tg:{}", index + 1);
    }
    request
}

#[test]
fn k_caption_limits_count_utf16_and_validate_every_expanded_variant_before_commit() {
    let (service, repository, _) = setup();
    let owner = owner();
    let (_directory, selected) = select(&service, &owner);
    let mut request = request(&service, &owner, &selected, 1);
    for valid in [String::new(), "a".repeat(1024), "😀".repeat(512)] {
        request.message = valid;
        assert_eq!(validate_draft(&owner, &request), Ok(()));
    }
    for invalid in [
        "a".repeat(1025),
        "😀".repeat(513),
        format!("{}%nc", "a".repeat(1020)),
        format!("{{short|{}}}", "a".repeat(1025)),
    ] {
        request.message = invalid;
        assert_eq!(
            service.submit(owner.clone(), request.clone(), NOW),
            Err(AppError::BroadcastInvalid)
        );
        assert_eq!(repository.0.lock().unwrap().successful_writes, 0);
    }
    // Validation failure leaves the same selected files available for correction.
    let ids: Vec<_> = selected.iter().map(|file| file.id.clone()).collect();
    assert_eq!(
        service
            .resolve_attachments(&owner.id, &request.id, &ids)
            .unwrap(),
        selected
    );
    request.message.clear();
    let created = service.submit(owner, request, NOW).unwrap();
    assert_eq!(created.attachments, selected);
    assert_eq!(repository.0.lock().unwrap().successful_writes, 1);
}

#[test]
fn k_attachments_require_the_live_capability_and_do_not_enable_other_platforms_or_features() {
    let (service, repository, _) = setup();
    let owner = owner();
    let (_directory, selected) = select(&service, &owner);
    let request = request(&service, &owner, &selected, 1);
    let mut unavailable = owner.clone();
    unavailable.capabilities.attachments = false;
    assert_eq!(
        validate_draft(&unavailable, &request),
        Err(AppError::BroadcastUnsupported)
    );
    for platform in ["telegram-a", "telegram-z", "line"] {
        let mut unsupported = owner.clone();
        unsupported.platform_id = platform.into();
        assert_eq!(
            validate_draft(&unsupported, &request),
            Err(AppError::BroadcastUnsupported)
        );
    }
    let mut forged = request.clone();
    forged.attachments[0].size = 0;
    assert_eq!(
        validate_draft(&owner, &forged),
        Err(AppError::BroadcastAttachmentInvalid)
    );
    forged = request.clone();
    forged.tag_all = true;
    assert_eq!(
        validate_draft(&owner, &forged),
        Err(AppError::BroadcastUnsupported)
    );
    forged = request.clone();
    forged.vcards.push(BroadcastVcard {
        id: "tg:9".into(),
        name: "Contact".into(),
    });
    assert_eq!(
        validate_draft(&owner, &forged),
        Err(AppError::BroadcastUnsupported)
    );
    let other = account("Other account");
    let ids: Vec<_> = selected.iter().map(|file| file.id.clone()).collect();
    assert!(service
        .resolve_attachments(&other.id, &request.id, &ids)
        .is_err());
    assert_eq!(repository.0.lock().unwrap().successful_writes, 0);
}

#[test]
fn scheduled_k_files_survive_restart_and_uncertain_recovery_never_replays_a_target() {
    let (service, repository, platform) = setup();
    let owner = owner();
    let (_directory, selected) = select(&service, &owner);
    let mut request = request(&service, &owner, &selected, 2);
    request.scheduled_at = Some(NOW + 1000);
    let item = service.submit(owner.clone(), request, NOW).unwrap();
    service.shutdown().unwrap();
    let reopened = Service::open_at(repository.clone(), Arc::clone(&platform), NOW + 1).unwrap();
    assert_eq!(reopened.tick(NOW + 999).unwrap(), 0);
    repository.0.lock().unwrap().fail_at = Some(FailAt::Settle);
    assert_eq!(reopened.tick(NOW + 1000).unwrap(), 1);
    idle(&reopened);
    let before = repository.0.lock().unwrap().document.clone().unwrap();
    assert!(before.jobs[0].checkpoint.is_some());
    assert_eq!(before.attachment_sources.len(), 2);
    reopened.shutdown().unwrap();
    let recovered =
        Service::open_at(repository.clone(), Arc::clone(&platform), NOW + 2000).unwrap();
    let interrupted = job(&recovered, &item.id);
    assert_eq!((interrupted.current, interrupted.uncertain), (1, 1));
    assert!(interrupted.review_required);
    assert_eq!(recovered.tick(NOW + 3000).unwrap(), 0);
    recovered
        .control(&item.id, BroadcastAction::Resume, NOW + 3001)
        .unwrap();
    assert_eq!(recovered.tick(NOW + 3002).unwrap(), 1);
    idle(&recovered);
    let calls = platform.calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].request.target_id, "tg:1");
    assert_eq!(calls[1].request.target_id, "tg:2");
    for call in calls.iter() {
        assert_eq!(call.binding.account_id, owner.id);
        assert_eq!(call.binding.platform_id, "telegram-k");
        assert_eq!(call.request.attachments, before.attachment_sources);
        assert!(call
            .request
            .attachments
            .iter()
            .all(|source| source.account_id == owner.id && source.job_id == item.id));
    }
    let completed = job(&recovered, &item.id);
    assert_eq!(completed.state, BroadcastState::Completed);
    assert_eq!((completed.ok, completed.uncertain), (1, 1));
    assert_eq!(completed.attachments, selected);
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
