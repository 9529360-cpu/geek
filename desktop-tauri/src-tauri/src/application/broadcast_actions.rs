use super::{
    broadcast::BroadcastService,
    ports::{BroadcastPlatform, BroadcastRepository},
};
use crate::domain::{
    broadcast::*,
    error::{AppError, Result},
};

impl<R: BroadcastRepository, P: BroadcastPlatform> BroadcastService<R, P> {
    pub fn control(&self, id: &str, action: BroadcastAction, now: u64) -> Result<BroadcastJob> {
        let mut inner = self.lock()?;
        let index = inner.document.index(id)?;
        let previous = &inner.document.jobs[index];
        if previous.state.terminal() {
            if action != BroadcastAction::Dismiss || previous.dismissed {
                return Ok(inner.projected(previous));
            }
        } else if action == BroadcastAction::Dismiss {
            return Err(AppError::BroadcastState);
        }
        if inner.shutting_down && action == BroadcastAction::Resume {
            return Err(AppError::BroadcastUnavailable);
        }
        let mut candidate = inner.document.clone();
        let job = &mut candidate.jobs[index];
        let at = now.max(job.updated_at).max(1);
        let was_blocked = inner.blocked.contains(id);
        let live = inner.in_flight.get(id).cloned();
        if was_blocked {
            if live.is_some() {
                return Err(AppError::BroadcastState);
            }
            job.interrupt(at, BroadcastIssue::PersistenceFailed);
        }
        match action {
            BroadcastAction::Pause => {
                if matches!(job.state, BroadcastState::Paused | BroadcastState::Stopping) {
                    if !was_blocked {
                        return Ok(inner.projected(previous));
                    }
                } else if matches!(
                    job.state,
                    BroadcastState::Running | BroadcastState::Starting
                ) {
                    job.state = BroadcastState::Paused;
                    job.next_send_at = None;
                } else {
                    return Err(AppError::BroadcastState);
                }
            }
            BroadcastAction::Resume => {
                if live.is_some() {
                    return Err(AppError::BroadcastState);
                }
                if job.state != BroadcastState::Paused && !job.review_required {
                    return Ok(inner.projected(previous));
                }
                if job.review_required {
                    job.binding = None;
                    job.prepare_attempts = 0;
                }
                job.review_required = false;
                job.next_send_at = None;
                if job.current == job.total {
                    job.finish(BroadcastState::Completed, at);
                } else if job.binding.is_some() {
                    job.state = BroadcastState::Running;
                } else {
                    job.state = BroadcastState::Queued;
                }
            }
            BroadcastAction::Stop => {
                if job.state == BroadcastState::Stopping {
                    return Ok(inner.projected(previous));
                }
                if live.is_some() {
                    job.state = BroadcastState::Stopping;
                } else {
                    job.finish(BroadcastState::Stopped, at);
                }
                job.next_send_at = None;
            }
            BroadcastAction::Dismiss => job.dismissed = true,
        }
        job.updated_at = at;
        let result = job.clone();
        inner.commit(candidate)?;
        inner.blocked.remove(id);
        // The worker cannot inspect the committed job until this lock is released.
        // Native commit races cancellation through DispatchControl's atomic gate.
        if matches!(action, BroadcastAction::Pause | BroadcastAction::Stop) {
            if let Some(control) = live {
                control.cancel();
            }
        }
        Ok(result)
    }

    /// Account lifecycle calls this without holding Workspace. An in-flight commit
    /// is allowed to settle, but this job can never acquire a replacement generation.
    pub fn invalidate_account(&self, account_id: &str, now: u64) -> Result<()> {
        let mut inner = self.lock()?;
        let mut candidate = inner.document.clone();
        let mut ids = Vec::new();
        for job in &mut candidate.jobs {
            if job.account_id != account_id || job.state.terminal() {
                continue;
            }
            let at = now.max(job.updated_at).max(1);
            if inner.blocked.contains(&job.id) {
                job.interrupt(at, BroadcastIssue::PersistenceFailed);
            }
            job.last_issue = Some(BroadcastIssue::GuestChanged);
            job.review_required = true;
            job.next_send_at = None;
            job.updated_at = at;
            if inner.in_flight.contains_key(&job.id) {
                job.state = BroadcastState::Stopping;
            } else {
                job.finish(BroadcastState::Stopped, at);
            }
            ids.push(job.id.clone());
        }
        if ids.is_empty() {
            return Ok(());
        }
        inner.commit(candidate)?;
        for id in ids {
            if let Some(control) = inner.in_flight.get(&id) {
                control.cancel();
            }
            inner.blocked.remove(&id);
        }
        Ok(())
    }
}
