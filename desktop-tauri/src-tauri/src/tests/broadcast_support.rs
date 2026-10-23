use crate::{
    application::{
        broadcast::{BroadcastService, DispatchControl},
        ports::{BroadcastPlatform, BroadcastRepository},
    },
    domain::{
        broadcast::*,
        error::{AppError, Result},
    },
};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};
use uuid::Uuid;

pub const NOW: u64 = 1_000_000;
pub type Service = BroadcastService<MemoryRepository, FakePlatform>;

#[derive(Clone, Copy)]
pub enum FailAt {
    Any,
    Enter,
    Settle,
}

#[derive(Default)]
pub struct MemoryState {
    pub document: Option<BroadcastDocument>,
    pub successful_writes: usize,
    pub fail_at: Option<FailAt>,
}

#[derive(Clone, Default)]
pub struct MemoryRepository(pub Arc<Mutex<MemoryState>>);

impl BroadcastRepository for MemoryRepository {
    fn load(&self) -> Result<Option<BroadcastDocument>> {
        Ok(self.0.lock().unwrap().document.clone())
    }
    fn save(&mut self, document: &BroadcastDocument) -> Result<()> {
        let mut state = self.0.lock().unwrap();
        let fail = match state.fail_at {
            Some(FailAt::Any) => true,
            Some(FailAt::Enter) => document.jobs.iter().any(|job| job.checkpoint.is_some()),
            Some(FailAt::Settle) => state.document.as_ref().is_some_and(|old| {
                old.jobs.iter().any(|previous| {
                    previous.checkpoint.is_some()
                        && document
                            .jobs
                            .iter()
                            .any(|job| job.id == previous.id && job.checkpoint.is_none())
                })
            }),
            None => false,
        };
        if fail {
            state.fail_at = None;
            return Err(AppError::StoreIo);
        }
        state.document = Some(document.clone());
        state.successful_writes += 1;
        Ok(())
    }
}

#[derive(Default)]
pub struct Gate {
    open: Mutex<bool>,
    changed: Condvar,
}

impl Gate {
    pub fn release(&self) {
        *self.open.lock().unwrap() = true;
        self.changed.notify_all();
    }
    fn wait(&self) {
        let (value, timeout) = self
            .changed
            .wait_timeout_while(self.open.lock().unwrap(), Duration::from_secs(5), |open| {
                !*open
            })
            .unwrap();
        assert!(
            *value && !timeout.timed_out(),
            "test did not release the fake native boundary"
        );
    }
}

#[derive(Clone, Debug)]
pub struct Call {
    pub binding: GuestBinding,
    pub request: DispatchRequest,
}

pub struct FakePlatform {
    pub calls: Mutex<Vec<Call>>,
    pub acquired: Mutex<Vec<String>>,
    pub unavailable: Mutex<HashSet<String>>,
    pub generation: Mutex<String>,
    pub before_commit: Mutex<Option<Arc<Gate>>>,
    pub after_commit: Mutex<Option<Arc<Gate>>>,
    pub outcome: Mutex<Option<DispatchOutcome>>,
    pub commits: Mutex<usize>,
    pub enforce_generation: AtomicBool,
    pub hour: AtomicU8,
    changed: Condvar,
    committed: Condvar,
}

impl Default for FakePlatform {
    fn default() -> Self {
        Self {
            calls: Mutex::new(Vec::new()),
            acquired: Mutex::new(Vec::new()),
            unavailable: Mutex::new(HashSet::new()),
            generation: Mutex::new(Uuid::new_v4().to_string()),
            before_commit: Mutex::new(None),
            after_commit: Mutex::new(None),
            outcome: Mutex::new(None),
            commits: Mutex::new(0),
            enforce_generation: AtomicBool::new(false),
            hour: AtomicU8::new(16),
            changed: Condvar::new(),
            committed: Condvar::new(),
        }
    }
}

impl FakePlatform {
    pub fn await_calls(&self, count: usize) {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut calls = self.calls.lock().unwrap();
        while calls.len() < count {
            let remaining = deadline.saturating_duration_since(Instant::now());
            assert!(
                !remaining.is_zero(),
                "native dispatch count never reached {count}"
            );
            calls = self.changed.wait_timeout(calls, remaining).unwrap().0;
        }
    }
    pub fn await_commits(&self, count: usize) {
        let (commits, _) = self
            .committed
            .wait_timeout_while(
                self.commits.lock().unwrap(),
                Duration::from_secs(5),
                |value| *value < count,
            )
            .unwrap();
        assert!(
            *commits >= count,
            "native commit count never reached {count}"
        );
    }
}

impl BroadcastPlatform for FakePlatform {
    fn acquire_binding(
        &self,
        account_id: &str,
        platform_id: &str,
    ) -> std::result::Result<GuestBinding, BroadcastIssue> {
        self.acquired.lock().unwrap().push(account_id.to_owned());
        if self.unavailable.lock().unwrap().contains(account_id) {
            return Err(BroadcastIssue::AccountUnavailable);
        }
        Ok(GuestBinding {
            account_id: account_id.into(),
            platform_id: platform_id.into(),
            generation: self.generation.lock().unwrap().clone(),
        })
    }
    fn local_hour(&self, _binding: &GuestBinding) -> std::result::Result<u8, BroadcastIssue> {
        Ok(self.hour.load(Ordering::Acquire))
    }
    fn dispatch(
        &self,
        binding: &GuestBinding,
        request: &DispatchRequest,
        control: &DispatchControl,
    ) -> DispatchOutcome {
        self.calls.lock().unwrap().push(Call {
            binding: binding.clone(),
            request: request.clone(),
        });
        self.changed.notify_all();
        let before = self.before_commit.lock().unwrap().clone();
        if let Some(gate) = before {
            gate.wait();
        }
        if self
            .unavailable
            .lock()
            .unwrap()
            .contains(&binding.account_id)
        {
            return DispatchOutcome::NotSubmitted {
                code: BroadcastIssue::AccountUnavailable,
            };
        }
        if self.enforce_generation.load(Ordering::Acquire)
            && binding.generation != *self.generation.lock().unwrap()
        {
            return DispatchOutcome::NotSubmitted {
                code: BroadcastIssue::GuestChanged,
            };
        }
        if !control.try_begin_commit() {
            return DispatchOutcome::NotSubmitted {
                code: BroadcastIssue::Cancelled,
            };
        }
        *self.commits.lock().unwrap() += 1;
        self.committed.notify_all();
        let after = self.after_commit.lock().unwrap().clone();
        if let Some(gate) = after {
            gate.wait();
        }
        self.outcome
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| DispatchOutcome::Confirmed {
                receipt: request.attempt_id.clone(),
            })
    }
}

pub fn account(name: &str) -> BroadcastAccount {
    BroadcastAccount {
        id: Uuid::new_v4().to_string(),
        name: name.into(),
        platform_id: "whatsapp".into(),
        capabilities: BroadcastCapabilities {
            text: true,
            tag_all: true,
            vcards: true,
        },
    }
}

pub fn draft(account: &BroadcastAccount, count: usize) -> BroadcastDraft {
    BroadcastDraft {
        id: Uuid::new_v4().to_string(),
        account_id: account.id.clone(),
        targets: (0..count)
            .map(|index| BroadcastTarget {
                id: format!("synthetic-{index}@c.us"),
                name: format!("Person {index}"),
                real_name: format!("Real {index}"),
            })
            .collect(),
        message: "Hello %nc / %nr / %sa".into(),
        tag_all: false,
        vcards: Vec::new(),
        interval_min_ms: 1_000,
        interval_max_ms: 1_000,
        scheduled_at: None,
    }
}

pub fn setup() -> (Service, MemoryRepository, Arc<FakePlatform>) {
    let repository = MemoryRepository::default();
    let platform = Arc::new(FakePlatform::default());
    let service = Service::open_at(repository.clone(), Arc::clone(&platform), NOW).unwrap();
    (service, repository, platform)
}

pub fn job(service: &Service, id: &str) -> BroadcastJob {
    service
        .list()
        .unwrap()
        .into_iter()
        .find(|job| job.id == id)
        .unwrap()
}

pub fn idle(service: &Service) {
    assert!(service.wait_idle(Duration::from_secs(5)).unwrap());
}
