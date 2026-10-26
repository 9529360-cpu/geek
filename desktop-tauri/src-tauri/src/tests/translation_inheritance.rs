use super::{doubles, send_intent_support, translation_support as support};
use crate::{
    application::{
        send_intent::{Admission, SendIntents},
        send_ports::SendTransform,
        send_translation::SendTranslation,
    },
    domain::{
        error::AppError,
        proxy::ProxyConfig,
        send_intent::SendContext,
        translation::{ChatTranslationPolicy, TranslationPolicy, TranslationSettings},
    },
};
use serde_json::json;
use std::sync::Arc;

const CHAT: &str = "12025550123@c.us";

fn chat_policy() -> ChatTranslationPolicy {
    ChatTranslationPolicy {
        enabled: true,
        auto_send: true,
        target: "it".into(),
        message_action: false,
        display_translation: true,
        translation_mode: "auto".into(),
        message_target: "es".into(),
    }
}

fn global_policy() -> TranslationPolicy {
    TranslationPolicy {
        provider: "local".into(),
        route: "backup".into(),
        source: "fr".into(),
        message_from: "de".into(),
        group_auto: true,
        include_zh: false,
        font_size: 15,
        font_color: "#AABBCC".into(),
        ..TranslationPolicy::default()
    }
}

#[test]
fn the_guest_projection_resolves_all_fields_while_storage_retains_only_seven_chat_choices() {
    let mut settings = TranslationSettings {
        revision: 7,
        global: global_policy(),
        ..TranslationSettings::default()
    };
    settings.chats.insert(CHAT.into(), chat_policy());
    settings.validate().unwrap();
    let stored = serde_json::to_value(&settings).unwrap();
    assert_eq!(stored["chats"][CHAT].as_object().unwrap().len(), 7);
    assert_eq!(
        stored["chats"][CHAT],
        json!({
            "enabled": true, "autoSend": true, "target": "it", "messageAction": false,
            "displayTranslation": true, "translationMode": "auto", "messageTarget": "es"
        })
    );
    let expected = json!({
        "provider": "local", "route": "backup", "enabled": true, "autoSend": true,
        "source": "fr", "target": "it", "messageAction": false, "displayTranslation": true,
        "translationMode": "auto", "messageTarget": "es", "messageFrom": "de",
        "groupAuto": true, "translateHistory": false, "includeZh": false,
        "fontSize": 15, "fontColor": "#AABBCC"
    });
    let guest = serde_json::to_value(settings.resolved()).unwrap();
    assert_eq!(guest["revision"], 7);
    assert_eq!(guest["global"], stored["global"]);
    assert_eq!(guest["chats"][CHAT], expected);
    assert_eq!(
        serde_json::to_value(settings.policy(CHAT)).unwrap(),
        expected
    );
    assert_eq!(settings.policy("12025550124@c.us"), settings.global);

    settings.global.translate_history = true;
    assert!(settings.policy(CHAT).translate_history);
    assert_eq!(settings.validate(), Err(AppError::TranslationUnavailable));
}

#[test]
fn global_inheritance_changes_only_after_a_successful_save_and_keeps_other_accounts_independent() {
    let (mut workspace, repository, host, a, b) = doubles::fixture();
    workspace.activate(&a).unwrap();
    workspace
        .update_translation(&a, Some(CHAT), Some(chat_policy().into()), 0)
        .unwrap();
    let before = workspace.snapshot();
    let before_json = serde_json::to_value(&before).unwrap();
    let durable = serde_json::to_value(&repository.0.lock().unwrap().document).unwrap();
    let native_calls = host.0.lock().unwrap().calls.clone();
    let saves = repository.0.lock().unwrap().saves;
    repository.0.lock().unwrap().fail_save = true;
    assert!(matches!(
        workspace.update_translation(&a, None, Some(global_policy().into()), 1),
        Err(AppError::StoreIo)
    ));
    assert_eq!(
        serde_json::to_value(workspace.snapshot()).unwrap(),
        before_json
    );
    assert_eq!(
        serde_json::to_value(&repository.0.lock().unwrap().document).unwrap(),
        durable
    );
    assert_eq!(repository.0.lock().unwrap().saves, saves);
    let unchanged = workspace.snapshot().accounts[0].translation.policy(CHAT);
    assert!(unchanged.include_zh);
    assert_eq!(unchanged.route, "default");

    repository.0.lock().unwrap().fail_save = false;
    let saved = workspace
        .update_translation(&a, None, Some(global_policy().into()), 1)
        .unwrap();
    let settings = &saved.accounts[0].translation;
    assert_eq!(settings.revision, 2);
    assert_eq!(settings.chats[CHAT], chat_policy());
    assert!(!settings.policy(CHAT).include_zh);
    assert_eq!(settings.policy(CHAT).route, "backup");
    assert_eq!(settings.policy(CHAT).font_size, 15);
    assert_eq!(settings.policy(CHAT).target, "it");
    assert_eq!(saved.accounts[1].id, b);
    assert_eq!(saved.accounts[1], before.accounts[1]);
    assert_eq!(saved.active_id, Some(a));
    assert_eq!(host.0.lock().unwrap().calls, native_calls);
    assert_eq!(repository.0.lock().unwrap().saves, saves + 1);
}

#[test]
fn inherited_han_exclusion_is_an_identity_reply_without_login_quota_or_translation_work() {
    let h = support::setup();
    h.session.logout().unwrap();
    let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
    for platform in ["whatsapp", "whatsapp-pure"] {
        let (mut account, mut binding, _, mut request) = send_intent_support::fixture(true);
        account.platform_id = platform.into();
        binding.platform_id = platform.into();
        account.translation.chats.insert(CHAT.into(), chat_policy());
        account.translation.global.include_zh = false;
        request.text = "请确认 this synthetic order".into();
        request.context = SendContext::Reply {
            message_id: format!("false_{CHAT}_3EB001"),
            chat_id: CHAT.into(),
        };
        let mut owner = SendIntents::new();
        let Admission::Start(mut ticket) = owner.admit(account, binding, None, request).unwrap()
        else {
            panic!("identity reply must be admitted without a subscription");
        };
        assert!(!ticket.translate);
        assert!(ticket.session_generation.is_none());
        transform.bind(&mut ticket).unwrap();
        assert_eq!(transform.execute(&ticket).unwrap(), ticket.request.text);
        assert_eq!(ticket.output.as_deref(), Some(ticket.request.text.as_str()));
    }
    for operation in [
        support::Operation::Quota,
        support::Operation::Token,
        support::Operation::Translate,
    ] {
        assert!(h.gateway.calls(operation).is_empty());
    }
}

#[test]
fn incoming_chat_auto_inherits_group_admission_source_provider_and_route_from_global() {
    let h = support::setup();
    let mut account = support::account(ProxyConfig::System);
    let group = "120363123456789@g.us";
    account.translation.global = global_policy();
    account.translation.global.group_auto = false;
    account
        .translation
        .chats
        .insert(group.into(), chat_policy());
    let mut event = support::incoming("group-inheritance");
    event.chat_id = group.into();
    event.manual = false;
    event.sent_at = h.engine.auto_after();
    assert!(matches!(
        h.engine.prepare(account.clone(), event.clone()),
        Err(AppError::TranslationUnavailable)
    ));
    assert!(h.gateway.calls(support::Operation::Translate).is_empty());

    account.translation.global.group_auto = true;
    account.translation.revision = 1;
    event.policy_revision = 1;
    let work = h.engine.prepare(account.clone(), event).unwrap();
    account.translation.global.message_from = "it".into();
    account.translation.global.route = "primary".into();
    h.gateway.token_reply(Ok(support::token("group")), None);
    h.gateway
        .translation_reply(Ok(support::translated("Texto traducido", Some(90))), None);
    assert_eq!(h.engine.execute(&work).unwrap(), "Texto traducido");
    let calls = h.gateway.calls(support::Operation::Translate);
    assert_eq!(calls.len(), 1);
    let request = calls[0].request.as_ref().unwrap();
    assert_eq!(request.source, "de");
    assert_eq!(request.target, "es");
    assert_eq!(request.provider, "local");
    assert_eq!(request.route, "backup");
}

#[test]
fn paid_chat_outputs_survive_appearance_and_unselected_global_targets_but_not_changed_send_semantics(
) {
    for change in [
        "appearance",
        "global-target",
        "route",
        "include-zh",
        "source",
    ] {
        let (mut account, binding, session, mut request) = send_intent_support::fixture(true);
        account.translation.chats.insert(CHAT.into(), chat_policy());
        request.text = "请确认 synthetic order".into();
        let mut owner = SendIntents::new();
        let Admission::Start(ticket) = owner.admit(account, binding, session, request).unwrap()
        else {
            panic!("new translated intent");
        };
        owner
            .remember_output(&ticket, "Already paid output".into())
            .unwrap();
        owner.fail(&ticket, AppError::SendIntentChanged).unwrap();
        let mut account = ticket.account.clone();
        account.translation.revision += 1;
        match change {
            "appearance" => {
                account.translation.global.font_size = 15;
                account.translation.global.font_color = "#FFFFFF".into();
            }
            "global-target" => account.translation.global.target = "de".into(),
            "route" => account.translation.global.route = "backup".into(),
            "include-zh" => account.translation.global.include_zh = false,
            "source" => account.translation.global.source = "fr".into(),
            _ => unreachable!(),
        }
        let mut request = ticket.request.clone();
        request.policy_revision = account.translation.revision;
        request.attempt += 1;
        let retry = owner.admit(
            account,
            ticket.binding.clone(),
            ticket.session_generation.clone(),
            request,
        );
        if matches!(change, "appearance" | "global-target") {
            let Admission::Start(retry) = retry.unwrap() else {
                panic!("same paid intent must recover");
            };
            assert_eq!(retry.request.id, ticket.request.id);
            assert_eq!(retry.output.as_deref(), Some("Already paid output"));
        } else {
            assert!(
                matches!(retry, Err(AppError::SendIntentConflict)),
                "{change}"
            );
        }
    }
}
