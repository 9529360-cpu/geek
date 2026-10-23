use super::{
    session::{QuotaAuthority, SessionInner, SessionLease, SessionService},
    session_ports::{SessionRepository, SessionTransport},
};
use crate::domain::{
    error::{AppError, Result},
    session::{valid_quota, SessionIssue, SessionSnapshot},
};

impl<R: SessionRepository, T: SessionTransport> SessionService<R, T> {
    /// Read-only authority check. The caller chooses the frozen account egress for
    /// any required quota request; this method never performs a System request.
    pub fn authoritative_quota(&self, lease: &SessionLease) -> Result<Option<u64>> {
        let mut inner = self.lock()?;
        inner.validate_lease(lease)?;
        Ok(inner.current_quota(self.clock.now_ms()))
    }

    pub fn accept_quota(
        &self,
        lease: &SessionLease,
        remaining: Option<u64>,
    ) -> Result<SessionSnapshot> {
        let mut inner = self.lock()?;
        inner.validate_lease(lease)?;
        self.accept_quota_locked(&mut inner, remaining, self.clock.now_ms())
    }

    pub(super) fn accept_quota_locked(
        &self,
        inner: &mut SessionInner<R>,
        remaining: Option<u64>,
        now: u64,
    ) -> Result<SessionSnapshot> {
        let Some(value) = remaining else {
            inner.authority = None;
            return inner.snapshot(now);
        };
        if !valid_quota(value) {
            inner.authority = None;
            inner.issue = Some(SessionIssue::ResponseInvalid);
            return Err(AppError::NetworkResponseInvalid);
        }
        let effective = inner
            .current_quota(now)
            .map_or(value, |current| current.min(value));
        inner.authority = Some(QuotaAuthority {
            value: effective,
            checked_at: now,
        });
        let mut candidate = inner.document.clone();
        let record = candidate.record.as_mut().ok_or(AppError::SessionRequired)?;
        record.remaining_chars = Some(effective);
        if candidate != inner.document && inner.commit(candidate).is_err() {
            // The translation has already completed and may have been charged.
            // A failed mirror write cannot turn its result into a retry signal.
            inner.issue = Some(SessionIssue::PersistenceFailed);
        } else {
            inner.issue = None;
        }
        inner.snapshot(now)
    }
}
