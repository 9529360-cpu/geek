//! Two bounded incoming workers; no network or guest wait owns Workspace.
mod health;

use super::{
    platform_sessions::PlatformSessions,
    session::{NativeSession, NativeTranslation},
    translation_guest::{TranslationContext, TranslationGuest},
    SharedDesktop,
};
use crate::{
    application::{request_control::RequestControl, translation::PreparedTranslation},
    domain::{
        account::Account,
        broadcast::GuestBinding,
        error::{AppError, Result},
        translation::{supports_receive, IncomingTranslation},
    },
};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const WORKERS: usize = 2;
const QUEUED: usize = 8;
const MAX_LEDGER: usize = 20_000;

pub struct TranslationDesktop {
    workspace: SharedDesktop,
    sessions: Arc<PlatformSessions>,
    session: Arc<NativeSession>,
    service: Arc<NativeTranslation>,
    guest: TranslationGuest,
    stop: Arc<AtomicBool>,
    health_gate: Mutex<()>,
}

struct Work {
    flight_id: String,
    binding: GuestBinding,
    prepared: PreparedTranslation,
}

struct Completion {
    work: Work,
    result: Result<String>,
}

enum Progress {
    Queued,
    Running,
    Ready(Result<String>),
    Delivered,
}

struct Seen {
    fingerprint: [u8; 32],
    attempt: u32,
    progress: Progress,
}

struct ActiveView {
    account: Account,
    binding: GuestBinding,
    subscription: Option<String>,
    chat_id: Option<String>,
    auto_after: u64,
    cancel: Arc<AtomicBool>,
    ledger: HashMap<String, Seen>,
}

#[derive(Default)]
struct Runner {
    view: Option<ActiveView>,
    queue: VecDeque<Work>,
    flights: HashMap<String, ((String, u32), RequestControl)>,
}

impl TranslationDesktop {
    pub fn new(
        workspace: SharedDesktop,
        sessions: Arc<PlatformSessions>,
        session: Arc<NativeSession>,
        service: Arc<NativeTranslation>,
        guest: TranslationGuest,
    ) -> Self {
        Self {
            workspace,
            sessions,
            session,
            service,
            guest,
            stop: Arc::new(AtomicBool::new(false)),
            health_gate: Mutex::new(()),
        }
    }

    pub fn context(&self, account_id: &str) -> Result<TranslationContext> {
        let account = self
            .workspace
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .snapshot()
            .accounts
            .into_iter()
            .find(|account| account.id == account_id && !account.archived)
            .ok_or(AppError::AccountUnknown)?;
        self.guest.context(&account)
    }

    pub fn start(self: &Arc<Self>) -> Result<()> {
        let owner = Arc::clone(self);
        std::thread::Builder::new()
            .name("geek-incoming-translation".into())
            .spawn(move || {
                let (send, receive) = mpsc::sync_channel::<Completion>(WORKERS);
                let mut runner = Runner::default();
                while !owner.stop.load(Ordering::Acquire) {
                    owner.completed(&mut runner, &receive);
                    if owner.poll(&mut runner).is_err() {
                        owner.suspend(&mut runner);
                    }
                    owner.start_ready(&mut runner, &send);
                    std::thread::sleep(Duration::from_millis(250));
                }
                owner.suspend(&mut runner);
            })
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(())
    }

    pub fn shutdown(&self) {
        self.stop.store(true, Ordering::Release);
    }

    fn suspend(&self, runner: &mut Runner) {
        runner.queue.clear();
        if let Some(previous) = runner.view.take() {
            previous.cancel.store(true, Ordering::Release);
            if self.sessions.valid(&previous.binding) {
                let _ = self.guest.configure(
                    &previous.binding,
                    &previous.account,
                    previous.subscription.as_deref(),
                    false,
                    previous.auto_after,
                );
            }
        }
        for (_, control) in runner.flights.values() {
            control.cancel();
        }
    }

    fn visible(&self) -> Result<Option<Account>> {
        Ok(self
            .workspace
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .visible_account()
            .filter(|account| supports_receive(&account.platform_id)))
    }

    fn poll(&self, runner: &mut Runner) -> Result<()> {
        let Some(account) = self.visible()? else {
            self.suspend(runner);
            return Ok(());
        };
        let binding = self
            .sessions
            .binding(&account.id, &account.platform_id)
            .map_err(|_| AppError::TranslationUnavailable)?;
        let subscription = self
            .session
            .capture_lease()
            .ok()
            .map(|lease| lease.generation);
        let changed = runner.view.as_ref().is_none_or(|view| {
            view.binding != binding
                || view.subscription != subscription
                || view.account.translation.revision != account.translation.revision
                || view.account.proxy != account.proxy
        });
        if changed {
            self.suspend(runner);
            // Readiness is evaluated once per owned document/configuration.
            if self.guest.binding(&account)? != binding {
                return Err(AppError::TranslationUnavailable);
            }
            runner.view = Some(ActiveView {
                account: account.clone(),
                binding: binding.clone(),
                subscription: subscription.clone(),
                chat_id: None,
                auto_after: auto_after().max(self.service.auto_after()),
                cancel: Arc::new(AtomicBool::new(false)),
                ledger: HashMap::new(),
            });
        }
        let cutoff = runner
            .view
            .as_ref()
            .ok_or(AppError::StateUnavailable)?
            .auto_after;
        self.guest
            .configure(&binding, &account, subscription.as_deref(), true, cutoff)?;
        let frame = self.guest.poll(&binding)?;
        // Recheck the native selection after callbacks; hiding a guest is not a new account.
        if !self.visible()?.is_some_and(|current| {
            current.id == account.id
                && current.translation.revision == account.translation.revision
                && current.proxy == account.proxy
        }) || !self.sessions.valid(&binding)
        {
            return Err(AppError::TranslationCancelled);
        }
        let view = runner.view.as_mut().ok_or(AppError::StateUnavailable)?;
        let chat_id = frame.chat.map(|chat| chat.id);
        if view.chat_id != chat_id {
            view.cancel.store(true, Ordering::Release);
            view.cancel = Arc::new(AtomicBool::new(false));
            view.chat_id = chat_id;
            view.auto_after = auto_after();
            view.ledger.clear();
            runner.queue.clear();
        }
        let pending: HashSet<_> = frame
            .requests
            .iter()
            .map(|request| (request.id.clone(), request.attempt))
            .collect();
        runner.queue.retain(|work| {
            let keep = pending.contains(&(
                work.prepared.incoming.id.clone(),
                work.prepared.incoming.attempt,
            ));
            if !keep {
                work.prepared.control.cancel();
                if let Some(seen) = view
                    .ledger
                    .get_mut(&work.prepared.incoming.id)
                    .filter(|seen| seen.attempt == work.prepared.incoming.attempt)
                {
                    seen.progress = Progress::Delivered;
                }
            }
            keep
        });
        for (key, control) in runner.flights.values() {
            if !pending.contains(key) {
                control.cancel();
            }
        }
        // Drop completed text promptly after the guest removes its pending row.
        for (id, seen) in &mut view.ledger {
            if !pending.contains(&(id.clone(), seen.attempt))
                && matches!(seen.progress, Progress::Ready(_))
            {
                seen.progress = Progress::Delivered;
            }
        }
        for incoming in frame.requests {
            self.admit(runner, incoming)?;
        }
        Ok(())
    }

    fn admit(&self, runner: &mut Runner, incoming: IncomingTranslation) -> Result<()> {
        let view = runner.view.as_mut().ok_or(AppError::StateUnavailable)?;
        incoming.validate_for_platform(&view.binding.platform_id)?;
        if view.chat_id.as_deref() != Some(incoming.chat_id.as_str()) {
            return Err(AppError::TranslationInvalid);
        }
        let fingerprint = fingerprint(&incoming);
        if let Some(seen) = view.ledger.get(&incoming.id) {
            if seen.fingerprint != fingerprint {
                self.deliver_error(view, &incoming, AppError::TranslationConflict);
                return Ok(());
            }
            if incoming.attempt == seen.attempt {
                if let Progress::Ready(result) = &seen.progress {
                    if self.guest.deliver(
                        &view.binding,
                        view.subscription.as_deref().unwrap_or_default(),
                        view.account.translation.revision,
                        &incoming,
                        result,
                    )? {
                        view.ledger.get_mut(&incoming.id).unwrap().progress = Progress::Delivered;
                    }
                }
                return Ok(());
            }
            if incoming.attempt != seen.attempt.saturating_add(1) {
                self.deliver_error(view, &incoming, AppError::TranslationConflict);
                return Ok(());
            }
        } else if view.ledger.len() >= MAX_LEDGER {
            self.deliver_error(view, &incoming, AppError::TranslationLimit);
            return Ok(());
        }
        let prepared = if !incoming.manual && incoming.sent_at < view.auto_after {
            Err(AppError::TranslationUnavailable)
        } else if runner.queue.len() >= QUEUED {
            Err(AppError::TranslationLimit)
        } else {
            self.service.prepare(view.account.clone(), incoming.clone())
        };
        let progress = match prepared {
            Ok(mut prepared) => {
                if Some(prepared.lease.generation.as_str()) != view.subscription.as_deref() {
                    return Err(AppError::SessionChanged);
                }
                let guest_cancel = self
                    .sessions
                    .cancellation(&view.binding)
                    .map_err(|_| AppError::TranslationCancelled)?;
                prepared.control = prepared
                    .control
                    .with_cancel(Arc::clone(&view.cancel))
                    .with_cancel(Arc::clone(&self.stop))
                    .with_cancel(guest_cancel);
                let work = Work {
                    flight_id: uuid::Uuid::new_v4().to_string(),
                    binding: view.binding.clone(),
                    prepared,
                };
                if incoming.manual {
                    let index = runner
                        .queue
                        .iter()
                        .position(|item| !item.prepared.incoming.manual)
                        .unwrap_or(runner.queue.len());
                    runner.queue.insert(index, work);
                } else {
                    runner.queue.push_back(work);
                }
                Progress::Queued
            }
            Err(error) => Progress::Ready(Err(error)),
        };
        view.ledger.insert(
            incoming.id.clone(),
            Seen {
                fingerprint,
                attempt: incoming.attempt,
                progress,
            },
        );
        Ok(())
    }

    fn deliver_error(&self, view: &ActiveView, incoming: &IncomingTranslation, error: AppError) {
        let _ = self.guest.deliver(
            &view.binding,
            view.subscription.as_deref().unwrap_or_default(),
            view.account.translation.revision,
            incoming,
            &Err(error),
        );
    }

    fn start_ready(&self, runner: &mut Runner, send: &mpsc::SyncSender<Completion>) {
        while runner.flights.len() < WORKERS {
            let Some(work) = runner.queue.pop_front() else {
                break;
            };
            let id = work.prepared.incoming.id.clone();
            let attempt = work.prepared.incoming.attempt;
            let Some(view) = runner.view.as_mut() else {
                break;
            };
            if work.prepared.control.check().is_err() || !self.sessions.valid(&work.binding) {
                if let Some(seen) = view.ledger.get_mut(&id) {
                    seen.progress = Progress::Ready(Err(AppError::TranslationCancelled));
                }
                continue;
            }
            let service = Arc::clone(&self.service);
            let sender = send.clone();
            let control = work.prepared.control.clone();
            let flight_id = work.flight_id.clone();
            let spawn = std::thread::Builder::new()
                .name("geek-translate-message".into())
                .spawn(move || {
                    let result = service.execute(&work.prepared);
                    let _ = sender.send(Completion { work, result });
                });
            if spawn.is_ok() {
                runner
                    .flights
                    .insert(flight_id, ((id.clone(), attempt), control));
                if let Some(seen) = view.ledger.get_mut(&id) {
                    seen.progress = Progress::Running;
                }
            } else if let Some(seen) = view.ledger.get_mut(&id) {
                seen.progress = Progress::Ready(Err(AppError::StateUnavailable));
            }
        }
    }

    fn completed(&self, runner: &mut Runner, receive: &mpsc::Receiver<Completion>) {
        while let Ok(completion) = receive.try_recv() {
            let incoming = &completion.work.prepared.incoming;
            runner.flights.remove(&completion.work.flight_id);
            let Some(view) = runner.view.as_mut() else {
                continue;
            };
            if view.binding != completion.work.binding
                || view.chat_id.as_deref() != Some(incoming.chat_id.as_str())
                || view.subscription.as_deref()
                    != Some(completion.work.prepared.lease.generation.as_str())
                || view.account.translation.revision != incoming.policy_revision
            {
                continue;
            }
            if let Some(seen) = view
                .ledger
                .get_mut(&incoming.id)
                .filter(|seen| seen.attempt == incoming.attempt)
            {
                let result = if completion.work.prepared.control.check().is_err()
                    || self
                        .session
                        .validate_lease(&completion.work.prepared.lease)
                        .is_err()
                {
                    Err(AppError::TranslationCancelled)
                } else {
                    completion.result
                };
                seen.progress = Progress::Ready(result);
            }
        }
    }
}

fn fingerprint(incoming: &IncomingTranslation) -> [u8; 32] {
    let mut digest = Sha256::new();
    for field in [&incoming.chat_id, &incoming.message_id, &incoming.text] {
        digest.update((field.len() as u64).to_le_bytes());
        digest.update(field.as_bytes());
    }
    digest.update(incoming.policy_revision.to_le_bytes());
    digest.update([u8::from(incoming.refresh)]);
    digest.finalize().into()
}

fn auto_after() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(u64::MAX, |value| value.as_secs().saturating_add(1))
}
