//! Independent durable authentication owner. Network operations never hold its lock.
use super::session_ports::{SessionClock, SessionRepository, SessionTransport, SystemSessionClock};
use crate::domain::{
    error::{AppError, Result},
    session::*,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, MutexGuard,
};
use uuid::Uuid;

#[derive(Clone)]
pub struct SessionLease {
    pub generation: String,
    pub token: SessionToken,
    pub cancel: Arc<AtomicBool>,
}

pub(super) struct PendingLogin {
    pub id: String,
    pub generation: String,
    pub cancel: Arc<AtomicBool>,
}

pub(super) struct QuotaAuthority {
    pub value: u64,
    pub checked_at: u64,
}

pub(super) struct SessionInner<R> {
    pub repository: R,
    pub document: SessionDocument,
    pub generation: String,
    pub cancel: Arc<AtomicBool>,
    pub pending_login: Option<PendingLogin>,
    pub authority: Option<QuotaAuthority>,
    pub auth_blocked: bool,
    pub issue: Option<SessionIssue>,
    visible_revision: u64,
    last_view: Option<SessionSnapshot>,
}

impl<R: SessionRepository> SessionInner<R> {
    pub fn commit(&mut self, mut candidate: SessionDocument) -> Result<()> {
        let revision = self
            .visible_revision
            .checked_add(1)
            .ok_or(AppError::StoreInvalid)?;
        candidate.revision = revision;
        candidate.validate()?;
        self.repository
            .save(&candidate)
            .map_err(|_| AppError::SessionPersistence)?;
        self.document = candidate;
        self.visible_revision = revision;
        self.last_view = None;
        Ok(())
    }

    pub fn current_quota(&mut self, now: u64) -> Option<u64> {
        let current = self
            .authority
            .as_ref()
            .filter(|authority| {
                now.checked_sub(authority.checked_at)
                    .is_some_and(|age| age < QUOTA_AUTHORITY_TTL_MS)
            })
            .map(|authority| authority.value);
        if current.is_none() {
            self.authority = None;
        }
        current
    }

    pub fn snapshot(&mut self, now: u64) -> Result<SessionSnapshot> {
        let quota = self.current_quota(now);
        let record = self.document.record.as_ref();
        let mut view = SessionSnapshot {
            revision: 0,
            state: if record.is_some() {
                SessionState::SignedIn
            } else {
                SessionState::SignedOut
            },
            user: record.map(|record| record.user.clone()),
            remaining_chars: quota.or_else(|| record.and_then(|record| record.remaining_chars)),
            quota_fresh: quota.is_some() && record.is_some(),
            issue: self.issue,
        };
        if self
            .last_view
            .as_ref()
            .is_some_and(|previous| previous != &view)
        {
            self.visible_revision = self
                .visible_revision
                .checked_add(1)
                .ok_or(AppError::StoreInvalid)?;
        }
        self.last_view = Some(view.clone());
        view.revision = self.visible_revision;
        Ok(view)
    }

    pub fn validate_lease(&self, lease: &SessionLease) -> Result<()> {
        if lease.generation != self.generation
            || !Arc::ptr_eq(&lease.cancel, &self.cancel)
            || self
                .document
                .record
                .as_ref()
                .is_none_or(|record| record.token != lease.token)
        {
            return Err(AppError::SessionChanged);
        }
        if self.auth_blocked {
            return Err(AppError::SessionRequired);
        }
        if lease.cancel.load(Ordering::Acquire) {
            return Err(AppError::SessionChanged);
        }
        Ok(())
    }

    pub fn validate_login(&self, id: &str, generation: &str) -> Result<()> {
        if self.generation != generation
            || !self.pending_login.as_ref().is_some_and(|pending| {
                pending.id == id
                    && pending.generation == generation
                    && !pending.cancel.load(Ordering::Acquire)
            })
        {
            return Err(AppError::SessionChanged);
        }
        Ok(())
    }

    pub fn replace_generation(&mut self) {
        self.cancel.store(true, Ordering::Release);
        self.cancel = Arc::new(AtomicBool::new(false));
        self.generation = Uuid::new_v4().to_string();
        if let Some(pending) = self.pending_login.take() {
            pending.cancel.store(true, Ordering::Release);
        }
        self.authority = None;
        self.auth_blocked = false;
    }
}

pub struct SessionService<R: SessionRepository, T: SessionTransport> {
    pub(super) inner: Arc<Mutex<SessionInner<R>>>,
    pub(super) transport: Arc<T>,
    pub(super) clock: Arc<dyn SessionClock>,
}

impl<R: SessionRepository, T: SessionTransport> Clone for SessionService<R, T> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            transport: Arc::clone(&self.transport),
            clock: Arc::clone(&self.clock),
        }
    }
}

impl<R: SessionRepository, T: SessionTransport> SessionService<R, T> {
    pub fn open(repository: R, transport: Arc<T>) -> Result<Self> {
        Self::open_with_clock(
            repository,
            transport,
            Arc::new(SystemSessionClock::default()),
        )
    }

    pub fn open_with_clock(
        repository: R,
        transport: Arc<T>,
        clock: Arc<dyn SessionClock>,
    ) -> Result<Self> {
        let document = repository.load()?.unwrap_or_default();
        document.validate()?;
        let visible_revision = document.revision;
        Ok(Self {
            inner: Arc::new(Mutex::new(SessionInner {
                repository,
                document,
                generation: Uuid::new_v4().to_string(),
                cancel: Arc::new(AtomicBool::new(false)),
                pending_login: None,
                authority: None,
                auth_blocked: false,
                issue: None,
                visible_revision,
                last_view: None,
            })),
            transport,
            clock,
        })
    }

    pub(super) fn lock(&self) -> Result<MutexGuard<'_, SessionInner<R>>> {
        self.inner.lock().map_err(|_| AppError::StateUnavailable)
    }

    pub fn snapshot(&self) -> Result<SessionSnapshot> {
        self.lock()?.snapshot(self.clock.now_ms())
    }

    pub fn capture_lease(&self) -> Result<SessionLease> {
        let inner = self.lock()?;
        if inner.auth_blocked {
            return Err(AppError::SessionRequired);
        }
        let record = inner
            .document
            .record
            .as_ref()
            .ok_or(AppError::SessionRequired)?;
        Ok(SessionLease {
            generation: inner.generation.clone(),
            token: record.token.clone(),
            cancel: Arc::clone(&inner.cancel),
        })
    }

    pub fn validate_lease(&self, lease: &SessionLease) -> Result<()> {
        self.lock()?.validate_lease(lease)
    }
}
