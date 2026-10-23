use super::*;
use std::cell::Cell;

fn row(candidate: &str, id: Option<&str>) -> serde_json::Value {
    json!({
        "candidate": candidate,
        "chat": id.map(|id| json!({
            "id": id, "kind": "contact", "name": "Loaded contact", "realName": ""
        }))
    })
}

#[test]
fn resolver_rows_must_match_requested_order_and_contact_kind() {
    let candidates = vec!["60123456789".into()];
    let value = json!([{ "candidate": "60123456789", "chat": {
        "id": "123@lid", "kind": "contact", "name": "A\nB", "realName": "姓名" } }]);
    let result = resolved_batch(value.clone(), &candidates).unwrap();
    assert_eq!(result[0].as_ref().unwrap().name, "AB");
    assert!(resolved_batch(value, &["60123456780".into()]).is_err());
    assert!(resolved_batch(json!([]), &candidates).is_err());
    assert!(resolved_batch(
        json!([{ "candidate":"60123456789", "chat": {
        "id":"12@g.us", "kind":"group", "name":"g", "realName":"" } }]),
        &candidates
    )
    .is_err());
    assert!(resolved_batch(
        json!([{ "candidate":"60123456789", "chat": null, "path":"x" }]),
        &candidates
    )
    .is_err());
    assert!(resolved_batch(
        json!([{ "candidate":"60123456789", "chat":null }]),
        &candidates
    )
    .unwrap()[0]
        .is_none());
}

#[test]
fn file_and_paste_share_bounded_queries_canonical_deduplication_and_summary_accounting() {
    let text = "123456\n123457\n123458\n123459\n123456\ninvalid\n";
    for parsed in [
        parse_broadcast_pasted_recipients(text).unwrap(),
        parse_broadcast_import(format!("phone\n{text}").as_bytes()).unwrap(),
    ] {
        let mut batches = Vec::new();
        let (contacts, summary) = verify_candidates(
            parsed,
            |batch, timeout| {
                assert_eq!(timeout, Duration::from_secs(35));
                batches.push(batch.to_vec());
                Ok(serde_json::Value::Array(
                    batch
                        .iter()
                        .map(|candidate| {
                            row(
                                candidate,
                                match candidate.as_str() {
                                    "123456" | "123457" => Some("100@lid"),
                                    "123459" => Some("200@c.us"),
                                    _ => None,
                                },
                            )
                        })
                        .collect(),
                ))
            },
            || Ok(()),
            || Duration::ZERO,
        )
        .unwrap();
        assert_eq!(batches, [["123456", "123457"], ["123458", "123459"]]);
        assert_eq!(
            contacts
                .iter()
                .map(|chat| chat.id.as_str())
                .collect::<Vec<_>>(),
            ["100@lid", "200@c.us"]
        );
        assert_eq!(
            serde_json::to_value(summary).unwrap(),
            json!({
                "total": 6, "accepted": 2, "duplicates": 2,
                "invalid": 1, "unresolved": 1, "skipped": 0
            })
        );
    }
}

#[test]
fn invalidation_before_or_during_a_query_never_returns_a_partial_catalog() {
    for before_query in [true, false] {
        let valid = Cell::new(!before_query);
        let calls = Cell::new(0);
        let result = verify_candidates(
            parse_broadcast_pasted_recipients("123456\n123457\n123458").unwrap(),
            |batch, _| {
                calls.set(calls.get() + 1);
                valid.set(false);
                Ok(serde_json::Value::Array(
                    batch
                        .iter()
                        .map(|candidate| row(candidate, Some("100@lid")))
                        .collect(),
                ))
            },
            || {
                if valid.get() {
                    Ok(())
                } else {
                    Err(AppError::BroadcastImportUnavailable)
                }
            },
            || Duration::ZERO,
        );
        assert!(matches!(result, Err(AppError::BroadcastImportUnavailable)));
        assert_eq!(calls.get(), usize::from(!before_query));
    }
}

#[test]
fn the_original_absolute_query_budget_rejects_expired_and_late_results() {
    for before_query in [true, false] {
        let elapsed = Cell::new(Duration::from_secs(if before_query { 600 } else { 595 }));
        let calls = Cell::new(0);
        let result = verify_candidates(
            parse_broadcast_pasted_recipients("123456").unwrap(),
            |batch, timeout| {
                calls.set(calls.get() + 1);
                assert_eq!(timeout, Duration::from_secs(5));
                elapsed.set(Duration::from_secs(600));
                Ok(json!([row(&batch[0], Some("100@lid"))]))
            },
            || Ok(()),
            || elapsed.get(),
        );
        assert!(matches!(result, Err(AppError::BroadcastImportUnavailable)));
        assert_eq!(calls.get(), usize::from(!before_query));
    }
}

#[test]
fn unverified_contacts_and_transport_errors_never_grant_target_authority() {
    let parsed = || parse_broadcast_pasted_recipients("123456").unwrap();
    assert!(matches!(
        verify_candidates(
            parsed(),
            |batch, _| Ok(json!([row(&batch[0], None)])),
            || Ok(()),
            || Duration::ZERO,
        ),
        Err(AppError::BroadcastImportEmpty)
    ));
    assert!(matches!(
        verify_candidates(
            parsed(),
            |_, _| Err(AppError::BroadcastImportUnavailable),
            || Ok(()),
            || Duration::ZERO,
        ),
        Err(AppError::BroadcastImportUnavailable)
    ));
}

#[test]
fn pasted_results_have_no_file_metadata_and_file_import_keeps_its_existing_wire_shape() {
    let recipients = ResolvedBroadcastRecipients {
        account_id: "account-a".into(),
        catalog: BroadcastCatalog {
            account_id: "account-a".into(),
            account_name: "Synthetic".into(),
            platform_id: "whatsapp".into(),
            catalog_id: "catalog-a".into(),
            ready: true,
            reason_code: None,
            capabilities: CatalogCapabilities::default(),
            chats: Vec::new(),
            labels: None,
        },
        recipient_ids: vec!["100@lid".into()],
        summary: ImportSummary {
            total: 1,
            accepted: 1,
            duplicates: 0,
            invalid: 0,
            unresolved: 0,
            skipped: 0,
        },
    };
    let mut expected = serde_json::to_value(&recipients).unwrap();
    assert_eq!(
        expected.as_object().unwrap().keys().collect::<Vec<_>>(),
        ["accountId", "catalog", "recipientIds", "summary"]
    );
    let file = ImportedBroadcastContacts {
        file_name: "contacts.csv".into(),
        recipients,
    };
    expected["fileName"] = json!("contacts.csv");
    assert_eq!(serde_json::to_value(file).unwrap(), expected);
}
