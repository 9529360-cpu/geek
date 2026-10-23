use super::doubles::fixture;
use crate::domain::{
    error::AppError,
    translation::{ChatTranslationPolicy, TranslationPolicy, TranslationPolicyUpdate},
};

fn policy(language: &str) -> TranslationPolicy {
    TranslationPolicy {
        enabled: true,
        auto_send: true,
        message_target: language.into(),
        font_size: 15,
        ..TranslationPolicy::default()
    }
}

fn chat_policy(language: &str) -> ChatTranslationPolicy {
    ChatTranslationPolicy::from_policy(&policy(language))
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
        workspace.update_translation(&b, None, Some(policy("it").into()), 0),
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
        .update_translation(&b, None, Some(policy("it").into()), 0)
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
        .update_translation(&a, None, Some(policy("it").into()), 0)
        .unwrap();
    let stored = serde_json::to_value(&repository.0.lock().unwrap().document).unwrap();
    let saves = repository.0.lock().unwrap().saves;
    assert!(matches!(
        workspace.update_translation(&a, Some(chat), Some(chat_policy("fr").into()), 0),
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
        .update_translation(&b, Some(chat), Some(chat_policy("es").into()), 0)
        .unwrap();
    assert_eq!(other.accounts[0], first.accounts[0]);
    assert_eq!(other.accounts[1].translation.revision, 1);
    let both = workspace
        .update_translation(&a, Some(chat), Some(chat_policy("fr").into()), 1)
        .unwrap();
    assert_eq!(both.accounts[1], other.accounts[1]);
    assert_eq!(both.accounts[0].translation.global, policy("it"));
    assert_eq!(both.accounts[0].translation.chats[chat], chat_policy("fr"));
    assert_eq!(both.accounts[0].translation.revision, 2);
    assert_eq!(both.accounts[1].translation.chats[chat], chat_policy("es"));
    assert_eq!(host.0.lock().unwrap().calls, calls);
}

#[test]
fn failed_chat_reset_preserves_the_override_and_can_retry_with_the_same_revision() {
    let (mut workspace, repository, _, a, _) = fixture();
    let chat = "12025550123@c.us";
    workspace
        .update_translation(&a, None, Some(policy("it").into()), 0)
        .unwrap();
    let before = workspace
        .update_translation(&a, Some(chat), Some(chat_policy("fr").into()), 1)
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
    assert_eq!(settings.policy(chat), policy("it"));
    assert_eq!(repository.0.lock().unwrap().saves, saves + 1);
}

#[test]
fn unchanged_policy_and_absent_chat_reset_do_not_write_but_stale_revisions_still_conflict() {
    let (mut workspace, repository, _, a, _) = fixture();
    let before = serde_json::to_value(workspace.snapshot()).unwrap();
    let saves = repository.0.lock().unwrap().saves;
    repository.0.lock().unwrap().fail_save = true;
    workspace
        .update_translation(&a, None, Some(TranslationPolicy::default().into()), 0)
        .unwrap();
    workspace
        .update_translation(&a, Some("12025550123@c.us"), None, 0)
        .unwrap();
    assert_eq!(serde_json::to_value(workspace.snapshot()).unwrap(), before);
    assert_eq!(repository.0.lock().unwrap().saves, saves);
    repository.0.lock().unwrap().fail_save = false;
    workspace
        .update_translation(&a, None, Some(policy("it").into()), 0)
        .unwrap();
    assert!(matches!(
        workspace.update_translation(&a, None, Some(policy("it").into()), 0),
        Err(AppError::TranslationSettingsConflict)
    ));
    assert_eq!(repository.0.lock().unwrap().saves, saves + 1);
}

#[test]
fn ipc_policy_shapes_must_match_the_selected_scope_before_any_commit() {
    let (mut workspace, repository, host, a, _) = fixture();
    let full = serde_json::to_value(policy("it")).unwrap();
    let chat = serde_json::to_value(chat_policy("es")).unwrap();
    assert!(serde_json::from_value::<ChatTranslationPolicy>(full.clone()).is_err());
    assert!(serde_json::from_value::<TranslationPolicy>(chat.clone()).is_err());
    let global_input = serde_json::from_value::<TranslationPolicyUpdate>(full).unwrap();
    let chat_input = serde_json::from_value::<TranslationPolicyUpdate>(chat.clone()).unwrap();
    let before = serde_json::to_value(workspace.snapshot()).unwrap();
    let saves = repository.0.lock().unwrap().saves;
    let native_calls = host.0.lock().unwrap().calls.clone();
    for (chat_id, policy) in [
        (Some("12025550123@c.us"), Some(global_input)),
        (None, Some(chat_input)),
        (None, None),
        (Some("status@broadcast"), None),
    ] {
        assert!(matches!(
            workspace.update_translation(&a, chat_id, policy, 0),
            Err(AppError::TranslationInvalid)
        ));
    }
    let mut hidden = chat.clone();
    hidden["includeZh"] = serde_json::json!(false);
    assert!(serde_json::from_value::<TranslationPolicyUpdate>(hidden).is_err());
    let mut partial = chat;
    partial.as_object_mut().unwrap().remove("autoSend");
    assert!(serde_json::from_value::<TranslationPolicyUpdate>(partial).is_err());
    assert_eq!(serde_json::to_value(workspace.snapshot()).unwrap(), before);
    assert_eq!(repository.0.lock().unwrap().saves, saves);
    assert_eq!(host.0.lock().unwrap().calls, native_calls);
}
