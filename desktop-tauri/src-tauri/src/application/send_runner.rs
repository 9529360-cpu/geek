//! One foreground worker and one waiting intent, independent from incoming translation.
use super::{
    send_intent::{Admission, SendIntents, SendTicket},
    send_ports::{SendPlatform, SendTransform, SendView},
};
use crate::domain::{
    error::{AppError, Result},
    send_intent::SendStatus,
};
use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};

pub struct SendRunner {
    owner: Mutex<SendIntents>,
    platform: Arc<dyn SendPlatform>,
    transform: Arc<dyn SendTransform>,
    stop: Arc<AtomicBool>,
}

struct View {
    value: SendView,
    session: Option<String>,
}

struct Flight {
    ticket: Box<SendTicket>,
    cancelled: bool,
}

struct WorkerExit(mpsc::SyncSender<()>);

impl Drop for WorkerExit {
    fn drop(&mut self) {
        let _ = self.0.try_send(());
    }
}

#[derive(Default)]
struct Runner {
    view: Option<View>,
    queued: Option<Box<SendTicket>>,
    flight: Option<Flight>,
}

impl SendRunner {
    pub fn new(platform: Arc<dyn SendPlatform>, transform: Arc<dyn SendTransform>) -> Self {
        Self {
            owner: Mutex::new(SendIntents::new()),
            platform,
            transform,
            stop: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn start(self: &Arc<Self>) -> Result<()> {
        let owner = Arc::clone(self);
        std::thread::Builder::new()
            .name("geek-outgoing-send".into())
            .spawn(move || {
                let (send, receive) = mpsc::sync_channel(1);
                let mut runner = Runner::default();
                while !owner.stop.load(Ordering::Acquire) {
                    while receive.try_recv().is_ok() {
                        // A cancelled thread occupies the slot until its actual exit.
                        runner.flight = None;
                    }
                    if owner.poll(&mut runner).is_err() {
                        owner.suspend(&mut runner);
                    }
                    owner.start_ready(&mut runner, &send);
                    std::thread::sleep(Duration::from_millis(150));
                }
                owner.suspend(&mut runner);
            })
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(())
    }

    pub fn shutdown(&self) {
        self.stop.store(true, Ordering::Release);
        if let Ok(mut owner) = self.owner.lock() {
            owner.cancel_all(AppError::TranslationCancelled);
        }
    }

    fn suspend(&self, runner: &mut Runner) {
        if let Ok(mut owner) = self.owner.lock() {
            owner.cancel_all(AppError::TranslationCancelled);
        }
        self.cancel_pending(runner, None);
        if let Some(view) = runner.view.take() {
            let _ = self
                .platform
                .configure(&view.value, view.session.as_deref(), false);
        }
    }

    fn cancel_pending(&self, runner: &mut Runner, pending: Option<(&str, u32)>) {
        if let Some(ticket) = runner.queued.take() {
            if pending == Some((ticket.request.id.as_str(), ticket.request.attempt)) {
                runner.queued = Some(ticket);
            } else {
                ticket.control.cancel();
                self.fail(&ticket, AppError::TranslationCancelled);
                self.platform
                    .cancel(&ticket.binding, &ticket.request.id, ticket.request.attempt);
            }
        }
        if let Some(flight) = &mut runner.flight {
            let ticket = &flight.ticket;
            if !flight.cancelled
                && pending != Some((ticket.request.id.as_str(), ticket.request.attempt))
            {
                flight.cancelled = true;
                ticket.control.cancel();
                if let Ok(mut owner) = self.owner.lock() {
                    let _ = owner.fail(ticket, AppError::TranslationCancelled);
                }
                self.platform
                    .cancel(&ticket.binding, &ticket.request.id, ticket.request.attempt);
            }
        }
    }

    fn poll(&self, runner: &mut Runner) -> Result<()> {
        let Some(current) = self.platform.current()? else {
            self.suspend(runner);
            return Ok(());
        };
        let session = self.transform.generation();
        let changed = runner
            .view
            .as_ref()
            .is_none_or(|view| !same_view(&view.value, &current) || view.session != session);
        if changed {
            self.suspend(runner);
            runner.view = Some(View {
                value: current.clone(),
                session: session.clone(),
            });
        }
        self.platform
            .configure(&current, session.as_deref(), true)?;
        let frame = self.platform.poll(&current.binding)?;
        if !self
            .platform
            .current()?
            .is_some_and(|value| same_view(&value, &current))
            || self.transform.generation() != session
        {
            return Err(AppError::SendIntentChanged);
        }
        let pending = frame
            .request
            .as_ref()
            .map(|request| (request.id.as_str(), request.attempt));
        self.cancel_pending(runner, pending);
        let Some(request) = frame.request else {
            return Ok(());
        };
        request.validate()?;
        if frame.chat_id.as_deref() != Some(request.chat_id.as_str()) {
            return Err(AppError::SendIntentChanged);
        }
        let observed = runner
            .queued
            .as_deref()
            .into_iter()
            .chain(runner.flight.as_ref().map(|flight| flight.ticket.as_ref()))
            .find(|ticket| {
                ticket.request.id == request.id && ticket.request.attempt == request.attempt
            });
        if let Some(ticket) = observed {
            if ticket.request != request {
                ticket.control.cancel();
                self.fail(ticket, AppError::SendIntentConflict);
                self.platform
                    .cancel(&ticket.binding, &ticket.request.id, ticket.request.attempt);
                return Err(AppError::SendIntentConflict);
            }
            return Ok(());
        }
        let admission = self
            .owner
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .admit(
                current.account.clone(),
                current.binding.clone(),
                session,
                request.clone(),
            );
        match admission {
            Ok(Admission::Status(status)) => self.platform.deliver(&current.binding, &status)?,
            Ok(Admission::Start(mut ticket)) => {
                let binding = self.platform.cancellation(&ticket.binding);
                let attached = binding.and_then(|flag| {
                    ticket.control = ticket
                        .control
                        .clone()
                        .with_cancel(flag)
                        .with_cancel(Arc::clone(&self.stop));
                    self.transform.bind(&mut ticket)
                });
                if let Err(error) = attached {
                    self.fail(&ticket, error);
                } else {
                    runner.queued = Some(ticket);
                }
            }
            Err(error) => self.platform.reject(&current.binding, &request, error),
        }
        Ok(())
    }

    fn current(&self, ticket: &SendTicket) -> Result<()> {
        ticket.control.check()?;
        let expected = SendView {
            account: ticket.account.clone(),
            binding: ticket.binding.clone(),
        };
        if !self
            .platform
            .current()?
            .is_some_and(|view| same_view(&view, &expected))
        {
            return Err(AppError::SendIntentChanged);
        }
        self.transform.validate(ticket)
    }

    fn perform(&self, ticket: &SendTicket) -> Result<SendStatus> {
        self.current(ticket)?;
        let text = match &ticket.output {
            Some(output) => output.clone(),
            None => self.transform.execute(ticket)?,
        };
        // Keep successful paid output even if cancellation won the race just after it.
        self.owner
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .remember_output(ticket, text.clone())?;
        self.current(ticket)?;
        self.platform.prepare(ticket, &text)?;
        self.current(ticket)?;
        let admitted = self
            .owner
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .begin_commit(ticket)?;
        if !admitted {
            return self
                .owner
                .lock()
                .map_err(|_| AppError::StateUnavailable)?
                .status(&ticket.request.id)
                .ok_or(AppError::SendIntentState);
        }
        let outcome = self
            .platform
            .commit(ticket, &uuid::Uuid::new_v4().to_string());
        self.owner
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .settle(ticket, outcome)
    }

    fn fail(&self, ticket: &SendTicket, error: AppError) {
        let status = self
            .owner
            .lock()
            .ok()
            .and_then(|mut owner| owner.fail(ticket, error).ok());
        if let Some(status) = status.filter(|status| status.attempt == ticket.request.attempt) {
            let _ = self.platform.deliver(&ticket.binding, &status);
        }
    }

    fn start_ready(self: &Arc<Self>, runner: &mut Runner, sender: &mpsc::SyncSender<()>) {
        if runner.flight.is_some() {
            return;
        }
        let Some(ticket) = runner.queued.take() else {
            return;
        };
        if let Err(error) = self.current(&ticket) {
            self.fail(&ticket, error);
            return;
        }
        let flight = Flight {
            ticket: ticket.clone(),
            cancelled: false,
        };
        let worker = Arc::clone(self);
        let sender = sender.clone();
        let fallback = ticket.clone();
        let spawned = std::thread::Builder::new()
            .name("geek-send-intent".into())
            .spawn(move || {
                let _exit = WorkerExit(sender);
                let result = catch_unwind(AssertUnwindSafe(|| worker.perform(&ticket)))
                    .unwrap_or(Err(AppError::StateUnavailable));
                match result {
                    Ok(status) => {
                        let _ = worker.platform.deliver(&ticket.binding, &status);
                    }
                    Err(error) => worker.fail(&ticket, error),
                }
            });
        if spawned.is_ok() {
            runner.flight = Some(flight);
        } else {
            self.fail(&fallback, AppError::StateUnavailable);
        }
    }
}

fn same_view(left: &SendView, right: &SendView) -> bool {
    left.binding == right.binding
        && left.account.id == right.account.id
        && left.account.translation.revision == right.account.translation.revision
        && left.account.proxy == right.account.proxy
        && !left.account.archived
        && !right.account.archived
}

#[cfg(test)]
mod tests;
