use crate::{
    application::{
        request_control::RequestControl,
        session::SessionService,
        session_ports::{SessionClock, SessionRepository, SessionTransport},
    },
    domain::{
        error::{AppError, Result},
        session::*,
    },
};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
    time::Duration,
};

pub const NOW: u64 = 1_000_000;
pub type Service = SessionService<MemorySessionRepository, FakeSessionTransport>;

#[derive(Default)]
pub struct MemorySessionState {
    pub document: Option<SessionDocument>,
    pub successful_writes: usize,
    pub fail_next: bool,
}

#[derive(Clone, Default)]
pub struct MemorySessionRepository(pub Arc<Mutex<MemorySessionState>>);

impl SessionRepository for MemorySessionRepository {
    fn load(&self) -> Result<Option<SessionDocument>> {
        Ok(self.0.lock().unwrap().document.clone())
    }

    fn save(&mut self, document: &SessionDocument) -> Result<()> {
        let mut state = self.0.lock().unwrap();
        if state.fail_next {
            state.fail_next = false;
            return Err(AppError::StoreIo);
        }
        state.document = Some(document.clone());
        state.successful_writes += 1;
        Ok(())
    }
}

#[derive(Default)]
pub struct Gate {
    state: Mutex<(bool, bool)>,
    changed: Condvar,
}

impl Gate {
    pub(super) fn pass(&self) {
        let mut state = self.state.lock().unwrap();
        state.0 = true;
        self.changed.notify_all();
        let (state, _) = self
            .changed
            .wait_timeout_while(state, Duration::from_secs(5), |state| !state.1)
            .unwrap();
        assert!(
            state.1,
            "test did not release the blocked authentication response"
        );
    }

    pub fn entered(&self) {
        let (state, _) = self
            .changed
            .wait_timeout_while(
                self.state.lock().unwrap(),
                Duration::from_secs(5),
                |state| !state.0,
            )
            .unwrap();
        assert!(
            state.0,
            "authentication transport never reached its blocking boundary"
        );
    }

    pub fn release(&self) {
        self.state.lock().unwrap().1 = true;
        self.changed.notify_all();
    }
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
        // Deliberately allow a late response after cancellation; the owner must
        // independently reject it rather than trusting cooperative network code.
        self.result
    }
}

#[derive(Default)]
pub struct FakeSessionTransport {
    login_replies: Mutex<VecDeque<Reply<LoginPayload>>>,
    refresh_replies: Mutex<VecDeque<Reply<SessionRefresh>>>,
    pub emails: Mutex<Vec<String>>,
    pub refresh_calls: AtomicU64,
}

impl FakeSessionTransport {
    pub fn login_reply(&self, result: Result<LoginPayload>, gate: Option<Arc<Gate>>) {
        self.login_replies
            .lock()
            .unwrap()
            .push_back(Reply { result, gate });
    }

    pub fn refresh_reply(&self, result: Result<SessionRefresh>, gate: Option<Arc<Gate>>) {
        self.refresh_replies
            .lock()
            .unwrap()
            .push_back(Reply { result, gate });
    }

    pub fn authenticated_reply(&self, id: u64, remaining_chars: u64) {
        self.login_reply(Ok(server_login(id)), None);
        self.refresh_reply(Ok(server_refresh(id, remaining_chars)), None);
    }
}

impl SessionTransport for FakeSessionTransport {
    fn login(
        &self,
        email: &str,
        _password: &str,
        control: &RequestControl,
    ) -> Result<LoginPayload> {
        control.check()?;
        self.emails.lock().unwrap().push(email.to_owned());
        let reply = self
            .login_replies
            .lock()
            .unwrap()
            .pop_front()
            .ok_or(AppError::NetworkUnavailable)?;
        reply.finish()
    }

    fn refresh(&self, _token: &str, control: &RequestControl) -> Result<SessionRefresh> {
        control.check()?;
        self.refresh_calls.fetch_add(1, Ordering::AcqRel);
        let reply = self
            .refresh_replies
            .lock()
            .unwrap()
            .pop_front()
            .ok_or(AppError::NetworkUnavailable)?;
        reply.finish()
    }
}

pub struct FakeSessionClock(pub AtomicU64);

impl SessionClock for FakeSessionClock {
    fn now_ms(&self) -> u64 {
        self.0.load(Ordering::Acquire)
    }
}

impl FakeSessionClock {
    pub fn set(&self, now: u64) {
        self.0.store(now, Ordering::Release);
    }
}

pub fn server_user(id: u64) -> SessionUser {
    SessionUser {
        id,
        email: format!("person-{id}@example.test"),
        account_no: format!("GK-{id:032x}"),
    }
}

pub fn server_login(id: u64) -> LoginPayload {
    LoginPayload {
        token: SessionToken::new(format!("synthetic-session-token-{id}")).unwrap(),
        user: server_user(id),
    }
}

pub fn server_refresh(id: u64, remaining_chars: u64) -> SessionRefresh {
    SessionRefresh {
        user: server_user(id),
        remaining_chars,
    }
}

pub fn setup() -> (
    Service,
    MemorySessionRepository,
    Arc<FakeSessionTransport>,
    Arc<FakeSessionClock>,
) {
    let repository = MemorySessionRepository::default();
    let transport = Arc::new(FakeSessionTransport::default());
    let clock = Arc::new(FakeSessionClock(AtomicU64::new(NOW)));
    let service =
        Service::open_with_clock(repository.clone(), Arc::clone(&transport), clock.clone())
            .unwrap();
    (service, repository, transport, clock)
}

pub fn login(
    service: &Service,
    transport: &FakeSessionTransport,
    id: u64,
    quota: u64,
) -> SessionSnapshot {
    transport.authenticated_reply(id, quota);
    service
        .login(&server_user(id).email, "synthetic-password".into())
        .unwrap()
}
