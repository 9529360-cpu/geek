use crate::domain::{
    error::AppError,
    translation_cache::{TranslationCacheDocument, TranslationCacheEntry},
};
use serde_json::{json, Value};

const ACCOUNT_ID: &str = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SAVED_AT: u64 = 1_700_000_000;

fn entry(index: usize, text: impl Into<String>) -> TranslationCacheEntry {
    TranslationCacheEntry {
        principal: "a".repeat(64),
        account_id: ACCOUNT_ID.into(),
        key: format!("{index:064x}"),
        saved_at: SAVED_AT,
        text: text.into(),
    }
}

fn document(entries: Vec<TranslationCacheEntry>) -> TranslationCacheDocument {
    TranslationCacheDocument {
        schema_version: 1,
        entries,
    }
}

fn wire_document() -> Value {
    serde_json::to_value(document(vec![entry(1, "Synthetic translation")])).unwrap()
}

#[test]
fn schema_one_round_trip_preserves_completed_text_exactly() {
    let text = "  合成译文 😀\nsecond line\t\"quoted\"\\\r\u{1}  ";
    let original = document(vec![entry(1, text)]);
    assert!(original.validate().is_ok());
    let bytes = serde_json::to_vec(&original).unwrap();
    let decoded: TranslationCacheDocument = serde_json::from_slice(&bytes).unwrap();
    assert!(decoded == original);
    assert_eq!(decoded.entries[0].text, text);
    assert!(decoded.validate().is_ok());
    assert!(TranslationCacheDocument::default().validate().is_ok());

    for version in [0, 2, u32::MAX] {
        let mut value = wire_document();
        value["schemaVersion"] = json!(version);
        let unsupported: TranslationCacheDocument = serde_json::from_value(value).unwrap();
        assert_eq!(unsupported.validate(), Err(AppError::StoreVersion));
    }
}

#[test]
fn wire_format_rejects_unknown_missing_and_mistyped_fields_at_each_level() {
    let mut unknown_document = wire_document();
    unknown_document["unknown"] = json!(true);
    let mut unknown_entry = wire_document();
    unknown_entry["entries"][0]["sourceText"] = json!("must not be persisted");
    for value in [unknown_document, unknown_entry] {
        assert!(serde_json::from_value::<TranslationCacheDocument>(value).is_err());
    }

    for field in ["schemaVersion", "entries"] {
        let mut value = wire_document();
        value.as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<TranslationCacheDocument>(value).is_err());
    }
    for field in ["principal", "accountId", "key", "savedAt", "text"] {
        let mut value = wire_document();
        value["entries"][0].as_object_mut().unwrap().remove(field);
        assert!(serde_json::from_value::<TranslationCacheDocument>(value).is_err());
    }

    for (field, replacement) in [("schemaVersion", json!("1")), ("entries", json!({}))] {
        let mut value = wire_document();
        value[field] = replacement;
        assert!(serde_json::from_value::<TranslationCacheDocument>(value).is_err());
    }
    for (field, replacement) in [
        ("principal", json!(1)),
        ("accountId", Value::Null),
        ("key", json!([])),
        ("savedAt", json!(-1)),
        ("savedAt", json!(1.5)),
        ("savedAt", json!("1700000000")),
        ("text", json!(false)),
    ] {
        let mut value = wire_document();
        value["entries"][0][field] = replacement;
        assert!(serde_json::from_value::<TranslationCacheDocument>(value).is_err());
    }

    let mut snake_case = wire_document();
    let account = snake_case["entries"][0]
        .as_object_mut()
        .unwrap()
        .remove("accountId")
        .unwrap();
    snake_case["entries"][0]["account_id"] = account;
    assert!(serde_json::from_value::<TranslationCacheDocument>(snake_case).is_err());
}

#[test]
fn records_require_canonical_hashes_uuid_times_and_nonblank_text() {
    for hash in [
        String::new(),
        "a".repeat(63),
        "a".repeat(65),
        "A".repeat(64),
        "g".repeat(64),
        format!("{} ", "a".repeat(63)),
        "é".repeat(32),
    ] {
        let mut bad_principal = entry(1, "translation");
        bad_principal.principal = hash.clone();
        assert_eq!(
            document(vec![bad_principal]).validate(),
            Err(AppError::StoreInvalid)
        );
        let mut bad_key = entry(1, "translation");
        bad_key.key = hash;
        assert_eq!(
            document(vec![bad_key]).validate(),
            Err(AppError::StoreInvalid)
        );
    }
    for account in [
        "".to_owned(),
        "not-a-uuid".to_owned(),
        "aaaaaaaa-bbbb-3ccc-8ddd-eeeeeeeeeeee".to_owned(),
        "00000000-0000-0000-0000-000000000000".to_owned(),
        ACCOUNT_ID.to_uppercase(),
        ACCOUNT_ID.replace('-', ""),
        format!("{{{ACCOUNT_ID}}}"),
        format!("urn:uuid:{ACCOUNT_ID}"),
    ] {
        let mut invalid = entry(1, "translation");
        invalid.account_id = account;
        assert_eq!(
            document(vec![invalid]).validate(),
            Err(AppError::StoreInvalid)
        );
    }
    for saved_at in [0, 9_007_199_254_740_992, u64::MAX] {
        let mut invalid = entry(1, "translation");
        invalid.saved_at = saved_at;
        assert_eq!(
            document(vec![invalid]).validate(),
            Err(AppError::StoreInvalid)
        );
    }
    let mut safe_limit = entry(1, "translation");
    safe_limit.saved_at = 9_007_199_254_740_991;
    assert!(document(vec![safe_limit]).validate().is_ok());
    for text in ["", " \t\r\n", "\u{2003}\u{3000}"] {
        assert_eq!(
            document(vec![entry(1, text)]).validate(),
            Err(AppError::StoreInvalid)
        );
    }
}

#[test]
fn duplicate_keys_are_rejected_even_when_the_record_claims_another_owner() {
    let first = entry(1, "first translation");
    assert!(
        document(vec![first.clone(), entry(2, "second translation")])
            .validate()
            .is_ok()
    );
    assert_eq!(
        document(vec![first.clone(), first.clone()]).validate(),
        Err(AppError::StoreInvalid)
    );
    let mut different_owner = first.clone();
    different_owner.principal = "b".repeat(64);
    different_owner.account_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeef".into();
    different_owner.text = "another owner's translation".into();
    assert_eq!(
        document(vec![first, different_owner]).validate(),
        Err(AppError::StoreInvalid)
    );
}

#[test]
fn an_entry_limit_counts_utf8_bytes_and_accepts_the_exact_boundary() {
    let boundary = "😀".repeat(32 * 1024);
    assert_eq!(boundary.len(), 128 * 1024);
    assert!(document(vec![entry(1, boundary.clone())])
        .validate()
        .is_ok());
    assert_eq!(
        document(vec![entry(1, format!("{boundary}x"))]).validate(),
        Err(AppError::StoreInvalid)
    );
}

#[test]
fn aggregate_text_limit_is_independent_of_individually_valid_entries() {
    let entries = (0..8)
        .map(|index| entry(index, "x".repeat(128 * 1024)))
        .collect();
    let mut cache = document(entries);
    assert_eq!(
        cache
            .entries
            .iter()
            .map(|row| row.text.len())
            .sum::<usize>(),
        1024 * 1024
    );
    assert!(cache.validate().is_ok());
    cache.entries.push(entry(8, "x"));
    assert_eq!(cache.validate(), Err(AppError::StoreInvalid));
}

#[test]
fn entry_count_is_bounded_even_with_tiny_translations() {
    let mut cache = document((0..256).map(|index| entry(index, "x")).collect());
    assert!(cache.validate().is_ok());
    cache.entries.push(entry(256, "x"));
    assert_eq!(cache.validate(), Err(AppError::StoreInvalid));
}

#[test]
fn escaped_json_bytes_have_their_own_exact_size_limit() {
    let limit = 2 * 1024 * 1024 - 4096;
    let mut cache = document((0..3).map(|index| entry(index, "X")).collect());
    let mut remaining = limit - serde_json::to_vec(&cache).unwrap().len();
    for row in &mut cache.entries {
        // This is a runtime control character, encoded as six JSON bytes (\u0001).
        let count = (remaining / 6).min(128 * 1024 - row.text.len());
        row.text.push_str(&"\u{1}".repeat(count));
        remaining -= count * 6;
    }
    assert!(remaining < 6);
    cache
        .entries
        .last_mut()
        .unwrap()
        .text
        .push_str(&"x".repeat(remaining));
    assert!(cache.entries.iter().all(|row| row.text.len() <= 128 * 1024));
    assert!(
        cache
            .entries
            .iter()
            .map(|row| row.text.len())
            .sum::<usize>()
            < 1024 * 1024
    );
    assert_eq!(serde_json::to_vec(&cache).unwrap().len(), limit);
    assert!(cache.validate().is_ok());

    cache.entries.last_mut().unwrap().text.push('x');
    assert!(cache.entries.iter().all(|row| row.text.len() <= 128 * 1024));
    assert_eq!(serde_json::to_vec(&cache).unwrap().len(), limit + 1);
    assert_eq!(cache.validate(), Err(AppError::StoreInvalid));
}

#[test]
fn freshness_excludes_zero_future_and_the_exact_thirty_day_expiry_without_renewal() {
    let cached = entry(1, "translation");
    let original = cached.clone();
    let ttl = 30 * 24 * 60 * 60;
    for (now, fresh) in [
        (0, false),
        (SAVED_AT - 1, false),
        (SAVED_AT, true),
        (SAVED_AT + ttl - 1, true),
        (SAVED_AT + ttl, false),
        (SAVED_AT + ttl + 1, false),
        (u64::MAX, false),
    ] {
        assert_eq!(cached.fresh(now), fresh, "now={now}");
    }
    assert!(cached == original);
}
