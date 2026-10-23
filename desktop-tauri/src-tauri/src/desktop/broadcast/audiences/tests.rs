use super::*;

fn chat(id: &str, kind: ChatKind) -> CatalogChat {
    CatalogChat {
        id: id.into(),
        name: format!("Frozen {id}"),
        real_name: "Native name".into(),
        kind,
    }
}

fn lease() -> CatalogLease {
    CatalogLease {
        catalog: BroadcastCatalog {
            account_id: "account-a".into(),
            account_name: "Synthetic".into(),
            platform_id: "whatsapp".into(),
            catalog_id: "catalog-a".into(),
            ready: true,
            reason_code: None,
            capabilities: CatalogCapabilities {
                group_members: true,
                ..CatalogCapabilities::default()
            },
            chats: vec![
                chat("100@c.us", ChatKind::Contact),
                chat("200@g.us", ChatKind::Group),
                chat("300@lid", ChatKind::Contact),
            ],
            labels: Some(vec![CatalogLabel {
                id: "label_1".into(),
                name: "Frozen label".into(),
            }]),
        },
        binding: GuestBinding {
            account_id: "account-a".into(),
            platform_id: "whatsapp".into(),
            generation: "generation-a".into(),
        },
        native_ids: ["100@c.us".into(), "200@g.us".into()].into(),
        imported: vec![chat("300@lid", ChatKind::Contact)],
        issued: Instant::now(),
    }
}

fn group(ids: Vec<String>, skipped: usize) -> serde_json::Value {
    json!({ "candidates": ids, "selfIds": ["900@c.us", "901@lid"], "skipped": skipped })
}

#[test]
fn source_ipc_is_a_closed_tagged_choice_without_renderer_targets_or_names() {
    for value in [
        json!({ "kind": "groups", "groupIds": ["200@g.us"] }),
        json!({ "kind": "label", "labelId": "label_1" }),
    ] {
        assert!(serde_json::from_value::<BroadcastAudienceSource>(value).is_ok());
    }
    for value in [
        json!({ "groupIds": ["200@g.us"] }),
        json!({ "kind": "unknown", "groupIds": ["200@g.us"] }),
        json!({ "kind": "groups", "groupIds": "200@g.us" }),
        json!({ "kind": "groups", "groupIds": [100] }),
        json!({ "kind": "label", "labelId": 1 }),
        json!({ "kind": "groups", "groupIds": ["200@g.us"], "labelId": "label_1" }),
        json!({ "kind": "label", "labelId": "label_1", "chatIds": ["100@c.us"] }),
        json!({ "kind": "label", "labelId": "label_1", "name": "forged" }),
    ] {
        assert!(serde_json::from_value::<BroadcastAudienceSource>(value).is_err());
    }
}

#[test]
fn group_selection_requires_unique_original_native_groups_and_the_advertised_capability() {
    let mut lease = lease();
    assert!(validate_groups(&lease, &["200@g.us".into()]).is_ok());
    for ids in [
        vec![],
        vec!["100@c.us".into()],
        vec!["999@g.us".into()],
        vec!["200@g.us".into(), "200@g.us".into()],
    ] {
        assert!(matches!(
            validate_groups(&lease, &ids),
            Err(AppError::BroadcastInvalid)
        ));
    }
    lease.native_ids.remove("200@g.us");
    assert!(validate_groups(&lease, &["200@g.us".into()]).is_err());
    let groups: Vec<_> = (1000..1021).map(|i| format!("{i}@g.us")).collect();
    for id in &groups {
        lease.catalog.chats.push(chat(id, ChatKind::Group));
        lease.native_ids.insert(id.clone());
    }
    assert!(validate_groups(&lease, &groups[..20]).is_ok());
    assert!(validate_groups(&lease, &groups).is_err());
    lease.catalog.capabilities.group_members = false;
    assert!(matches!(
        validate_groups(&lease, &groups[..1]),
        Err(AppError::BroadcastUnsupported)
    ));
}

#[test]
fn group_candidates_preserve_first_order_deduplicate_across_groups_and_retain_self_skip_counts() {
    let mut result = GroupCandidates::default();
    result
        .accept(group(
            vec!["100@c.us".into(), "200@lid".into(), "100@c.us".into()],
            1,
        ))
        .unwrap();
    let mut second = group(vec!["200@lid".into(), "300@c.us".into()], 2);
    second["selfIds"] = json!(["901@lid", "900@c.us"]);
    result.accept(second).unwrap();
    assert_eq!(
        result.parsed.candidates,
        ["100@c.us", "200@lid", "300@c.us"]
    );
    assert_eq!(result.parsed.duplicate_count, 2);
    assert_eq!(result.parsed.skipped_count, 3);
    assert_eq!(result.parsed.invalid_count, 0);
    assert_eq!(result.self_ids.unwrap(), ["900@c.us", "901@lid"]);
}

#[test]
fn group_identity_changes_unknown_namespaces_self_candidates_and_wide_payloads_are_rejected() {
    let mut result = GroupCandidates::default();
    result.accept(group(vec!["100@c.us".into()], 0)).unwrap();
    assert!(matches!(
        result.accept(json!({
            "candidates": ["200@lid"], "selfIds": ["999@c.us", "901@lid"], "skipped": 0
        })),
        Err(AppError::BroadcastImportUnavailable)
    ));
    for bad in [
        group(vec!["900@c.us".into()], 0),
        group(vec!["901@lid".into()], 0),
        group(vec!["100@g.us".into()], 0),
        group(vec!["100@s.whatsapp.net".into()], 0),
        json!({ "candidates": ["200@lid"], "selfIds": ["900@c.us"], "skipped": 0 }),
        json!({ "candidates": ["100@c.us"], "selfIds": [], "skipped": 0 }),
        json!({ "candidates": ["100@c.us"], "selfIds": ["900@c.us", "901@c.us"], "skipped": 0 }),
        json!({ "candidates": ["100@c.us"], "selfIds": ["900@c.us"], "skipped": -1 }),
        json!({ "candidates": ["100@c.us"], "selfIds": ["900@c.us"], "skipped": 0, "names": [] }),
    ] {
        assert!(GroupCandidates::default().accept(bad).is_err());
    }
}

#[test]
fn group_limits_never_return_a_truncated_audience_and_count_raw_members_including_skips() {
    let ids: Vec<_> = (10000..12000).map(|i| format!("{i}@c.us")).collect();
    let mut result = GroupCandidates::default();
    result.accept(group(ids.clone(), 8000)).unwrap();
    assert_eq!(result.parsed.candidates.len(), MAX_TARGETS);
    result.accept(group(vec![ids[0].clone()], 0)).unwrap();
    assert_eq!(result.parsed.duplicate_count, 1);
    assert!(matches!(
        result.accept(group(vec!["12000@c.us".into()], 0)),
        Err(AppError::BroadcastImportLimit)
    ));
    assert!(matches!(
        GroupCandidates::default().accept(group(ids, 8001)),
        Err(AppError::BroadcastImportLimit)
    ));
}

#[test]
fn labels_are_bound_to_the_issued_options_and_original_directory_including_groups() {
    let mut lease = lease();
    let source = label_source_chats(&lease, "label_1").unwrap();
    assert_eq!(
        source
            .iter()
            .map(|chat| chat.id.as_str())
            .collect::<Vec<_>>(),
        ["100@c.us", "200@g.us"]
    );
    assert_eq!(source[0].real_name, "Native name");
    assert!(label_source_chats(&lease, "Frozen label").is_err());
    assert!(label_source_chats(&lease, "missing").is_err());
    lease.catalog.labels = None;
    assert!(matches!(
        label_source_chats(&lease, "label_1"),
        Err(AppError::BroadcastUnsupported)
    ));
    lease.catalog.labels = Some(Vec::new());
    assert!(matches!(
        label_source_chats(&lease, "label_1"),
        Err(AppError::BroadcastImportUnavailable)
    ));
}

#[test]
fn label_reply_must_be_an_exact_unique_subset_and_never_supply_names_or_new_targets() {
    let lease = lease();
    let batch = label_source_chats(&lease, "label_1").unwrap();
    assert_eq!(
        label_selection(
            json!({ "labelId": "label_1", "chatIds": ["200@g.us", "100@c.us"] }),
            "label_1",
            &batch
        )
        .unwrap(),
        ["100@c.us", "200@g.us"]
    );
    for bad in [
        json!({ "labelId": "other", "chatIds": ["100@c.us"] }),
        json!({ "labelId": "label_1", "chatIds": ["300@lid"] }),
        json!({ "labelId": "label_1", "chatIds": ["100@c.us", "100@c.us"] }),
        json!({ "labelId": "label_1", "chatIds": [100] }),
        json!({ "labelId": "label_1", "chatIds": ["100@c.us"], "name": "forged" }),
    ] {
        assert!(label_selection(bad, "label_1", &batch).is_err());
    }
}

#[test]
fn label_limit_is_cumulative_across_batches_and_rejects_the_2001st_target() {
    let chats: Vec<_> = (10000..12001)
        .map(|i| chat(&format!("{i}@c.us"), ChatKind::Contact))
        .collect();
    let mut selected = Vec::new();
    for batch in chats[..2000].chunks(200) {
        let refs: Vec<_> = batch.iter().collect();
        let ids: Vec<_> = batch.iter().map(|chat| &chat.id).collect();
        append_label_selection(
            &mut selected,
            json!({ "labelId": "label_1", "chatIds": ids }),
            "label_1",
            &refs,
        )
        .unwrap();
    }
    assert_eq!(selected.len(), MAX_TARGETS);
    assert!(matches!(
        append_label_selection(
            &mut selected,
            json!({ "labelId": "label_1", "chatIds": ["12000@c.us"] }),
            "label_1",
            &[&chats[2000]],
        ),
        Err(AppError::BroadcastImportLimit)
    ));
}
