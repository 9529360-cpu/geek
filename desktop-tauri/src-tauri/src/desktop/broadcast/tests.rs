mod sessions {
    use crate::{desktop::platform_sessions::PlatformSessions, domain::broadcast::BroadcastIssue};

    #[test]
    fn a_new_guest_requires_its_own_load_and_the_exact_account_platform() {
        let sessions = PlatformSessions::default();
        let incarnation = sessions.created("account-a", "whatsapp");
        assert!(sessions
            .current_for_incarnation("account-a", &incarnation)
            .is_some());
        assert!(sessions
            .current_for_incarnation("account-a", "old-incarnation")
            .is_none());
        assert_eq!(
            sessions.binding("account-a", "whatsapp"),
            Err(BroadcastIssue::AccountUnavailable)
        );
        sessions.page("account-a", "unrelated-incarnation", false);
        assert!(sessions.binding("account-a", "whatsapp").is_err());
        sessions.page("account-a", &incarnation, false);
        let binding = sessions.binding("account-a", "whatsapp").unwrap();
        assert!(sessions.valid(&binding));
        assert_eq!(binding.account_id, "account-a");
        assert_eq!(binding.platform_id, "whatsapp");
        assert!(sessions.binding("account-a", "whatsapp-pure").is_err());
        assert!(sessions.binding("account-b", "whatsapp").is_err());
        let mut forged = binding.clone();
        forged.account_id = "account-b".into();
        assert!(!sessions.valid(&forged));
    }

    #[test]
    fn old_incarnation_callbacks_cannot_ready_or_invalidate_a_reopened_guest() {
        let sessions = PlatformSessions::default();
        let first = sessions.created("account-a", "whatsapp");
        sessions.page("account-a", &first, false);
        let old = sessions.binding("account-a", "whatsapp").unwrap();
        sessions.invalidate("account-a");
        let (id, token) = sessions.pending_invalidations().pop().unwrap();
        sessions.removed("account-a");
        assert!(!sessions.valid(&old));
        let second = sessions.created("account-a", "whatsapp");
        assert_ne!(first, second);
        assert!(sessions
            .current_for_incarnation("account-a", &first)
            .is_none());
        sessions.page("account-a", &first, false);
        assert!(sessions.binding("account-a", "whatsapp").is_err());
        sessions.acknowledge_invalidated(&id, &token);
        assert!(sessions.binding("account-a", "whatsapp").is_err());
        sessions.page("account-a", &second, false);
        let new = sessions.binding("account-a", "whatsapp").unwrap();
        assert_ne!(old.generation, new.generation);
        sessions.page("account-a", &first, true);
        sessions.page("account-a", &first, false);
        assert!(sessions.valid(&new));
        assert!(!sessions.valid(&old));
        assert_eq!(
            sessions.current_for_incarnation("account-a", &second),
            Some(new)
        );
        assert!(sessions
            .current_for_incarnation("account-a", &first)
            .is_none());
        assert!(sessions.pending_invalidations().is_empty());
    }

    #[test]
    fn navigation_and_reload_revoke_only_that_accounts_frozen_generation() {
        let sessions = PlatformSessions::default();
        let a = sessions.created("account-a", "whatsapp");
        let b = sessions.created("account-b", "whatsapp-pure");
        sessions.page("account-a", &a, false);
        sessions.page("account-b", &b, false);
        let original = sessions.binding("account-a", "whatsapp").unwrap();
        let other = sessions.binding("account-b", "whatsapp-pure").unwrap();
        sessions.page("account-a", &a, true);
        assert!(!sessions.valid(&original));
        assert!(sessions.binding("account-a", "whatsapp").is_err());
        assert!(sessions.valid(&other));
        sessions.page("account-a", &a, false);
        let navigated = sessions.binding("account-a", "whatsapp").unwrap();
        assert_ne!(navigated.generation, original.generation);
        sessions.invalidate("account-a");
        assert!(!sessions.valid(&navigated));
        assert!(sessions.valid(&other));
        sessions.page("account-a", &a, false);
        assert_eq!(
            sessions.binding("account-a", "whatsapp"),
            Err(BroadcastIssue::AccountUnavailable)
        );
        let (id, token) = sessions.pending_invalidations().pop().unwrap();
        sessions.acknowledge_invalidated(&id, &token);
        let reloaded = sessions.binding("account-a", "whatsapp").unwrap();
        assert_ne!(reloaded.generation, navigated.generation);
        assert!(!sessions.valid(&original));
    }

    #[test]
    fn invalidation_queue_retains_events_until_ack_even_when_no_guest_is_open() {
        let sessions = PlatformSessions::default();
        sessions.invalidate("closed-account");
        sessions.invalidate("closed-account");
        sessions.invalidate("another-account");
        let mut pending = sessions.pending_invalidations();
        pending.sort();
        assert_eq!(
            pending
                .iter()
                .map(|(id, _)| id.as_str())
                .collect::<Vec<_>>(),
            vec!["another-account", "closed-account"]
        );
        let mut again = sessions.pending_invalidations();
        again.sort();
        assert_eq!(pending, again);
        sessions.acknowledge_invalidated(&pending[0].0, &pending[0].1);
        assert_eq!(sessions.pending_invalidations(), vec![pending[1].clone()]);
        sessions.acknowledge_invalidated(&pending[1].0, &pending[1].1);
        assert!(sessions.pending_invalidations().is_empty());
    }

    #[test]
    fn an_old_ack_cannot_clear_a_new_close_or_allow_a_new_binding() {
        let sessions = PlatformSessions::default();
        let incarnation = sessions.created("account-a", "whatsapp");
        sessions.page("account-a", &incarnation, false);
        let original = sessions.binding("account-a", "whatsapp").unwrap();
        sessions.invalidate("account-a");
        let (_, old_token) = sessions.pending_invalidations().pop().unwrap();
        sessions.invalidate("account-a");
        let (_, new_token) = sessions.pending_invalidations().pop().unwrap();
        assert_ne!(old_token, new_token);
        sessions.page("account-a", &incarnation, false);
        sessions.acknowledge_invalidated("account-a", &old_token);
        assert_eq!(
            sessions.pending_invalidations(),
            vec![("account-a".into(), new_token.clone())]
        );
        assert_eq!(
            sessions.binding("account-a", "whatsapp"),
            Err(BroadcastIssue::AccountUnavailable)
        );
        assert!(!sessions.valid(&original));
        sessions.acknowledge_invalidated("account-a", &new_token);
        let replacement = sessions.binding("account-a", "whatsapp").unwrap();
        assert_ne!(original.generation, replacement.generation);
        assert!(sessions.valid(&replacement));
        assert!(sessions.pending_invalidations().is_empty());
    }
}

// This parent module includes native Tauri composition. The portable harness runs
// the same sessions tests above; Windows CI runs these ingress tests as well.
#[cfg(windows)]
mod ingress {
    use super::super::*;
    use serde_json::{json, Value};

    fn contact(id: &str) -> Value {
        json!({"id": id, "name": "显示名 😀", "realName": "真实姓名", "kind": "contact"})
    }

    fn catalog_value() -> Value {
        json!({
            "capabilities": {
                "text": true, "scheduled": true, "vcards": true,
                "tagAll": true, "attachments": false
            },
            "chats": [contact("12025550101@c.us"), contact("100000000000001@lid"), {
                "id": "12025550102-1234567890@g.us", "name": "群组", "realName": "", "kind": "group"
            }]
        })
    }

    fn create_value() -> Value {
        json!({
            "id": "11111111-1111-4111-8111-111111111111",
            "accountId": "22222222-2222-4222-8222-222222222222",
            "catalogId": "33333333-3333-4333-8333-333333333333",
            "recipientIds": ["12025550101@c.us", "100000000000001@lid"],
            "vcardIds": ["12025550103@c.us", "12025550104@c.us"],
            "message": "Hello %nr", "tagAll": false,
            "intervalMin": 5, "intervalMax": 10, "scheduledAt": null
        })
    }

    fn authoritative_catalog() -> BroadcastCatalog {
        let mut value = catalog_value();
        value["chats"][0]["name"] = json!("Account-scoped Alice");
        value["chats"][1]["name"] = json!("Account-scoped Bob");
        let chats = value["chats"].as_array_mut().unwrap();
        chats.push(contact("12025550103@c.us"));
        chats.push(contact("12025550104@c.us"));
        let native = native_catalog(value).unwrap();
        BroadcastCatalog {
            account_id: "22222222-2222-4222-8222-222222222222".into(),
            account_name: "Catalog account".into(),
            platform_id: "whatsapp".into(),
            catalog_id: "33333333-3333-4333-8333-333333333333".into(),
            ready: true,
            reason_code: None,
            capabilities: native.capabilities,
            chats: native.chats,
            labels: native.labels,
        }
    }

    fn frozen_job() -> BroadcastJob {
        let input: CreateBroadcast = serde_json::from_value(create_value()).unwrap();
        let account = BroadcastAccount {
            id: input.account_id.clone(),
            name: "Frozen account name".into(),
            platform_id: "whatsapp".into(),
            capabilities: BroadcastCapabilities {
                text: true,
                tag_all: true,
                vcards: true,
                attachments: true,
            },
        };
        let draft = BroadcastDraft {
            id: input.id,
            account_id: input.account_id,
            targets: input
                .recipient_ids
                .into_iter()
                .map(|id| BroadcastTarget {
                    id,
                    name: "Frozen name".into(),
                    real_name: "Frozen real name".into(),
                })
                .collect(),
            vcards: input
                .vcard_ids
                .into_iter()
                .map(|id| BroadcastVcard {
                    id,
                    name: "Frozen card name".into(),
                })
                .collect(),
            message: input.message,
            tag_all: input.tag_all,
            attachments: Vec::new(),
            interval_min_ms: 5_000,
            interval_max_ms: 10_000,
            scheduled_at: None,
        };
        BroadcastJob::from_draft(&account, draft, 1_000)
    }

    #[test]
    fn catalog_preserves_names_but_only_accepts_supported_account_chat_addresses() {
        let mut value = catalog_value();
        let chats = value["chats"].as_array_mut().unwrap();
        for id in [
            "status@broadcast",
            "123@newsletter",
            "123@s.whatsapp.net",
            "@c.us",
            "-123@c.us",
            "123 @c.us",
            "１２３@c.us",
            "123@c.us@lid",
            "123-456@c.us",
            "123@g.us",
            "1234567890123456789012345678901@lid",
        ] {
            chats.push(contact(id));
        }
        let parsed = native_catalog(value).unwrap();
        assert_eq!(parsed.chats.len(), 3);
        assert_eq!(parsed.chats[0].name, "显示名 😀");
        assert_eq!(parsed.chats[0].real_name, "真实姓名");
        assert_eq!(parsed.chats[1].id, "100000000000001@lid");
        assert!(parsed.chats[2].kind == ChatKind::Group);
        assert!(supported_id("120363123456789@g.us", ChatKind::Group));
        assert!(!supported_id("123-456-789@g.us", ChatKind::Group));
        assert!(!supported_id(
            "123-123456789012345678901@g.us",
            ChatKind::Group
        ));
    }

    #[test]
    fn native_catalog_rejects_coercive_capabilities_and_untrusted_extra_fields() {
        for field in ["text", "scheduled", "vcards", "tagAll", "attachments"] {
            for wrong in [json!("false"), json!(0), Value::Null, json!([])] {
                let mut value = catalog_value();
                value["capabilities"][field] = wrong;
                assert!(matches!(
                    native_catalog(value),
                    Err(AppError::BroadcastUnavailable)
                ));
            }
        }
        for (scope, field, wrong) in [
            ("root", "profilePath", json!("untrusted-path")),
            ("capabilities", "script", json!("untrusted-script")),
            ("chat", "accountId", json!("other-account")),
            ("chat", "id", json!(12025550101_u64)),
            ("chat", "name", json!(["name"])),
            ("chat", "realName", Value::Null),
            ("chat", "kind", json!("newsletter")),
        ] {
            let mut value = catalog_value();
            match scope {
                "root" => value[field] = wrong,
                "capabilities" => value["capabilities"][field] = wrong,
                _ => value["chats"][0][field] = wrong,
            }
            assert!(matches!(
                native_catalog(value),
                Err(AppError::BroadcastUnavailable)
            ));
        }
    }

    #[test]
    fn catalog_sanitizes_display_names_but_rejects_duplicate_ids_and_unsupported_payloads() {
        let mut duplicate = catalog_value();
        duplicate["chats"]
            .as_array_mut()
            .unwrap()
            .push(contact("12025550101@c.us"));
        assert!(native_catalog(duplicate).is_err());
        for field in ["name", "realName"] {
            for (original, expected) in [
                ("😀".repeat(257), "😀".repeat(256)),
                ("line\ncontrol".into(), "linecontrol".into()),
                ("tab\tcontrol".into(), "tabcontrol".into()),
            ] {
                let mut value = catalog_value();
                value["chats"][0][field] = json!(original);
                let parsed = native_catalog(value).unwrap();
                let sanitized = if field == "name" {
                    &parsed.chats[0].name
                } else {
                    &parsed.chats[0].real_name
                };
                assert_eq!(sanitized, &expected);
                assert_eq!(parsed.chats.len(), 3);
            }
        }
        let mut attachments = catalog_value();
        attachments["capabilities"]["attachments"] = json!(true);
        assert!(
            native_catalog(attachments)
                .unwrap()
                .capabilities
                .attachments
        );
        let mut oversized = catalog_value();
        oversized["chats"] = json!(vec![contact("status@broadcast"); 20_001]);
        assert!(native_catalog(oversized).is_err());
    }

    #[test]
    fn create_ipc_rejects_wide_types_and_renderer_supplied_names_or_native_paths() {
        assert!(serde_json::from_value::<CreateBroadcast>(create_value()).is_ok());
        for (field, wrong) in [
            ("recipientIds", json!("12025550101@c.us")),
            ("recipientIds", json!([123])),
            (
                "vcardIds",
                json!([{"id":"12025550103@c.us","name":"forged"}]),
            ),
            ("message", json!(false)),
            ("tagAll", json!("false")),
            ("intervalMin", json!(5.5)),
            ("intervalMin", json!(-1)),
            ("intervalMax", json!("10")),
            ("scheduledAt", json!("10000")),
            (
                "targets",
                json!([{"id":"12025550101@c.us","name":"forged"}]),
            ),
            ("files", json!([{"path":"untrusted-path"}])),
            ("generation", json!("renderer-generation")),
        ] {
            let mut value = create_value();
            value[field] = wrong;
            assert!(
                serde_json::from_value::<CreateBroadcast>(value).is_err(),
                "{field}"
            );
        }
    }

    #[test]
    fn create_validates_counts_identifiers_and_interval_before_arithmetic() {
        let valid: CreateBroadcast = serde_json::from_value(create_value()).unwrap();
        assert!(validate_create(&valid).is_ok());
        for (field, wrong) in [
            ("id", json!("not-a-uuid")),
            ("accountId", json!("not-an-account-uuid")),
            ("recipientIds", json!([])),
            ("recipientIds", json!(vec!["12025550101@c.us"; 2_001])),
            ("vcardIds", json!(vec!["12025550103@c.us"; 101])),
            ("message", json!("x".repeat(32_769))),
            ("intervalMin", json!(4)),
            ("intervalMin", json!(11)),
            ("intervalMin", json!(u64::MAX)),
            ("intervalMax", json!(61)),
            ("intervalMax", json!(u64::MAX)),
        ] {
            let mut value = create_value();
            value[field] = wrong;
            let input: CreateBroadcast = serde_json::from_value(value).unwrap();
            assert!(
                matches!(validate_create(&input), Err(AppError::BroadcastInvalid)),
                "{field}"
            );
        }
    }

    #[test]
    fn frozen_draft_uses_only_catalog_names_and_preserves_requested_delivery_order() {
        let catalog = authoritative_catalog();
        let mut value = create_value();
        value["recipientIds"] = json!(["100000000000001@lid", "12025550101@c.us"]);
        let input: CreateBroadcast = serde_json::from_value(value).unwrap();
        let frozen = frozen_draft(&catalog, &input).unwrap();
        assert_eq!(frozen.account_id, catalog.account_id);
        assert_eq!(frozen.targets[0].id, "100000000000001@lid");
        assert_eq!(frozen.targets[0].name, "Account-scoped Bob");
        assert_eq!(frozen.targets[1].name, "Account-scoped Alice");
        assert_eq!(frozen.targets[0].real_name, "真实姓名");
        assert_eq!(frozen.vcards[0].id, "12025550103@c.us");
        assert_eq!(frozen.vcards[0].name, "显示名 😀");
        assert_eq!(
            (frozen.interval_min_ms, frozen.interval_max_ms),
            (5_000, 10_000)
        );
        assert_eq!(frozen.message, "Hello %nr");
    }

    #[test]
    fn frozen_draft_refuses_other_accounts_unknown_recipients_group_vcards_and_absent_capabilities()
    {
        for (field, wrong) in [
            ("recipientIds", json!(["999999999@c.us"])),
            ("vcardIds", json!(["12025550102-1234567890@g.us"])),
        ] {
            let mut value = create_value();
            value[field] = wrong;
            let input: CreateBroadcast = serde_json::from_value(value).unwrap();
            assert!(matches!(
                frozen_draft(&authoritative_catalog(), &input),
                Err(AppError::BroadcastInvalid)
            ));
        }
        let input: CreateBroadcast = serde_json::from_value(create_value()).unwrap();
        let mut other = authoritative_catalog();
        other.account_id = "44444444-4444-4444-8444-444444444444".into();
        assert!(matches!(
            frozen_draft(&other, &input),
            Err(AppError::BroadcastUnavailable)
        ));
        let mut unready = authoritative_catalog();
        unready.ready = false;
        assert!(matches!(
            frozen_draft(&unready, &input),
            Err(AppError::BroadcastUnavailable)
        ));
        for capability in ["scheduled", "tagAll", "vcards"] {
            let mut catalog = authoritative_catalog();
            let mut value = create_value();
            match capability {
                "scheduled" => {
                    catalog.capabilities.scheduled = false;
                    value["scheduledAt"] = json!(10_000);
                }
                "tagAll" => {
                    catalog.capabilities.tag_all = false;
                    value["tagAll"] = json!(true);
                }
                _ => catalog.capabilities.vcards = false,
            }
            let input: CreateBroadcast = serde_json::from_value(value).unwrap();
            assert!(
                matches!(
                    frozen_draft(&catalog, &input),
                    Err(AppError::BroadcastUnsupported)
                ),
                "{capability}"
            );
        }
    }

    #[test]
    fn duplicate_create_matches_frozen_intent_independently_of_catalog_and_display_names() {
        let mut existing = frozen_job();
        let mut value = create_value();
        value["catalogId"] = json!("expired-catalog-replaced-by-refresh");
        let retry: CreateBroadcast = serde_json::from_value(value).unwrap();
        assert!(same_intent(&existing, &retry));
        existing.account_name = "Renamed since creation".into();
        existing.targets[0].name = "Changed display name".into();
        existing.targets[0].real_name = "Changed real name".into();
        existing.vcards[0].name = "Changed card label".into();
        assert!(same_intent(&existing, &retry));
        for (field, changed) in [
            ("accountId", json!("44444444-4444-4444-8444-444444444444")),
            ("message", json!("Hello %nr ")),
            ("tagAll", json!(true)),
            ("intervalMin", json!(6)),
            ("intervalMax", json!(11)),
            ("scheduledAt", json!(5000)),
            (
                "recipientIds",
                json!(["100000000000001@lid", "12025550101@c.us"]),
            ),
            ("recipientIds", json!(["12025550101@c.us"])),
            ("vcardIds", json!(["12025550104@c.us", "12025550103@c.us"])),
        ] {
            let mut value = create_value();
            value[field] = changed;
            let different: CreateBroadcast = serde_json::from_value(value).unwrap();
            assert!(!same_intent(&existing, &different), "{field}");
        }
    }
}
