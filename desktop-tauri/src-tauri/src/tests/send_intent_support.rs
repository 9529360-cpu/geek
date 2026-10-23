use crate::{
    application::send_intent::{Admission, SendIntents, SendTicket},
    domain::{
        account::Account,
        broadcast::GuestBinding,
        proxy::ProxyConfig,
        send_intent::{OutgoingSend, SendOutcome},
        translation::TranslationSettings,
    },
};
use uuid::Uuid;

pub fn fixture(translate: bool) -> (Account, GuestBinding, Option<String>, OutgoingSend) {
    let mut translation = TranslationSettings {
        revision: 1,
        ..TranslationSettings::default()
    };
    translation.global.enabled = translate;
    translation.global.auto_send = translate;
    let account = Account {
        id: Uuid::new_v4().to_string(),
        name: "Synthetic account".into(),
        font_size: 16,
        font_color: "#18A058".into(),
        platform_id: "whatsapp".into(),
        archived: false,
        website_url: None,
        proxy: ProxyConfig::System,
        translation,
    };
    let binding = GuestBinding {
        account_id: account.id.clone(),
        platform_id: account.platform_id.clone(),
        generation: Uuid::new_v4().to_string(),
    };
    let request = OutgoingSend {
        id: Uuid::new_v4().to_string(),
        chat_id: "12025550123@c.us".into(),
        text: "A synthetic draft".into(),
        composer_revision: 3,
        policy_revision: 1,
        attempt: 1,
    };
    let session = translate.then(|| Uuid::new_v4().to_string());
    (account, binding, session, request)
}

pub fn start(owner: &mut SendIntents, translate: bool) -> Box<SendTicket> {
    let (account, binding, session, request) = fixture(translate);
    let Admission::Start(ticket) = owner.admit(account, binding, session, request).unwrap() else {
        panic!("new intent must start");
    };
    ticket
}

pub fn next(owner: &mut SendIntents, previous: &SendTicket) -> Box<SendTicket> {
    let mut request = previous.request.clone();
    request.attempt += 1;
    let Admission::Start(ticket) = owner
        .admit(
            previous.account.clone(),
            previous.binding.clone(),
            previous.session_generation.clone(),
            request,
        )
        .unwrap()
    else {
        panic!("explicit precommit retry must start");
    };
    ticket
}

pub fn confirmed() -> SendOutcome {
    SendOutcome::Confirmed {
        receipt: "true_synthetic_platform_message".into(),
        draft_cleared: true,
    }
}
