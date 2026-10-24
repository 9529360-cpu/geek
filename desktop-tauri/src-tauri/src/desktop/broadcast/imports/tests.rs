use super::*;
use std::cell::Cell;

fn parse_broadcast_import(bytes: &[u8]) -> Result<BroadcastImportCandidates> {
    super::parse_broadcast_import(bytes, "whatsapp")
}

fn resolved_batch(
    value: serde_json::Value,
    candidates: &[String],
) -> Result<Vec<Option<CatalogChat>>> {
    super::resolved_batch(value, candidates, "whatsapp")
}

fn verify_candidates(
    parsed: BroadcastImportCandidates,
    call: impl FnMut(&[String], Duration) -> Result<serde_json::Value>,
    check: impl Fn() -> Result<()>,
    elapsed: impl Fn() -> Duration,
) -> Result<(Vec<CatalogChat>, ImportSummary)> {
    super::verify_candidates(parsed, "whatsapp", call, check, elapsed)
}

fn row(candidate: &str, id: Option<&str>) -> serde_json::Value {
    json!({
        "candidate": candidate,
        "chat": id.map(|id| json!({
            "id": id, "kind": "contact", "name": "Loaded contact", "realName": ""
        }))
    })
}

#[test]
fn telegram_resolution_is_platform_bound_and_cannot_retarget_explicit_peer_ids() {
    let phone: Vec<String> = vec!["12025550101".into()];
    let value = json!([row(&phone[0], Some("tg:101"))]);
    assert_eq!(
        super::resolved_batch(value.clone(), &phone, "telegram-k").unwrap()[0]
            .as_ref()
            .unwrap()
            .id,
        "tg:101"
    );
    assert!(super::resolved_batch(value, &phone, "whatsapp").is_err());
    for id in ["101@c.us", "tg:-202", "tg:0", "tg:01"] {
        assert!(
            super::resolved_batch(json!([row(&phone[0], Some(id))]), &phone, "telegram-k").is_err()
        );
    }
    let explicit = vec!["tg:101".into()];
    assert!(super::resolved_batch(
        json!([row("tg:101", Some("tg:102"))]),
        &explicit,
        "telegram-k"
    )
    .is_err());
    assert!(super::resolved_batch(
        json!([row("tg:101", Some("tg:101"))]),
        &explicit,
        "telegram-k"
    )
    .is_ok());
}

#[test]
fn telegram_phone_aliases_deduplicate_after_exact_resolution_without_changing_accounting() {
    let parsed =
        parse_broadcast_pasted_recipients("12025550101\n12025550102\n12025550103").unwrap();
    let (contacts, summary) = super::verify_candidates(
        parsed,
        "telegram-k",
        |batch, _| {
            Ok(serde_json::Value::Array(
                batch
                    .iter()
                    .map(|candidate| {
                        row(
                            candidate,
                            if candidate.ends_with('3') {
                                None
                            } else {
                                Some("tg:101")
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
    assert_eq!(contacts.len(), 1);
    assert_eq!(contacts[0].id, "tg:101");
    assert_eq!(
        serde_json::to_value(summary).unwrap(),
        json!({
            "total": 3, "accepted": 1, "duplicates": 1, "invalid": 0, "unresolved": 1, "skipped": 0
        })
    );
}

#[test]
fn non_self_contacts_require_one_canonical_telegram_self_or_a_verified_whatsapp_namespace() {
    let own = vec!["tg:90".into()];
    assert!(non_self_contact("telegram-k", "tg:101", &own));
    for id in ["tg:90", "tg:-202", "101@c.us"] {
        assert!(!non_self_contact("telegram-k", id, &own));
    }
    for ids in [
        vec![],
        vec!["90@c.us".into()],
        vec!["tg:90".into(), "tg:91".into()],
    ] {
        assert!(!non_self_contact("telegram-k", "tg:101", &ids));
    }
    assert!(!non_self_contact("whatsapp", "tg:101", &own));
    assert!(non_self_contact("whatsapp", "101@lid", &["90@lid".into()]));
    assert!(!non_self_contact(
        "whatsapp",
        "101@lid",
        &["90@c.us".into()]
    ));
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
