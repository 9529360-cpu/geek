use super::TranslationDesktop;
use crate::{
    application::request_control::RequestControl,
    domain::{
        error::{AppError, Result},
        translation_health::TranslationHealthSnapshot,
    },
};
use std::{
    sync::{atomic::AtomicBool, Arc, Mutex, TryLockError},
    time::Duration,
};

impl TranslationDesktop {
    /// Called on the common blocking executor. This path never holds Workspace
    /// and one explicit gate bounds repeated UI invocations without a new queue.
    pub fn health(&self) -> Result<TranslationHealthSnapshot> {
        run_health(&self.health_gate, Arc::clone(&self.stop), |control| {
            self.service.health(control)
        })
    }
}

fn run_health(
    gate: &Mutex<()>,
    stop: Arc<AtomicBool>,
    operation: impl FnOnce(&RequestControl) -> Result<TranslationHealthSnapshot>,
) -> Result<TranslationHealthSnapshot> {
    let control = RequestControl::new(Duration::from_secs(5)).with_cancel(stop);
    control.check()?;
    let _guard = gate.try_lock().map_err(|error| match error {
        TryLockError::WouldBlock => AppError::TranslationInProgress,
        TryLockError::Poisoned(_) => AppError::StateUnavailable,
    })?;
    control.check()?;
    operation(&control)
}

#[cfg(test)]
mod tests;
