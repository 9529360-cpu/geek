use super::broadcast_support::*;
use crate::domain::{
    broadcast::*, broadcast_render::render, broadcast_validation::validate_draft, error::AppError,
};

#[test]
fn validation_checks_owner_capability_names_and_encoding_before_persistence() {
    let (service, repository, _) = setup();
    let owner = account("Validation");
    let input = draft(&owner, 1);
    let mut wrong = input.clone();
    wrong.account_id = account("Other").id;
    assert!(matches!(
        service.submit(owner.clone(), wrong, NOW),
        Err(AppError::BroadcastInvalid)
    ));
    let mut unnamed = input.clone();
    unnamed.targets[0].name.clear();
    unnamed.targets[0].real_name.clear();
    assert!(matches!(
        service.submit(owner.clone(), unnamed, NOW),
        Err(AppError::BroadcastNameMissing)
    ));
    let mut id_as_name = input.clone();
    id_as_name.targets[0].name = id_as_name.targets[0].id.clone();
    assert!(matches!(
        service.submit(owner.clone(), id_as_name, NOW),
        Err(AppError::BroadcastNameMissing)
    ));
    let mut unavailable = owner.clone();
    unavailable.capabilities.text = false;
    assert!(matches!(
        service.submit(unavailable, input.clone(), NOW),
        Err(AppError::BroadcastUnsupported)
    ));
    let mut telegram = owner.clone();
    telegram.platform_id = "telegram-z".into();
    assert!(matches!(
        service.submit(telegram, input.clone(), NOW),
        Err(AppError::BroadcastUnsupported)
    ));
    let mut over = input.clone();
    over.message = "😀".repeat(5_001);
    assert!(matches!(
        service.submit(owner.clone(), over, NOW),
        Err(AppError::BroadcastInvalid)
    ));
    let mut exact = input.clone();
    exact.message = "😀".repeat(5_000);
    assert!(validate_draft(&owner, &exact).is_ok());
    let mut expanded = input.clone();
    expanded.message = format!("{}%nc", "x".repeat(9_999));
    assert!(matches!(
        service.submit(owner.clone(), expanded, NOW),
        Err(AppError::BroadcastInvalid)
    ));
    let mut duplicate = input.clone();
    duplicate.targets.push(duplicate.targets[0].clone());
    assert!(service.submit(owner.clone(), duplicate, NOW).is_err());
    let mut empty_tag_all = input.clone();
    empty_tag_all.message = "  ".into();
    empty_tag_all.tag_all = true;
    empty_tag_all.vcards.push(BroadcastVcard {
        id: "card@c.us".into(),
        name: "Card".into(),
    });
    assert!(matches!(
        service.submit(owner.clone(), empty_tag_all, NOW),
        Err(AppError::BroadcastInvalid)
    ));
    let mut attachment: serde_json::Value = serde_json::to_value(&input).unwrap();
    attachment["files"] = serde_json::json!([{"path":"synthetic"}]);
    assert!(serde_json::from_value::<BroadcastDraft>(attachment).is_err());
    assert_eq!(repository.0.lock().unwrap().successful_writes, 0);
}

#[test]
fn personalization_preserves_unicode_newlines_real_names_and_local_hour_boundaries() {
    let target = BroadcastTarget {
        id: "synthetic@c.us".into(),
        name: "显示名".into(),
        real_name: "真实名".into(),
    };
    let template = "%NC\n%Nr\t%SA { A | B | C }";
    assert_eq!(
        render(template, &target, 11, |_| 0).unwrap(),
        "显示名\n真实名\t早上好 A"
    );
    assert_eq!(
        render(template, &target, 12, |_| 1).unwrap(),
        "显示名\n真实名\t下午好 B"
    );
    assert_eq!(
        render(template, &target, 18, |_| 2).unwrap(),
        "显示名\n真实名\t晚上好 C"
    );
    assert!(render(template, &target, 24, |_| 0).is_err());
    let fallback = BroadcastTarget {
        real_name: String::new(),
        ..target
    };
    assert_eq!(render("%nr", &fallback, 0, |_| 0).unwrap(), "显示名");
    assert_eq!(
        render("{single} {x|} {{A|B}}", &fallback, 0, |_| 1).unwrap(),
        "{single} {x|} {B}"
    );
}

#[test]
fn every_variant_is_validated_even_when_a_short_branch_could_be_chosen() {
    let owner = account("Variant");
    let mut input = draft(&owner, 1);
    input.message = format!("{}{{x|%nc}}", "a".repeat(9_998));
    assert!(matches!(
        validate_draft(&owner, &input),
        Err(AppError::BroadcastInvalid)
    ));
    input.message = "{Hello|%nr}".into();
    input.targets[0].name.clear();
    input.targets[0].real_name.clear();
    assert!(matches!(
        validate_draft(&owner, &input),
        Err(AppError::BroadcastNameMissing)
    ));
    input.message = "Plain text".into();
    assert!(validate_draft(&owner, &input).is_ok());
}
