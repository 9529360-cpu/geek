//! Telegram uses the existing send/translation/broadcast owners with a separate peer namespace.
use super::{broadcast_support as broadcast, send_intent_support, translation_support};
use crate::{
    application::{
        broadcast::BroadcastService,
        send_intent::{Admission, SendIntents},
        send_ports::SendTransform,
        send_translation::SendTranslation,
    },
    domain::{
        broadcast::{
            BroadcastAction, BroadcastIssue, BroadcastState, BroadcastVcard, DispatchOutcome,
        },
        error::AppError,
        send_intent::{SendContext, SendOutcome, SendState},
    },
};
use std::sync::Arc;

#[test]
fn k_translation_and_confirmed_send_keep_one_native_id_and_reuse_paid_output() {
    let h = translation_support::setup();
    let transform = SendTranslation::new(Arc::clone(&h.session), Arc::clone(&h.engine));
    let mut owner = SendIntents::new();
    let (mut account, mut binding, _, mut request) = send_intent_support::fixture(true);
    account.platform_id = "telegram-k".into();
    account.translation.global.target = "it".into();
    binding.platform_id = account.platform_id.clone();
    request.chat_id = "tg:-100123".into();
    let Admission::Start(mut first) = owner
        .admit(account, binding, transform.generation(), request.clone())
        .unwrap()
    else {
        panic!("new K send must enter the existing owner");
    };
    transform.bind(&mut first).unwrap();
    h.gateway
        .token_reply(Ok(translation_support::token("k-send")), None);
    h.gateway.translation_reply(
        Ok(translation_support::translated("Un messaggio", Some(0))),
        None,
    );
    let output = transform.execute(&first).unwrap();
    owner.remember_output(&first, output).unwrap();
    assert!(owner.begin_commit(&first).unwrap());
    owner
        .settle(
            &first,
            SendOutcome::NotSubmitted {
                issue: AppError::SendIntentChanged,
            },
        )
        .unwrap();
    let mut retry = send_intent_support::next(&mut owner, &first);
    transform.bind(&mut retry).unwrap();
    transform.validate(&retry).unwrap();
    assert_eq!(retry.output.as_deref(), Some("Un messaggio"));
    assert_eq!(retry.request.id, request.id);
    assert!(owner.begin_commit(&retry).unwrap());
    let status = owner
        .settle(
            &retry,
            SendOutcome::Confirmed {
                receipt: "tg:-100123:42".into(),
                draft_cleared: true,
            },
        )
        .unwrap();
    assert_eq!(status.state, SendState::Confirmed);
    assert!(!status.retryable);
    assert!(!owner.begin_commit(&retry).unwrap());
    let calls = h.gateway.calls(translation_support::Operation::Translate);
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].request.as_ref().unwrap().id, request.id);
    assert_eq!(calls[0].request.as_ref().unwrap().target, "it");
}

#[test]
fn platform_admission_keeps_namespaces_and_unsupported_a_sends_out_of_the_owner() {
    for (platform, peer) in [
        ("telegram-k", "123@c.us"),
        ("whatsapp", "tg:123"),
        ("whatsapp-pure", "tg:-123"),
        ("telegram-z", "123@c.us"),
        ("messenger", "tg:123"),
        ("instagram", "/messages/t/thread-1"),
    ] {
        let (mut account, mut binding, session, mut request) = send_intent_support::fixture(true);
        account.platform_id = platform.into();
        binding.platform_id = platform.into();
        request.chat_id = peer.into();
        let mut owner = SendIntents::new();
        assert!(matches!(
            owner.admit(account, binding, session, request.clone()),
            Err(AppError::SendIntentInvalid)
        ));
        assert!(owner.status(&request.id).is_none());
    }
    let (mut account, mut binding, session, mut request) = send_intent_support::fixture(true);
    account.platform_id = "telegram-z".into();
    binding.platform_id = "telegram-z".into();
    request.chat_id = "tg:123".into();
    let mut owner = SendIntents::new();
    assert!(matches!(
        owner.admit(account, binding, session, request),
        Ok(Admission::Start(_))
    ));
    for (platform, peer) in [
        ("messenger", "/messages/t/thread-1"),
        ("messenger", "/messages/e2ee/t/thread-1"),
        ("instagram", "/direct/t/thread-1"),
    ] {
        let (mut account, mut binding, session, mut request) = send_intent_support::fixture(true);
        account.platform_id = platform.into();
        binding.platform_id = platform.into();
        request.chat_id = peer.into();
        let mut owner = SendIntents::new();
        assert!(matches!(
            owner.admit(account, binding, session, request.clone()),
            Ok(Admission::Start(_))
        ));
        request.context = SendContext::Reply {
            message_id: "1".into(),
            chat_id: peer.into(),
        };
        assert_eq!(
            request.validate_for_platform(platform),
            Err(AppError::SendIntentInvalid)
        );
    }
    let (_, _, _, mut request) = send_intent_support::fixture(false);
    request.chat_id = "tg:123".into();
    request.context = SendContext::Reply {
        message_id: "42".into(),
        chat_id: "tg:123".into(),
    };
    assert_eq!(
        request.validate_for_platform("telegram-k"),
        Err(AppError::SendIntentInvalid)
    );
}

#[test]
fn k_owner_rejects_oversized_utf16_sources_and_outputs_before_admission_or_commit() {
    for source in [
        "a".repeat(4096),
        "😀".repeat(2048),
        "a".repeat(4097),
        "😀".repeat(2049),
    ] {
        let (mut account, mut binding, session, mut request) = send_intent_support::fixture(true);
        account.platform_id = "telegram-k".into();
        binding.platform_id = account.platform_id.clone();
        request.chat_id = "tg:123".into();
        request.text = source.clone();
        let mut owner = SendIntents::new();
        let result = owner.admit(account, binding, session, request.clone());
        if source.encode_utf16().count() > 4096 {
            assert!(matches!(result, Err(AppError::SendIntentInvalid)));
            assert!(owner.status(&request.id).is_none());
            continue;
        }
        let Admission::Start(ticket) = result.unwrap() else {
            panic!("bounded source must start")
        };
        owner.remember_output(&ticket, source).unwrap();
        assert_eq!(
            owner.remember_output(&ticket, "😀".repeat(2049)),
            Err(AppError::TranslationOutputInvalid)
        );
        assert_eq!(owner.status(&request.id).unwrap().state, SendState::Failed);
        assert!(owner.begin_commit(&ticket).is_err());
    }
}

fn k_account() -> crate::domain::broadcast::BroadcastAccount {
    let mut account = broadcast::account("K account");
    account.platform_id = "telegram-k".into();
    account.capabilities.tag_all = false;
    account.capabilities.vcards = false;
    account.capabilities.attachments = false;
    account
}

fn k_draft(
    account: &crate::domain::broadcast::BroadcastAccount,
) -> crate::domain::broadcast::BroadcastDraft {
    let mut draft = broadcast::draft(account, 2);
    draft.targets[0].id = "tg:123".into();
    draft.targets[1].id = "tg:-100456".into();
    draft
}

#[test]
fn k_broadcast_uses_existing_schedule_checkpoint_and_uncertainty_recovery_without_resending() {
    let (service, repository, platform) = broadcast::setup();
    let account = k_account();
    let mut draft = k_draft(&account);
    draft.scheduled_at = Some(broadcast::NOW + 1_000);
    let created = service.submit(account, draft, broadcast::NOW).unwrap();
    assert_eq!(service.tick(broadcast::NOW).unwrap(), 0);
    *platform.outcome.lock().unwrap() = Some(DispatchOutcome::Uncertain {
        code: BroadcastIssue::TimedOut,
    });
    assert_eq!(service.tick(broadcast::NOW + 1_000).unwrap(), 1);
    broadcast::idle(&service);
    let paused = broadcast::job(&service, &created.id);
    assert_eq!(
        (paused.state, paused.current, paused.uncertain),
        (BroadcastState::Paused, 1, 1)
    );
    assert!(paused.review_required);
    assert_eq!(service.tick(broadcast::NOW + 100_000).unwrap(), 0);
    drop(service);
    let reopened =
        BroadcastService::open_at(repository, Arc::clone(&platform), broadcast::NOW + 100_001)
            .unwrap();
    assert_eq!(reopened.tick(broadcast::NOW + 100_002).unwrap(), 0);
    *platform.outcome.lock().unwrap() = None;
    reopened
        .control(
            &created.id,
            BroadcastAction::Resume,
            broadcast::NOW + 100_003,
        )
        .unwrap();
    assert_eq!(reopened.tick(broadcast::NOW + 100_004).unwrap(), 1);
    broadcast::idle(&reopened);
    let calls = platform.calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].request.target_id, "tg:123");
    assert_eq!(calls[1].request.target_id, "tg:-100456");
    assert!(calls
        .iter()
        .all(|call| call.binding.platform_id == "telegram-k"));
    assert_eq!(calls[0].binding, calls[1].binding);
    assert_eq!(
        broadcast::job(&reopened, &created.id).state,
        BroadcastState::Completed
    );
}

#[test]
fn k_broadcast_rejects_foreign_peers_and_unimplemented_options_even_if_capabilities_are_forged() {
    let (service, _, platform) = broadcast::setup();
    let mut account = k_account();
    account.capabilities.tag_all = true;
    account.capabilities.vcards = true;
    account.capabilities.attachments = true;
    for peer in ["123@c.us", "123", "tg:0", "tg:01"] {
        let mut draft = k_draft(&account);
        draft.targets[0].id = peer.into();
        assert!(matches!(
            service.submit(account.clone(), draft, broadcast::NOW),
            Err(AppError::BroadcastInvalid)
        ));
    }
    let mut tagged = k_draft(&account);
    tagged.tag_all = true;
    assert!(matches!(
        service.submit(account.clone(), tagged, broadcast::NOW),
        Err(AppError::BroadcastUnsupported)
    ));
    let mut cards = k_draft(&account);
    cards.vcards.push(BroadcastVcard {
        id: "123@c.us".into(),
        name: "Synthetic card".into(),
    });
    assert!(matches!(
        service.submit(account, cards, broadcast::NOW),
        Err(AppError::BroadcastUnsupported)
    ));
    assert!(platform.calls.lock().unwrap().is_empty());
    assert!(service.list().unwrap().is_empty());
}

#[test]
fn k_broadcast_bounds_every_expanded_variant_before_persisting_or_sending() {
    let (service, _, platform) = broadcast::setup();
    let account = k_account();
    for message in [
        "😀".repeat(2049),
        format!("{}%nc", "x".repeat(4095)),
        format!("{{Short|{}}}", "x".repeat(4097)),
    ] {
        let mut draft = k_draft(&account);
        draft.message = message;
        assert!(matches!(
            service.submit(account.clone(), draft, broadcast::NOW),
            Err(AppError::BroadcastInvalid)
        ));
    }
    assert!(service.list().unwrap().is_empty());
    assert!(platform.calls.lock().unwrap().is_empty());
    let mut draft = k_draft(&account);
    draft.message = "😀".repeat(2048);
    assert!(service.submit(account, draft, broadcast::NOW).is_ok());
}
