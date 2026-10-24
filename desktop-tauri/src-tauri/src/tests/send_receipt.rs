use super::send_intent_support::{fixture, next};
use crate::{
    application::send_intent::{Admission, SendIntents},
    domain::{
        error::{AppError, Result},
        send_intent::{SendOutcome, SendState},
        send_receipt::SendReceipt,
    },
};
use serde_json::{json, Value};

const GENERATION: &str = "00000000-0000-4000-8000-000000000001";
const ID: &str = "00000000-0000-4000-8000-000000000002";
const PERMIT: &str = "00000000-0000-4000-8000-000000000003";

fn proven() -> Value {
    json!({
        "pending": false,
        "value": { "status": "notSubmitted", "code": "SEND_INTENT_UNSUPPORTED" },
        "precommit": {
            "kind": "telegramK", "generation": GENERATION, "id": ID,
            "attempt": 1, "permit": PERMIT
        }
    })
}

fn resolve(value: Value, platform: &str) -> Result<Option<SendOutcome>> {
    serde_json::from_value::<SendReceipt>(value)
        .unwrap()
        .resolve(platform, GENERATION, ID, 1, PERMIT)
}

#[test]
fn only_a_k_proof_for_the_exact_native_attempt_can_reopen_submission() {
    assert_eq!(
        resolve(proven(), "telegram-k"),
        Ok(Some(SendOutcome::NotSubmitted {
            issue: AppError::SendIntentUnsupported,
        }))
    );
    for platform in [
        "whatsapp",
        "whatsapp-pure",
        "telegram",
        "telegram-a",
        "telegramK",
        "",
    ] {
        assert_eq!(
            resolve(proven(), platform),
            Err(AppError::SendIntentUncertain)
        );
    }
    for (field, foreign) in [
        ("generation", json!(PERMIT)),
        ("id", json!(GENERATION)),
        ("attempt", json!(2)),
        ("permit", json!(ID)),
    ] {
        let mut candidate = proven();
        candidate["precommit"][field] = foreign;
        assert_eq!(
            resolve(candidate, "telegram-k"),
            Err(AppError::SendIntentUncertain),
            "a mismatched {field} must not authorize this attempt"
        );
    }
}

#[test]
fn unknown_or_partial_proofs_and_untrusted_error_booleans_cannot_decode() {
    let mut candidates = Vec::new();
    for field in ["kind", "generation", "id", "attempt", "permit"] {
        let mut value = proven();
        value["precommit"].as_object_mut().unwrap().remove(field);
        candidates.push(value);
    }
    for proof in [
        json!(true),
        json!([]),
        json!({ "submitted": false }),
        json!({ "kind": "telegram-k", "generation": GENERATION, "id": ID, "attempt": 1, "permit": PERMIT }),
    ] {
        let mut value = proven();
        value["precommit"] = proof;
        candidates.push(value);
    }
    for (field, foreign) in [
        ("attempt", json!(-1)),
        ("attempt", json!(1.5)),
        ("attempt", json!("1")),
        ("generation", json!(null)),
        ("id", json!(5)),
        ("permit", json!(false)),
        ("accountId", json!(ID)),
    ] {
        let mut value = proven();
        value["precommit"][field] = foreign;
        candidates.push(value);
    }
    let mut envelope = proven();
    envelope["submitted"] = json!(false);
    candidates.push(envelope);
    let mut outcome = proven();
    outcome["value"]["submitted"] = json!(false);
    candidates.push(outcome);
    for value in candidates {
        assert!(serde_json::from_value::<SendReceipt>(value).is_err());
    }
}

#[test]
fn absent_proof_and_fallback_mailboxes_remain_uncertain_after_commit() {
    for value in [
        json!({ "pending": false, "value": { "status": "notSubmitted", "code": "SEND_INTENT_STATE" } }),
        json!({ "pending": false, "value": { "status": "notSubmitted", "code": "SEND_INTENT_UNSUPPORTED" } }),
        json!({ "pending": false, "value": { "status": "notSubmitted", "code": "SEND_INTENT_UNSUPPORTED" },
            "precommit": null }),
        json!({ "pending": false }),
        json!({ "pending": true, "value": { "status": "notSubmitted", "code": "SEND_INTENT_UNSUPPORTED" } }),
    ] {
        assert_eq!(
            resolve(value, "telegram-k"),
            Err(AppError::SendIntentUncertain)
        );
    }
}

#[test]
fn pending_and_terminal_receipts_preserve_the_existing_protocol_without_proof() {
    assert_eq!(resolve(json!({ "pending": true }), "whatsapp"), Ok(None));
    for outcome in [
        SendOutcome::Confirmed {
            receipt: "tg:101:700".into(),
            draft_cleared: true,
        },
        SendOutcome::Uncertain {
            issue: AppError::SendIntentUncertain,
        },
    ] {
        let value = json!({ "pending": false, "value": outcome });
        assert_eq!(resolve(value.clone(), "telegram-k"), Ok(Some(outcome)));
        let mut contradictory = value;
        contradictory["precommit"] = proven()["precommit"].clone();
        assert_eq!(
            resolve(contradictory, "telegram-k"),
            Err(AppError::SendIntentUncertain)
        );
    }
    for value in [
        json!({ "pending": true, "precommit": proven()["precommit"] }),
        json!({ "pending": false, "precommit": proven()["precommit"] }),
    ] {
        assert_eq!(
            resolve(value, "telegram-k"),
            Err(AppError::SendIntentUncertain)
        );
    }
}

#[test]
fn even_matching_proofs_require_canonical_bounded_native_identity() {
    for field in ["generation", "id", "permit"] {
        for invalid in ["", "forged", "00000000-0000-1000-8000-000000000001"] {
            let mut value = proven();
            value["precommit"][field] = json!(invalid);
            let receipt: SendReceipt = serde_json::from_value(value).unwrap();
            assert_eq!(
                receipt.resolve(
                    "telegram-k",
                    if field == "generation" {
                        invalid
                    } else {
                        GENERATION
                    },
                    if field == "id" { invalid } else { ID },
                    1,
                    if field == "permit" { invalid } else { PERMIT },
                ),
                Err(AppError::SendIntentUncertain)
            );
        }
    }
    for attempt in [0, 10_001, u32::MAX] {
        let mut value = proven();
        value["precommit"]["attempt"] = json!(attempt);
        let receipt: SendReceipt = serde_json::from_value(value).unwrap();
        assert_eq!(
            receipt.resolve("telegram-k", GENERATION, ID, attempt, PERMIT),
            Err(AppError::SendIntentUncertain)
        );
    }
}

#[test]
fn scoped_zero_submission_keeps_paid_output_in_the_original_send_owner() {
    for has_proof in [true, false] {
        let mut owner = SendIntents::new();
        let (mut account, mut binding, session, mut request) = fixture(true);
        account.platform_id = "telegram-k".into();
        binding.platform_id = account.platform_id.clone();
        binding.generation = GENERATION.into();
        request.id = ID.into();
        request.chat_id = "tg:101".into();
        let Admission::Start(ticket) = owner.admit(account, binding, session, request).unwrap()
        else {
            panic!("the synthetic K intent must start");
        };
        owner
            .remember_output(&ticket, "Already paid output".into())
            .unwrap();
        assert!(owner.begin_commit(&ticket).unwrap());
        let mut value = proven();
        if !has_proof {
            value.as_object_mut().unwrap().remove("precommit");
        }
        let outcome = resolve(value, "telegram-k")
            .unwrap_or_else(|issue| Some(SendOutcome::Uncertain { issue }))
            .unwrap();
        let status = owner.settle(&ticket, outcome).unwrap();
        if has_proof {
            assert_eq!(status.state, SendState::Failed);
            assert!(status.retryable);
            let retry = next(&mut owner, &ticket);
            assert_eq!(retry.request.id, ID);
            assert_eq!(retry.request.attempt, 2);
            assert_eq!(retry.output.as_deref(), Some("Already paid output"));
            assert!(owner.begin_commit(&retry).unwrap());
            assert!(!owner.begin_commit(&retry).unwrap());
        } else {
            assert_eq!(status.state, SendState::Uncertain);
            assert!(!status.retryable);
            assert!(!owner.begin_commit(&ticket).unwrap());
        }
    }
}
