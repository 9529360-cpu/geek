use super::session_support::{
    self, FakeSessionClock, FakeSessionTransport, Gate, MemorySessionRepository, Service,
};
use crate::{
    application::{
        request_control::RequestControl,
        translation::TranslationService,
        translation_ports::{
            TranslationGateway, TranslationReply, TranslationRequest, TranslationToken,
        },
    },
    domain::{
        account::Account,
        error::{AppError, Result},
        proxy::ProxyConfig,
        session::SessionToken,
        translation::{IncomingTranslation, TranslationSettings},
    },
};
use std::{
    collections::VecDeque,
    sync::{Arc, Condvar, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub type Engine = TranslationService<MemorySessionRepository, FakeSessionTransport, FakeGateway>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    Quota,
    Token,
    Translate,
}

#[derive(Clone)]
pub struct Call {
    pub operation: Operation,
    pub credential: String,
    pub proxy: ProxyConfig,
    pub request: Option<TranslationRequest>,
}

struct Reply<T> {
    result: Result<T>,
    gate: Option<Arc<Gate>>,
}

impl<T> Reply<T> {
    fn finish(self) -> Result<T> {
        if let Some(gate) = self.gate {
            gate.pass();
        }
        // A transport can finish after cancellation. The real owner must still
        // validate its lease before dispatching or publishing the result.
        self.result
    }
}

#[derive(Default)]
struct GatewayState {
    calls: Vec<Call>,
    quota: VecDeque<Reply<u64>>,
    tokens: VecDeque<Reply<TranslationToken>>,
    translations: VecDeque<Reply<TranslationReply>>,
}

#[derive(Default)]
pub struct FakeGateway {
    state: Mutex<GatewayState>,
    changed: Condvar,
}

impl FakeGateway {
    pub fn quota_reply(&self, result: Result<u64>, gate: Option<Arc<Gate>>) {
        self.state
            .lock()
            .unwrap()
            .quota
            .push_back(Reply { result, gate });
    }

    pub fn token_reply(&self, result: Result<TranslationToken>, gate: Option<Arc<Gate>>) {
        self.state
            .lock()
            .unwrap()
            .tokens
            .push_back(Reply { result, gate });
    }

    pub fn translation_reply(&self, result: Result<TranslationReply>, gate: Option<Arc<Gate>>) {
        self.state
            .lock()
            .unwrap()
            .translations
            .push_back(Reply { result, gate });
    }

    pub fn calls(&self, operation: Operation) -> Vec<Call> {
        self.state
            .lock()
            .unwrap()
            .calls
            .iter()
            .filter(|call| call.operation == operation)
            .cloned()
            .collect()
    }

    pub fn wait_for(&self, operation: Operation, count: usize) {
        let (state, _) = self
            .changed
            .wait_timeout_while(
                self.state.lock().unwrap(),
                Duration::from_secs(5),
                |state| {
                    state
                        .calls
                        .iter()
                        .filter(|call| call.operation == operation)
                        .count()
                        < count
                },
            )
            .unwrap();
        assert!(
            state
                .calls
                .iter()
                .filter(|call| call.operation == operation)
                .count()
                >= count,
            "expected {count} {operation:?} calls did not arrive"
        );
    }

    fn record(
        &self,
        state: &mut GatewayState,
        operation: Operation,
        credential: &str,
        proxy: &ProxyConfig,
        request: Option<&TranslationRequest>,
    ) {
        state.calls.push(Call {
            operation,
            credential: credential.into(),
            proxy: proxy.clone(),
            request: request.cloned(),
        });
        self.changed.notify_all();
    }
}

impl TranslationGateway for FakeGateway {
    fn quota(
        &self,
        login_token: &str,
        proxy: &ProxyConfig,
        control: &RequestControl,
    ) -> Result<u64> {
        control.check()?;
        let reply = {
            let mut state = self.state.lock().unwrap();
            self.record(&mut state, Operation::Quota, login_token, proxy, None);
            state
                .quota
                .pop_front()
                .ok_or(AppError::NetworkUnavailable)?
        };
        reply.finish()
    }

    fn translation_token(
        &self,
        login_token: &str,
        proxy: &ProxyConfig,
        control: &RequestControl,
    ) -> Result<TranslationToken> {
        control.check()?;
        let reply = {
            let mut state = self.state.lock().unwrap();
            self.record(&mut state, Operation::Token, login_token, proxy, None);
            state
                .tokens
                .pop_front()
                .ok_or(AppError::NetworkUnavailable)?
        };
        reply.finish()
    }

    fn translate(
        &self,
        token: &str,
        request: &TranslationRequest,
        proxy: &ProxyConfig,
        control: &RequestControl,
    ) -> Result<TranslationReply> {
        control.check()?;
        let reply = {
            let mut state = self.state.lock().unwrap();
            self.record(
                &mut state,
                Operation::Translate,
                token,
                proxy,
                Some(request),
            );
            state
                .translations
                .pop_front()
                .ok_or(AppError::NetworkUnavailable)?
        };
        reply.finish()
    }
}

pub struct Harness {
    pub session: Arc<Service>,
    pub repository: MemorySessionRepository,
    pub auth: Arc<FakeSessionTransport>,
    pub clock: Arc<FakeSessionClock>,
    pub gateway: Arc<FakeGateway>,
    pub engine: Arc<Engine>,
}

pub fn setup() -> Harness {
    let (session, repository, auth, clock) = session_support::setup();
    session_support::login(&session, &auth, 1, 100);
    let session = Arc::new(session);
    let gateway = Arc::new(FakeGateway::default());
    let engine = Arc::new(Engine::new(Arc::clone(&session), Arc::clone(&gateway)));
    Harness {
        session,
        repository,
        auth,
        clock,
        gateway,
        engine,
    }
}

pub fn account(proxy: ProxyConfig) -> Account {
    Account {
        id: Uuid::new_v4().to_string(),
        name: "Synthetic account".into(),
        font_size: 16,
        font_color: "#18A058".into(),
        platform_id: "whatsapp".into(),
        archived: false,
        website_url: None,
        proxy,
        translation: TranslationSettings::default(),
    }
}

pub fn incoming(message: &str) -> IncomingTranslation {
    IncomingTranslation {
        id: Uuid::new_v4().to_string(),
        chat_id: "12025550123@c.us".into(),
        message_id: message.into(),
        text: format!("Synthetic incoming {message}"),
        manual: true,
        refresh: false,
        policy_revision: 0,
        attempt: 1,
        sent_at: now(),
    }
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

pub fn token(name: &str) -> TranslationToken {
    TranslationToken {
        token: SessionToken::new(format!("synthetic-short-{name}")).unwrap(),
        expires_at: now() + 300,
    }
}

pub fn translated(text: &str, remaining_chars: Option<u64>) -> TranslationReply {
    TranslationReply {
        text: text.into(),
        remaining_chars,
    }
}
