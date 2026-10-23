use super::*;
use std::cell::Cell;

fn chat(id: &str, kind: ChatKind) -> CatalogChat {
    CatalogChat {
        id: id.into(),
        name: format!("Current {id}"),
        real_name: "Platform identity".into(),
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
            capabilities: CatalogCapabilities::default(),
            chats: vec![
                chat("100@c.us", ChatKind::Contact),
                chat("200@g.us", ChatKind::Group),
                chat("300@lid", ChatKind::Contact),
            ],
            labels: None,
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

fn ids(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).into()).collect()
}

#[test]
fn saving_uses_only_current_directory_or_verified_contacts_in_requested_order() {
    let mut directory = lease();
    let wanted = ids(&["200@g.us", "300@lid", "100@c.us"]);
    assert_eq!(freeze_audience_ids(&directory, &wanted).unwrap(), wanted);
    for bad in [
        vec![],
        ids(&["100@c.us", "100@c.us"]),
        ids(&["999@c.us"]),
        ids(&["999@g.us"]),
        ids(&["status@broadcast"]),
        ids(&[" ../shell"]),
    ] {
        assert!(matches!(
            freeze_audience_ids(&directory, &bad),
            Err(AppError::BroadcastPresetInvalid)
        ));
    }
    directory.native_ids.remove("200@g.us");
    assert!(freeze_audience_ids(&directory, &ids(&["200@g.us"])).is_err());
    directory.catalog.chats[0].kind = ChatKind::Group;
    assert!(freeze_audience_ids(&directory, &ids(&["100@c.us"])).is_err());
}

#[test]
fn restoration_preserves_order_current_names_and_deduplicates_resolved_identity() {
    let wanted = ids(&[
        "200@g.us", "400@c.us", "300@lid", "500@c.us", "600@g.us", "100@c.us",
    ]);
    let (restored, contacts, summary) = restore_targets(
        &lease(),
        &wanted,
        |batch| {
            assert_eq!(batch, ids(&["400@c.us", "500@c.us"]));
            Ok(json!([
                { "candidate": "400@c.us", "chat": chat("300@lid", ChatKind::Contact) },
                { "candidate": "500@c.us", "chat": null }
            ]))
        },
        || Ok(()),
        || Duration::ZERO,
    )
    .unwrap();
    assert_eq!(restored, ids(&["200@g.us", "300@lid", "100@c.us"]));
    assert_eq!(contacts.len(), 2);
    assert!(contacts.iter().all(|chat| chat.kind == ChatKind::Contact));
    assert_eq!(contacts[0].name, "Current 300@lid");
    assert_eq!(summary.total, 6);
    assert_eq!(summary.accepted, 3);
    assert_eq!(summary.duplicates, 1);
    assert_eq!(summary.unresolved, 1);
    assert_eq!(summary.skipped, 1);
    assert_eq!(summary.invalid, 0);
}

#[test]
fn unavailable_groups_never_enter_contact_lookup_and_zero_is_an_explicit_result() {
    let calls = Cell::new(0);
    let (restored, contacts, summary) = restore_targets(
        &lease(),
        &ids(&["400@c.us", "999@g.us"]),
        |batch| {
            calls.set(calls.get() + 1);
            assert_eq!(batch, ids(&["400@c.us"]));
            Ok(json!([{ "candidate": "400@c.us", "chat": null }]))
        },
        || Ok(()),
        || Duration::ZERO,
    )
    .unwrap();
    assert_eq!(calls.get(), 1);
    assert!(restored.is_empty());
    assert!(contacts.is_empty());
    assert_eq!(summary.accepted, 0);
    assert_eq!(summary.total, 2);
    assert_eq!(summary.unresolved, 1);
    assert_eq!(summary.skipped, 1);
}

#[test]
fn current_native_groups_are_restored_without_any_contact_query() {
    let (restored, contacts, summary) = restore_targets(
        &lease(),
        &ids(&["200@g.us"]),
        |_| panic!("restoring a current group must not query contacts"),
        || Ok(()),
        || Duration::ZERO,
    )
    .unwrap();
    assert_eq!(restored, ids(&["200@g.us"]));
    assert!(contacts.is_empty());
    assert_eq!(summary.accepted, 1);
}

#[test]
fn invalid_or_wrong_owner_directory_is_rejected_before_querying() {
    for kind in 0..4 {
        let mut directory = lease();
        match kind {
            0 => directory.catalog.ready = false,
            1 => directory.binding.account_id = "account-b".into(),
            2 => directory.binding.platform_id = "whatsapp-pure".into(),
            _ => {
                directory.binding.platform_id = "telegram-k".into();
                directory.catalog.platform_id = "telegram-k".into();
            }
        }
        assert!(freeze_audience_ids(&directory, &ids(&["100@c.us"])).is_err());
        assert!(restore_targets(
            &directory,
            &ids(&["400@c.us"]),
            |_| panic!("invalid directory must not query"),
            || Ok(()),
            || Duration::ZERO
        )
        .is_err());
    }
}

#[test]
fn shared_resolver_rejects_swapped_candidates_extra_fields_and_group_results() {
    for result in [
        json!([]),
        json!([{ "candidate": "500@c.us", "chat": null }]),
        json!([{ "candidate": "400@c.us", "chat": chat("999@g.us", ChatKind::Group) }]),
        json!([{ "candidate": "400@c.us", "chat": chat("../shell", ChatKind::Contact) }]),
        json!([{ "candidate": "400@c.us", "chat": null, "name": "forged" }]),
    ] {
        assert!(matches!(
            restore_targets(
                &lease(),
                &ids(&["400@c.us"]),
                |_| Ok(result.clone()),
                || Ok(()),
                || Duration::ZERO
            ),
            Err(AppError::BroadcastImportUnavailable)
        ));
    }
}

#[test]
fn restoration_checks_generation_and_total_budget_after_every_wait() {
    let called = Cell::new(false);
    for timeout in [false, true] {
        called.set(false);
        let result = restore_targets(
            &lease(),
            &ids(&["100@c.us", "400@c.us"]),
            |_| {
                called.set(true);
                Ok(json!([{
                    "candidate": "400@c.us", "chat": chat("400@c.us", ChatKind::Contact)
                }]))
            },
            || {
                if !timeout && called.get() {
                    Err(AppError::BroadcastImportUnavailable)
                } else {
                    Ok(())
                }
            },
            || Duration::from_secs(if timeout && called.get() { 600 } else { 0 }),
        );
        assert!(matches!(result, Err(AppError::BroadcastImportUnavailable)));
    }
}

#[test]
fn restoration_keeps_two_contact_batches_and_rejects_oversized_or_duplicate_lists() {
    let wanted: Vec<_> = (400..405).map(|i| format!("{i}@c.us")).collect();
    let mut sizes = Vec::new();
    let (restored, contacts, summary) = restore_targets(
        &lease(),
        &wanted,
        |batch| {
            sizes.push(batch.len());
            Ok(json!(batch
                .iter()
                .map(|id| json!({
                    "candidate": id, "chat": chat(id, ChatKind::Contact)
                }))
                .collect::<Vec<_>>()))
        },
        || Ok(()),
        || Duration::ZERO,
    )
    .unwrap();
    assert_eq!(sizes, [2, 2, 1]);
    assert_eq!(restored, wanted);
    assert_eq!(contacts.len(), 5);
    assert_eq!(summary.accepted, 5);
    for bad in [
        vec![],
        ids(&["100@c.us", "100@c.us"]),
        (400..2401).map(|i| format!("{i}@c.us")).collect(),
    ] {
        assert!(restore_targets(
            &lease(),
            &bad,
            |_| panic!("invalid list must not query"),
            || Ok(()),
            || Duration::ZERO
        )
        .is_err());
    }
}
