use super::super::{Runner, SendRunner};
use crate::{
    application::{
        send_intent::SendTicket,
        send_ports::{SendFrame, SendPlatform, SendTransform, SendView},
    },
    domain::{
        account::Account,
        broadcast::GuestBinding,
        error::{AppError, Result},
        proxy::ProxyConfig,
        send_intent::{OutgoingSend, SendOutcome, SendState, SendStatus},
        translation::TranslationSettings,
    },
};
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc, Condvar, Mutex,
    },
    time::Duration,
};
use uuid::Uuid;

#[derive(Default)]
pub struct Gate {
    state: Mutex<(bool, bool)>,
    changed: Condvar,
}

impl Gate {
    fn pass(&self) {
        let mut state = self.state.lock().unwrap();
        state.0 = true;
        self.changed.notify_all();
        let (state, _) = self
            .changed
            .wait_timeout_while(state, Duration::from_secs(5), |state| !state.1)
            .unwrap();
        assert!(state.1, "synthetic blocking operation was not released");
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
        assert!(state.0, "synthetic blocking operation was not reached");
    }

    pub fn release(&self) {
        self.state.lock().unwrap().1 = true;
        self.changed.notify_all();
    }
}

/// A failing assertion still releases its worker before test teardown.
pub struct Block(pub Arc<Gate>);

impl Block {
    pub fn new() -> Self {
        Self(Arc::new(Gate::default()))
    }
}

impl Drop for Block {
    fn drop(&mut self) {
        self.0.release();
    }
}

pub enum Step<T> {
    Return(T),
    Block(Arc<Gate>, T),
    Panic,
}

impl<T> Step<T> {
    fn finish(self) -> T {
        match self {
            Self::Return(value) => value,
            Self::Block(gate, value) => {
                gate.pass();
                value
            }
            Self::Panic => panic!("synthetic adapter panic"),
        }
    }
}

#[derive(Default)]
pub struct PlatformState {
    pub view: Option<SendView>,
    pub request: Option<OutgoingSend>,
    pub chat: Option<String>,
    pub prepare_steps: VecDeque<Step<Result<()>>>,
    pub commit_steps: VecDeque<Step<SendOutcome>>,
    pub prepared: Vec<(String, u32, String)>,
    pub commits: Vec<(String, u32, String)>,
    pub deliveries: Vec<SendStatus>,
    pub rejected: Vec<AppError>,
    cancelled: Vec<(String, u32)>,
    document_flags: HashMap<String, Arc<AtomicBool>>,
}

#[derive(Default)]
pub struct FakePlatform {
    pub state: Mutex<PlatformState>,
    pub cancel_after_prepare: AtomicBool,
    pub panic_delivery: AtomicBool,
}

impl FakePlatform {
    pub fn select(&self, view: SendView, request: OutgoingSend) {
        let mut state = self.state.lock().unwrap();
        state.chat = Some(request.chat_id.clone());
        state.view = Some(view);
        state.request = Some(request);
    }
}

impl SendPlatform for FakePlatform {
    fn current(&self) -> Result<Option<SendView>> {
        Ok(self.state.lock().unwrap().view.clone())
    }

    fn cancellation(&self, binding: &GuestBinding) -> Result<Arc<AtomicBool>> {
        let mut state = self.state.lock().unwrap();
        Ok(Arc::clone(
            state
                .document_flags
                .entry(binding.generation.clone())
                .or_default(),
        ))
    }

    fn configure(&self, _: &SendView, _: Option<&str>, _: bool) -> Result<()> {
        Ok(())
    }

    fn poll(&self, _: &GuestBinding) -> Result<SendFrame> {
        let state = self.state.lock().unwrap();
        Ok(SendFrame {
            chat_id: state.chat.clone(),
            request: state.request.clone(),
        })
    }

    fn prepare(&self, ticket: &SendTicket, text: &str) -> Result<()> {
        let step = {
            let mut state = self.state.lock().unwrap();
            state.prepared.push((
                ticket.request.id.clone(),
                ticket.request.attempt,
                text.into(),
            ));
            state
                .prepare_steps
                .pop_front()
                .unwrap_or(Step::Return(Ok(())))
        };
        let result = step.finish();
        if self.cancel_after_prepare.swap(false, Ordering::AcqRel) {
            ticket.control.cancel();
        }
        result
    }

    fn commit(&self, ticket: &SendTicket, permit: &str) -> SendOutcome {
        let step = {
            let mut state = self.state.lock().unwrap();
            state.commits.push((
                ticket.request.id.clone(),
                ticket.request.attempt,
                permit.into(),
            ));
            state
                .commit_steps
                .pop_front()
                .unwrap_or(Step::Return(SendOutcome::Confirmed {
                    receipt: "synthetic-acknowledged-message".into(),
                    draft_cleared: true,
                }))
        };
        step.finish()
    }

    fn deliver(&self, _: &GuestBinding, status: &SendStatus) -> Result<()> {
        self.state.lock().unwrap().deliveries.push(status.clone());
        if self.panic_delivery.swap(false, Ordering::AcqRel) {
            panic!("synthetic status delivery panic");
        }
        Ok(())
    }

    fn reject(&self, _: &GuestBinding, _: &OutgoingSend, error: AppError) {
        self.state.lock().unwrap().rejected.push(error);
    }

    fn cancel(&self, _: &GuestBinding, id: &str, attempt: u32) {
        self.state
            .lock()
            .unwrap()
            .cancelled
            .push((id.into(), attempt));
    }
}

pub struct FakeTransform {
    pub session: Mutex<Option<String>>,
    pub steps: Mutex<VecDeque<Step<Result<String>>>>,
    pub executions: AtomicUsize,
    pub deny_validation: AtomicBool,
}

impl Default for FakeTransform {
    fn default() -> Self {
        Self {
            session: Mutex::new(Some(Uuid::new_v4().to_string())),
            steps: Mutex::new(VecDeque::new()),
            executions: AtomicUsize::new(0),
            deny_validation: AtomicBool::new(false),
        }
    }
}

impl SendTransform for FakeTransform {
    fn generation(&self) -> Option<String> {
        self.session.lock().unwrap().clone()
    }

    fn bind(&self, ticket: &mut SendTicket) -> Result<()> {
        ticket.control.check()
    }

    fn execute(&self, _: &SendTicket) -> Result<String> {
        self.executions.fetch_add(1, Ordering::AcqRel);
        let step = self
            .steps
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected paid transform");
        step.finish()
    }

    fn validate(&self, ticket: &SendTicket) -> Result<()> {
        ticket.control.check()?;
        if ticket.translate && self.deny_validation.load(Ordering::Acquire) {
            return Err(AppError::SessionRequired);
        }
        Ok(())
    }
}

pub fn fixture(translate: bool) -> (SendView, OutgoingSend) {
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
        text: "Synthetic source draft".into(),
        composer_revision: 1,
        policy_revision: 1,
        attempt: 1,
    };
    (SendView { account, binding }, request)
}

pub struct Harness {
    pub service: Arc<SendRunner>,
    pub platform: Arc<FakePlatform>,
    pub transform: Arc<FakeTransform>,
    pub runner: Runner,
    sender: mpsc::SyncSender<()>,
    receiver: mpsc::Receiver<()>,
}

impl Harness {
    pub fn new() -> Self {
        let platform = Arc::new(FakePlatform::default());
        let transform = Arc::new(FakeTransform::default());
        let service = Arc::new(SendRunner::new(platform.clone(), transform.clone()));
        let (sender, receiver) = mpsc::sync_channel(1);
        Self {
            service,
            platform,
            transform,
            runner: Runner::default(),
            sender,
            receiver,
        }
    }

    pub fn poll(&mut self) {
        self.service.poll(&mut self.runner).unwrap();
    }
    pub fn start(&mut self) {
        self.service.start_ready(&mut self.runner, &self.sender);
    }

    pub fn finish(&mut self) {
        self.receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("worker must release its slot");
        self.runner.flight = None;
    }

    pub fn status(&self, id: &str) -> SendStatus {
        self.service.owner.lock().unwrap().status(id).unwrap()
    }

    pub fn run(&mut self, view: SendView, request: OutgoingSend) -> SendState {
        let id = request.id.clone();
        self.platform.select(view, request);
        self.poll();
        self.start();
        self.finish();
        self.status(&id).state
    }
}
