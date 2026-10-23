use super::{
    broadcast::{BroadcastService, DispatchControl},
    ports::{BroadcastPlatform, BroadcastRepository},
};
use crate::domain::{
    broadcast::*,
    broadcast_render::{needs_hour, render},
    broadcast_validation::binding_matches,
    error::{AppError, Result},
};
use std::{
    collections::HashSet,
    panic::{catch_unwind, AssertUnwindSafe},
    time::Instant,
};
use uuid::Uuid;

fn random_below(limit: u64) -> u64 {
    if limit <= 1 {
        return 0;
    }
    let bytes = *Uuid::new_v4().as_bytes();
    u64::from_le_bytes(bytes[..8].try_into().expect("eight UUID bytes")) % limit
}

impl<R: BroadcastRepository, P: BroadcastPlatform> BroadcastService<R, P> {
    /// Called by one desktop timer, but also safe against overlapping calls.
    /// Reserves at most four workers durably, then releases the mutex before spawn.
    pub fn tick(&self, now: u64) -> Result<usize> {
        let work = {
            let mut inner = self.lock()?;
            if inner.shutting_down {
                return Ok(0);
            }
            let mut candidate = inner.document.clone();
            for job in &mut candidate.jobs {
                if job.state == BroadcastState::Scheduled
                    && job.scheduled_at.is_some_and(|at| at <= now)
                {
                    job.state = BroadcastState::Queued;
                    job.updated_at = now.max(job.updated_at);
                }
            }
            let mut ordering: Vec<_> = (0..candidate.jobs.len()).collect();
            ordering.sort_by_key(|index| {
                let job = &candidate.jobs[*index];
                (
                    job.next_send_at
                        .or(job.scheduled_at)
                        .unwrap_or(job.created_at),
                    job.created_at,
                    *index,
                )
            });
            let mut owners: HashSet<_> = candidate
                .jobs
                .iter()
                .filter(|job| job.state.owns_account())
                .map(|job| job.account_id.clone())
                .collect();
            let available = MAX_WORKERS.saturating_sub(inner.in_flight.len());
            let mut work = Vec::new();
            for index in ordering {
                if work.len() == available {
                    break;
                }
                let job = &mut candidate.jobs[index];
                if job.review_required
                    || inner.blocked.contains(&job.id)
                    || inner.in_flight.contains_key(&job.id)
                    || job.next_send_at.is_some_and(|at| at > now)
                {
                    continue;
                }
                let eligible = job.state == BroadcastState::Running
                    || (job.state == BroadcastState::Queued && !owners.contains(&job.account_id));
                if !eligible {
                    continue;
                }
                owners.insert(job.account_id.clone());
                let at = now.max(job.updated_at).max(1);
                job.state = if job.binding.is_some() {
                    BroadcastState::Running
                } else {
                    BroadcastState::Starting
                };
                job.started_at.get_or_insert(at);
                job.updated_at = at;
                work.push((job.id.clone(), DispatchControl::default(), at));
            }
            if candidate != inner.document {
                inner.commit(candidate)?;
            }
            for (id, control, _) in &work {
                inner.in_flight.insert(id.clone(), control.clone());
            }
            work
        };
        let count = work.len();
        for (id, control, at) in work {
            let service = self.clone();
            let job_id = id.clone();
            let fallback_control = control.clone();
            let spawned = std::thread::Builder::new()
                .name("geek-broadcast".into())
                .spawn(move || {
                    let started = Instant::now();
                    let result = catch_unwind(AssertUnwindSafe(|| {
                        service.run_step(&job_id, &control, at, started)
                    }));
                    match result {
                        Ok(Ok(())) => {}
                        Ok(Err(_)) => service.block(&job_id),
                        Err(_) => {
                            if service.panic_result(&job_id, &control, at).is_err() {
                                service.block(&job_id);
                            }
                        }
                    }
                    #[cfg(test)]
                    {
                        let hook = service.before_worker_exit.lock().unwrap().take();
                        if let Some(hook) = hook {
                            hook();
                        }
                    }
                    service.finish_worker(&job_id, Self::elapsed_time(at, started));
                });
            if spawned.is_err() {
                if self
                    .prepare_failed(&id, BroadcastIssue::RuntimeFailed, &fallback_control, at)
                    .is_err()
                {
                    self.block(&id);
                }
                self.finish_worker(&id, at);
            }
        }
        Ok(count)
    }

    fn block(&self, id: &str) {
        if let Ok(mut inner) = self.lock() {
            inner.blocked.insert(id.to_owned());
        }
    }

    fn finish_worker(&self, id: &str, at: u64) {
        if let Ok(mut inner) = self.lock() {
            // Stop/invalidation can arrive after settlement but before worker exit.
            // Finalize that late request and release its live slot under one lock.
            if let Ok(index) = inner.document.index(id) {
                let job = &inner.document.jobs[index];
                if job.state == BroadcastState::Stopping && !inner.blocked.contains(id) {
                    if job.checkpoint.is_some() {
                        // Never erase unrecorded dispatch evidence on an exit path.
                        inner.blocked.insert(id.to_owned());
                    } else {
                        let mut candidate = inner.document.clone();
                        let job = &mut candidate.jobs[index];
                        job.finish(BroadcastState::Stopped, at.max(job.updated_at));
                        if inner.commit(candidate).is_err() {
                            inner.blocked.insert(id.to_owned());
                        }
                    }
                }
            }
            inner.in_flight.remove(id);
        }
        self.idle.notify_all();
    }

    fn elapsed_time(at: u64, started: Instant) -> u64 {
        at.saturating_add(started.elapsed().as_millis() as u64)
    }

    fn run_step(
        &self,
        id: &str,
        control: &DispatchControl,
        at: u64,
        started: Instant,
    ) -> Result<()> {
        let job = {
            let inner = self.lock()?;
            inner.document.jobs[inner.document.index(id)?].clone()
        };
        let binding = match &job.binding {
            Some(binding) => binding.clone(),
            None => match self
                .platform
                .acquire_binding(&job.account_id, &job.platform_id)
            {
                Ok(binding) if binding_matches(&binding, &job) => binding,
                Ok(_) => {
                    return self.prepare_failed(
                        id,
                        BroadcastIssue::GuestChanged,
                        control,
                        Self::elapsed_time(at, started),
                    )
                }
                Err(issue) => {
                    return self.prepare_failed(id, issue, control, Self::elapsed_time(at, started))
                }
            },
        };
        let current = {
            let mut inner = self.lock()?;
            let index = inner.document.index(id)?;
            let mut candidate = inner.document.clone();
            let current = &mut candidate.jobs[index];
            if control.cancelled()
                || !matches!(
                    current.state,
                    BroadcastState::Starting | BroadcastState::Running
                )
            {
                if current.state == BroadcastState::Stopping {
                    current.finish(BroadcastState::Stopped, Self::elapsed_time(at, started));
                    inner.commit(candidate)?;
                }
                return Ok(());
            }
            if current.binding.is_none() {
                current.binding = Some(binding.clone());
                current.state = BroadcastState::Running;
                current.updated_at = Self::elapsed_time(at, started);
            }
            let snapshot = current.clone();
            if candidate != inner.document {
                inner.commit(candidate)?;
            }
            snapshot
        };
        if current.current >= current.total {
            return Err(AppError::BroadcastState);
        }
        let rendered_text = if let Some(prepared) = &current.prepared {
            prepared.rendered_text.clone()
        } else {
            let hour = if needs_hour(&current.message) {
                match self.platform.local_hour(&binding) {
                    Ok(hour) if hour < 24 => hour,
                    Ok(_) => {
                        return self.prepare_failed(
                            id,
                            BroadcastIssue::RuntimeFailed,
                            control,
                            Self::elapsed_time(at, started),
                        )
                    }
                    Err(issue) => {
                        return self.prepare_failed(
                            id,
                            issue,
                            control,
                            Self::elapsed_time(at, started),
                        )
                    }
                }
            } else {
                0
            };
            render(
                &current.message,
                &current.targets[current.current],
                hour,
                |length| random_below(length as u64) as usize,
            )?
        };
        let mut request = DispatchRequest {
            job_id: current.id.clone(),
            attempt_id: Uuid::new_v4().to_string(),
            target_id: current.targets[current.current].id.clone(),
            rendered_text,
            tag_all: current.tag_all,
            vcards: current.vcards.clone(),
            attachments: Vec::new(),
        };
        {
            let mut inner = self.lock()?;
            let index = inner.document.index(id)?;
            let mut candidate = inner.document.clone();
            let job = &mut candidate.jobs[index];
            if control.cancelled() || job.state != BroadcastState::Running {
                if job.state == BroadcastState::Stopping {
                    job.finish(BroadcastState::Stopped, Self::elapsed_time(at, started));
                    inner.commit(candidate)?;
                }
                return Ok(());
            }
            if job.current != current.current
                || job.checkpoint.is_some()
                || job.binding.as_ref() != Some(&binding)
            {
                return Err(AppError::BroadcastState);
            }
            job.checkpoint = Some(DispatchCheckpoint {
                attempt_id: request.attempt_id.clone(),
                index: job.current,
            });
            job.prepared = Some(PreparedMessage {
                index: job.current,
                rendered_text: request.rendered_text.clone(),
            });
            job.next_send_at = None;
            job.updated_at = Self::elapsed_time(at, started);
            inner.commit(candidate)?;
        }
        request.attachments =
            self.dispatch_sources(&current.account_id, id, &request.attempt_id)?;
        let outcome = if control.cancelled() {
            DispatchOutcome::NotSubmitted {
                code: BroadcastIssue::Cancelled,
            }
        } else {
            self.platform.dispatch(&binding, &request, control)
        };
        self.settle(
            id,
            &request.attempt_id,
            outcome,
            control,
            Self::elapsed_time(at, started),
        )
    }

    fn prepare_failed(
        &self,
        id: &str,
        issue: BroadcastIssue,
        control: &DispatchControl,
        at: u64,
    ) -> Result<()> {
        let mut inner = self.lock()?;
        let mut candidate = inner.document.clone();
        let index = candidate.index(id)?;
        let job = &mut candidate.jobs[index];
        let now = at.max(job.updated_at);
        if job.state == BroadcastState::Stopping {
            job.finish(BroadcastState::Stopped, now);
        } else if control.cancelled() || job.state == BroadcastState::Paused {
            return Ok(());
        } else if issue == BroadcastIssue::AccountUnavailable
            && job.scheduled_at.is_some()
            && job.binding.is_none()
            && job.current == 0
        {
            job.prepare_attempts += 1;
            job.last_issue = Some(issue);
            job.updated_at = now;
            if job.prepare_attempts >= MAX_PREPARE_ATTEMPTS {
                job.last_issue = Some(BroadcastIssue::ScheduleAccountUnavailable);
                job.finish(BroadcastState::Failed, now);
            } else {
                job.state = BroadcastState::Queued;
                job.next_send_at = Some(
                    now.saturating_add((500 + u64::from(job.prepare_attempts) * 250).min(5_000)),
                );
            }
        } else if issue == BroadcastIssue::GuestChanged {
            job.interrupt(now, issue);
        } else {
            job.last_issue = Some(issue);
            job.finish(BroadcastState::Failed, now);
        }
        inner.commit(candidate)
    }

    fn settle(
        &self,
        id: &str,
        attempt_id: &str,
        mut outcome: DispatchOutcome,
        control: &DispatchControl,
        at: u64,
    ) -> Result<()> {
        let mut inner = self.lock()?;
        let mut candidate = inner.document.clone();
        let index = candidate.index(id)?;
        let job = &mut candidate.jobs[index];
        if !job.checkpoint.as_ref().is_some_and(|checkpoint| {
            checkpoint.attempt_id == attempt_id && checkpoint.index == job.current
        }) {
            return Err(AppError::BroadcastState);
        }
        let now = at.max(job.updated_at);
        outcome = match outcome {
            DispatchOutcome::Confirmed { ref receipt }
                if receipt.trim().is_empty()
                    || receipt.encode_utf16().count() > 1_024
                    || receipt.chars().any(char::is_control) =>
            {
                DispatchOutcome::Uncertain {
                    code: BroadcastIssue::ReceiptMissing,
                }
            }
            DispatchOutcome::Confirmed { .. } if !control.committed() => {
                DispatchOutcome::Uncertain {
                    code: BroadcastIssue::RuntimeFailed,
                }
            }
            DispatchOutcome::NotSubmitted { code } if control.committed() => {
                DispatchOutcome::Uncertain { code }
            }
            result => result,
        };
        let stopped = job.state == BroadcastState::Stopping;
        let paused = job.state == BroadcastState::Paused || inner.shutting_down;
        let cancelled_before_commit = !control.committed()
            && matches!(
                outcome,
                DispatchOutcome::NotSubmitted {
                    code: BroadcastIssue::Cancelled
                }
            );
        let unavailable_before_commit = !control.committed()
            && matches!(
                outcome,
                DispatchOutcome::NotSubmitted {
                    code: BroadcastIssue::AccountUnavailable
                }
            );
        let attachment_failed_before_commit = !control.committed()
            && matches!(
                outcome,
                DispatchOutcome::NotSubmitted {
                    code: BroadcastIssue::AttachmentUnavailable | BroadcastIssue::AttachmentChanged,
                }
            );
        let uncertain = matches!(outcome, DispatchOutcome::Uncertain { .. });
        let guest_changed = matches!(
            outcome,
            DispatchOutcome::NotSubmitted {
                code: BroadcastIssue::GuestChanged
            }
        );
        if cancelled_before_commit || unavailable_before_commit {
            job.checkpoint = None;
            job.updated_at = now;
            if unavailable_before_commit {
                job.last_issue = Some(BroadcastIssue::AccountUnavailable);
            }
        } else {
            job.record(outcome, now);
        }
        if stopped {
            job.review_required |= uncertain;
            job.finish(BroadcastState::Stopped, now);
        } else if attachment_failed_before_commit {
            job.finish(BroadcastState::Failed, now);
        } else if uncertain || guest_changed {
            job.state = BroadcastState::Paused;
            job.review_required = true;
            job.next_send_at = None;
        } else if job.current == job.total {
            job.finish(BroadcastState::Completed, now);
        } else if paused || cancelled_before_commit || unavailable_before_commit {
            job.state = BroadcastState::Paused;
            job.next_send_at = None;
        } else {
            job.state = BroadcastState::Running;
            let delay =
                job.interval_min_ms + random_below(job.interval_max_ms - job.interval_min_ms + 1);
            job.next_send_at = Some(now.saturating_add(delay));
        }
        inner.commit(candidate)
    }

    fn panic_result(&self, id: &str, control: &DispatchControl, now: u64) -> Result<()> {
        let checkpoint = {
            let inner = self.lock()?;
            inner.document.jobs[inner.document.index(id)?]
                .checkpoint
                .clone()
        };
        if let Some(checkpoint) = checkpoint {
            self.settle(
                id,
                &checkpoint.attempt_id,
                DispatchOutcome::Uncertain {
                    code: BroadcastIssue::RuntimeFailed,
                },
                control,
                now,
            )
        } else {
            self.prepare_failed(id, BroadcastIssue::RuntimeFailed, control, now)
        }
    }
}
