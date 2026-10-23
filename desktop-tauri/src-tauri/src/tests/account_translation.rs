use super::doubles::fixture;
use crate::domain::{error::AppError, translation::TranslationPolicy};

fn policy(language: &str) -> TranslationPolicy {
    TranslationPolicy {
        message_target: language.into(),
        font_size: 15,
        ..TranslationPolicy::default()
    }
}

#[test]
fn failed_translation_save_rolls_back_policy_revision_and_native_account_state() {
    let (mut workspace, repository, host, a, b) = fixture();
    workspace.activate(&a).unwrap();
    let unchanged_account = workspace.snapshot().accounts[0].clone();
    let before = serde_json::to_value(workspace.snapshot()).unwrap();
    let stored = serde_json::to_value(&repository.0.lock().unwrap().document).unwrap();
    let calls = host.0.lock().unwrap().calls.clone();
    let saves = repository.0.lock().unwrap().saves;
    repository.0.lock().unwrap().fail_save = true;
    assert!(matches!(
        workspace.update_translation(&b, None, Some(policy("it")), 0),
        Err(AppError::StoreIo)
    ));
    assert_eq!(serde_json::to_value(workspace.snapshot()).unwrap(), before);
    assert_eq!(
        serde_json::to_value(&repository.0.lock().unwrap().document).unwrap(),
        stored
    );
    assert_eq!(repository.0.lock().unwrap().saves, saves);
    assert_eq!(host.0.lock().unwrap().calls, calls);
    repository.0.lock().unwrap().fail_save = false;
    let accepted = workspace
        .update_translation(&b, None, Some(policy("it")), 0)
        .unwrap();
    assert_eq!(accepted.accounts[1].translation.global, policy("it"));
    assert_eq!(accepted.accounts[1].translation.revision, 1);
    assert_eq!(accepted.accounts[0], unchanged_account);
    assert_eq!(accepted.active_id, Some(a));
    assert_eq!(host.0.lock().unwrap().calls, calls);
    assert_eq!(repository.0.lock().unwrap().saves, saves + 1);
}

#[test]
fn revisions_prevent_lost_updates_across_global_and_chat_settings_without_cross_account_conflicts()
{
    let (mut workspace, repository, host, a, b) = fixture();
    let chat = "12025550123@c.us";
    let calls = host.0.lock().unwrap().calls.clone();
    let first = workspace
        .update_translation(&a, None, Some(policy("it")), 0)
        .unwrap();
    let stored = serde_json::to_value(&repository.0.lock().unwrap().document).unwrap();
    let saves = repository.0.lock().unwrap().saves;
    assert!(matches!(
        workspace.update_translation(&a, Some(chat), Some(policy("fr")), 0),
        Err(AppError::TranslationSettingsConflict)
    ));
    assert_eq!(
        serde_json::to_value(workspace.snapshot()).unwrap(),
        serde_json::to_value(&first).unwrap()
    );
    assert_eq!(
        serde_json::to_value(&repository.0.lock().unwrap().document).unwrap(),
        stored
    );
    assert_eq!(repository.0.lock().unwrap().saves, saves);
    let other = workspace
        .update_translation(&b, Some(chat), Some(policy("es")), 0)
        .unwrap();
    assert_eq!(other.accounts[0], first.accounts[0]);
    assert_eq!(other.accounts[1].translation.revision, 1);
    let both = workspace
        .update_translation(&a, Some(chat), Some(policy("fr")), 1)
        .unwrap();
    assert_eq!(both.accounts[1], other.accounts[1]);
    assert_eq!(both.accounts[0].translation.global, policy("it"));
    assert_eq!(both.accounts[0].translation.chats[chat], policy("fr"));
    assert_eq!(both.accounts[0].translation.revision, 2);
    assert_eq!(both.accounts[1].translation.chats[chat], policy("es"));
    assert_eq!(host.0.lock().unwrap().calls, calls);
}

#[test]
fn failed_chat_reset_preserves_the_override_and_can_retry_with_the_same_revision() {
    let (mut workspace, repository, _, a, _) = fixture();
    let chat = "12025550123@c.us";
    workspace
        .update_translation(&a, None, Some(policy("it")), 0)
        .unwrap();
    let before = workspace
        .update_translation(&a, Some(chat), Some(policy("fr")), 1)
        .unwrap();
    let stored = serde_json::to_value(&repository.0.lock().unwrap().document).unwrap();
    let saves = repository.0.lock().unwrap().saves;
    repository.0.lock().unwrap().fail_save = true;
    assert!(matches!(
        workspace.update_translation(&a, Some(chat), None, 2),
        Err(AppError::StoreIo)
    ));
    assert_eq!(
        serde_json::to_value(workspace.snapshot()).unwrap(),
        serde_json::to_value(&before).unwrap()
    );
    assert_eq!(
        serde_json::to_value(&repository.0.lock().unwrap().document).unwrap(),
        stored
    );
    repository.0.lock().unwrap().fail_save = false;
    let reset = workspace
        .update_translation(&a, Some(chat), None, 2)
        .unwrap();
    let settings = &reset.accounts[0].translation;
    assert_eq!(settings.revision, 3);
    assert!(settings.chats.is_empty());
    assert_eq!(settings.policy(chat), &policy("it"));
    assert_eq!(repository.0.lock().unwrap().saves, saves + 1);
}

#[test]
fn unchanged_policy_and_absent_chat_reset_do_not_write_but_stale_revisions_still_conflict() {
    let (mut workspace, repository, _, a, _) = fixture();
    let before = serde_json::to_value(workspace.snapshot()).unwrap();
    let saves = repository.0.lock().unwrap().saves;
    repository.0.lock().unwrap().fail_save = true;
    workspace
        .update_translation(&a, None, Some(TranslationPolicy::default()), 0)
        .unwrap();
    workspace
        .update_translation(&a, Some("12025550123@c.us"), None, 0)
        .unwrap();
    assert_eq!(serde_json::to_value(workspace.snapshot()).unwrap(), before);
    assert_eq!(repository.0.lock().unwrap().saves, saves);
    repository.0.lock().unwrap().fail_save = false;
    workspace
        .update_translation(&a, None, Some(policy("it")), 0)
        .unwrap();
    assert!(matches!(
        workspace.update_translation(&a, None, Some(policy("it")), 0),
        Err(AppError::TranslationSettingsConflict)
    ));
    assert_eq!(repository.0.lock().unwrap().saves, saves + 1);
}
