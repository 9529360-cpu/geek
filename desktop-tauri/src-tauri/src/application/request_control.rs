//! One monotonic budget and explicit cancellation across queue, auth and response reads.
use crate::domain::error::{AppError, Result};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

#[cfg(test)]
mod tests;

#[derive(Clone)]
pub struct RequestControl {
    deadline: Instant,
    own_cancel: Arc<AtomicBool>,
    parents: Vec<Arc<AtomicBool>>,
}

impl RequestControl {
    pub fn new(timeout: Duration) -> Self {
        Self {
            deadline: Instant::now() + timeout,
            own_cancel: Arc::new(AtomicBool::new(false)),
            parents: Vec::new(),
        }
    }

    pub fn with_cancel(mut self, cancelled: Arc<AtomicBool>) -> Self {
        self.parents.push(cancelled);
        self
    }

    /// A child budget can only shorten the deadline and shares all cancellation.
    pub fn limited(&self, timeout: Duration) -> Self {
        let deadline = Instant::now()
            .checked_add(timeout)
            .map_or(self.deadline, |deadline| self.deadline.min(deadline));
        Self {
            deadline,
            ..self.clone()
        }
    }

    pub fn cancel(&self) {
        self.own_cancel.store(true, Ordering::Release);
    }

    pub fn check(&self) -> Result<()> {
        if self.own_cancel.load(Ordering::Acquire)
            || self.parents.iter().any(|flag| flag.load(Ordering::Acquire))
        {
            return Err(AppError::TranslationCancelled);
        }
        if Instant::now() >= self.deadline {
            return Err(AppError::TranslationTimeout);
        }
        Ok(())
    }

    pub fn remaining(&self) -> Result<Duration> {
        self.check()?;
        self.deadline
            .checked_duration_since(Instant::now())
            .filter(|time| time.as_millis() > 0)
            .ok_or(AppError::TranslationTimeout)
    }

    pub fn wait(&self, duration: Duration) -> Result<()> {
        let until = Instant::now() + duration;
        loop {
            self.check()?;
            let Some(remaining) = until.checked_duration_since(Instant::now()) else {
                return Ok(());
            };
            std::thread::sleep(
                remaining
                    .min(self.remaining()?)
                    .min(Duration::from_millis(25)),
            );
        }
    }
}
