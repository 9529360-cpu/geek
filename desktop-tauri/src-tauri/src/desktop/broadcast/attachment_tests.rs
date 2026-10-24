use super::*;
use crate::domain::broadcast_attachment::{AttachmentKind, BroadcastAttachment};
use serde_json::json;

fn input() -> CreateBroadcast {
    serde_json::from_value(json!({
        "id": "11111111-1111-4111-8111-111111111111",
        "accountId": "22222222-2222-4222-8222-222222222222",
        "catalogId": "33333333-3333-4333-8333-333333333333",
        "recipientIds": ["100@c.us"], "vcardIds": [], "attachmentIds": [],
        "message": "", "tagAll": false, "intervalMin": 5, "intervalMax": 10,
        "scheduledAt": null
    }))
    .unwrap()
}

#[test]
fn attachment_references_are_unique_bounded_typed_and_never_paths() {
    let mut draft = input();
    draft.attachment_ids = vec!["44444444-4444-4444-8444-444444444444".into()];
    assert!(validate_create(&draft).is_ok());
    draft.tag_all = true;
    assert_eq!(validate_create(&draft), Err(AppError::BroadcastUnsupported));
    draft.tag_all = false;
    draft.attachment_ids.push(draft.attachment_ids[0].clone());
    assert_eq!(validate_create(&draft), Err(AppError::BroadcastInvalid));
    draft.attachment_ids = vec!["C:\\private\\selected-file.pdf".into()];
    assert_eq!(validate_create(&draft), Err(AppError::BroadcastInvalid));
}

#[test]
fn lost_create_reply_can_only_recover_the_same_ordered_attachment_intent() {
    let mut input = input();
    let attachments = [4, 5]
        .into_iter()
        .map(|digit| BroadcastAttachment {
            id: format!("{digit:08}-4444-4444-8444-444444444444"),
            name: format!("file-{digit}.pdf"),
            size: 12,
            mime: "application/pdf".into(),
            kind: AttachmentKind::Document,
        })
        .collect::<Vec<_>>();
    input.attachment_ids = attachments.iter().map(|a| a.id.clone()).collect();
    let account = BroadcastAccount {
        id: input.account_id.clone(),
        name: "Synthetic".into(),
        platform_id: "whatsapp".into(),
        capabilities: BroadcastCapabilities::default(),
    };
    let job = BroadcastJob::from_draft(
        &account,
        BroadcastDraft {
            id: input.id.clone(),
            account_id: input.account_id.clone(),
            targets: vec![BroadcastTarget {
                id: "100@c.us".into(),
                name: "Synthetic".into(),
                real_name: String::new(),
            }],
            message: String::new(),
            tag_all: false,
            vcards: Vec::new(),
            attachments,
            interval_min_ms: 5_000,
            interval_max_ms: 10_000,
            scheduled_at: None,
        },
        1000,
    );
    assert!(same_intent(&job, &input));
    input.attachment_ids.reverse();
    assert!(!same_intent(&job, &input));
    input.attachment_ids.clear();
    assert!(!same_intent(&job, &input));
    let snapshot = serde_json::to_value(BroadcastSnapshot {
        revision: 1,
        jobs: vec![job],
    })
    .unwrap();
    assert!(snapshot["jobs"][0]["attachments"][0]
        .get("canonicalPath")
        .is_none());
}
