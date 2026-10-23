use super::{
    request_control::RequestControl,
    session::{PendingLogin, QuotaAuthority, SessionLease, SessionService},
    session_ports::{SessionRepository, SessionTransport},
};
use crate::domain::{
    error::{AppError, Result},
    session::*,
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use uuid::Uuid;
use zeroize::Zeroizing;

impl<R: SessionRepository, T: SessionTransport> SessionService<R, T> {
    pub fn login(&self, email: &str, password: String) -> Result<SessionSnapshot> {
        let password = Zeroizing::new(password);
        let email = email.trim().to_lowercase();
        if !valid_email(&email) || password.is_empty() || password.len() > 1_024 {
            return Err(AppError::SessionInvalid);
        }
        let id = Uuid::new_v4().to_string();
        let cancel = Arc::new(AtomicBool::new(false));
        let generation = {
            let mut inner = self.lock()?;
            if let Some(previous) = inner.pending_login.take() {
                previous.cancel.store(true, Ordering::Release);
            }
            let generation = inner.generation.clone();
            inner.pending_login = Some(PendingLogin {
                id: id.clone(),
                generation: generation.clone(),
                cancel: Arc::clone(&cancel),
            });
            generation
        };
        let control = RequestControl::new(Duration::from_secs(30)).with_cancel(cancel);
        let response = (|| {
            control.check()?;
            let login = self.transport.login(&email, password.as_str(), &control)?;
            self.lock()?.validate_login(&id, &generation)?;
            control.check()?;
            if !login.token.valid() || !login.user.valid() || login.user.email != email {
                return Err(AppError::NetworkResponseInvalid);
            }
            let refreshed = self.transport.refresh(login.token.as_str(), &control)?;
            control.check()?;
            if !refreshed.user.valid()
                || refreshed.user != login.user
                || !valid_quota(refreshed.remaining_chars)
            {
                return Err(AppError::NetworkResponseInvalid);
            }
            Ok((login, refreshed))
        })();
        let mut inner = self.lock()?;
        inner.validate_login(&id, &generation)?;
        let (login, refreshed) = match response {
            Ok(response) => response,
            Err(error) => {
                inner.pending_login = None;
                inner.issue = SessionIssue::from_error(error);
                return Err(error);
            }
        };
        let mut candidate = inner.document.clone();
        candidate.record = Some(SessionRecord {
            token: login.token,
            user: refreshed.user,
            remaining_chars: Some(refreshed.remaining_chars),
        });
        if let Err(error) = inner.commit(candidate) {
            inner.pending_login = None;
            inner.issue = Some(SessionIssue::PersistenceFailed);
            return Err(error);
        }
        inner.replace_generation();
        inner.authority = Some(QuotaAuthority {
            value: refreshed.remaining_chars,
            checked_at: self.clock.now_ms(),
        });
        inner.issue = None;
        inner.snapshot(self.clock.now_ms())
    }

    pub fn logout(&self) -> Result<SessionSnapshot> {
        let mut inner = self.lock()?;
        let mut candidate = inner.document.clone();
        candidate.record = None;
        if let Err(error) = inner.commit(candidate) {
            inner.issue = Some(SessionIssue::PersistenceFailed);
            return Err(error);
        }
        inner.replace_generation();
        inner.issue = None;
        inner.snapshot(self.clock.now_ms())
    }

    pub fn refresh(&self) -> Result<SessionSnapshot> {
        let lease = self.capture_lease()?;
        let control =
            RequestControl::new(Duration::from_secs(30)).with_cancel(Arc::clone(&lease.cancel));
        let response = self
            .transport
            .refresh(lease.token.as_str(), &control)
            .and_then(|value| {
                control.check()?;
                Ok(value)
            });
        let mut inner = self.lock()?;
        inner.validate_lease(&lease)?;
        let refreshed = match response {
            Ok(value) => value,
            Err(error @ (AppError::SessionRequired | AppError::SessionAccountDisabled)) => {
                drop(inner);
                return self.reject_auth(&lease, error);
            }
            Err(error) => {
                inner.issue = SessionIssue::from_error(error);
                return Err(error);
            }
        };
        if !refreshed.user.valid()
            || !valid_quota(refreshed.remaining_chars)
            || inner
                .document
                .record
                .as_ref()
                .is_none_or(|record| record.user != refreshed.user)
        {
            inner.issue = Some(SessionIssue::ResponseInvalid);
            return Err(AppError::NetworkResponseInvalid);
        }
        self.accept_quota_locked(
            &mut inner,
            Some(refreshed.remaining_chars),
            self.clock.now_ms(),
        )
    }

    pub fn reject_unauthorized(&self, lease: &SessionLease) -> Result<SessionSnapshot> {
        self.reject_auth(lease, AppError::SessionRequired)
    }

    /// Only current authentication denial can replace the durable session.
    pub fn reject_auth(&self, lease: &SessionLease, reason: AppError) -> Result<SessionSnapshot> {
        if !matches!(
            reason,
            AppError::SessionRequired | AppError::SessionAccountDisabled
        ) {
            return Err(AppError::SessionInvalid);
        }
        let mut inner = self.lock()?;
        inner.validate_lease(lease)?;
        let mut candidate = inner.document.clone();
        candidate.record = None;
        if let Err(error) = inner.commit(candidate) {
            // The server has positively denied this identity. Keep the durable
            // record visible when its removal fails, but do not let an already
            // issued short token authorize more work under this generation.
            inner.auth_blocked = true;
            inner.authority = None;
            inner.cancel.store(true, Ordering::Release);
            inner.issue = Some(SessionIssue::PersistenceFailed);
            return Err(error);
        }
        inner.replace_generation();
        inner.issue = SessionIssue::from_error(reason);
        inner.snapshot(self.clock.now_ms())
    }
}
