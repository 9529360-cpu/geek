//! One independent job owner. Native work is never performed under this mutex.
use super::broadcast_attachments::StagedAttachment;
use super::ports::{BroadcastPlatform, BroadcastRepository};
use crate::domain::{
    broadcast::*,
    broadcast_validation::{validate_document, validate_draft},
    error::{AppError, Result},
};
#[cfg(test)]
use std::time::Duration;
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc, Condvar, Mutex, MutexGuard,
    },
    time::{SystemTime, UNIX_EPOCH},
};

const CANCELLED: u8 = 1;
const COMMITTED: u8 = 2;

#[derive(Clone, Default)]
pub struct DispatchControl(Arc<AtomicU8>);

impl DispatchControl {
    pub fn cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire) & CANCELLED != 0
    }
    pub fn committed(&self) -> bool {
        self.0.load(Ordering::Acquire) & COMMITTED != 0
    }
    /// Single-use admission. Cancellation and submission have one atomic ordering.
    pub fn try_begin_commit(&self) -> bool {
        self.0
            .compare_exchange(0, COMMITTED, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }
    pub(super) fn cancel(&self) {
        self.0.fetch_or(CANCELLED, Ordering::AcqRel);
    }
}

pub(super) struct BroadcastInner<R> {
    pub repository: R,
    pub document: BroadcastDocument,
    pub in_flight: HashMap<String, DispatchControl>,
    pub blocked: HashSet<String>,
    pub shutting_down: bool,
    pub staged: HashMap<String, StagedAttachment>,
}

impl<R: BroadcastRepository> BroadcastInner<R> {
    pub fn commit(&mut self, mut candidate: BroadcastDocument) -> Result<()> {
        candidate.schema_version = 2;
        // Terminal state and source retirement are one durable transaction.
        // User files are never removed; only this job's private references expire.
        let live: HashSet<_> = candidate
            .jobs
            .iter()
            .filter(|job| !job.state.terminal())
            .map(|job| &job.id)
            .collect();
        candidate
            .attachment_sources
            .retain(|source| live.contains(&source.job_id));
        candidate.revision = self
            .document
            .revision
            .checked_add(1)
            .ok_or(AppError::StoreInvalid)?;
        validate_document(&candidate)?;
        let bytes = serde_json::to_vec(&candidate).map_err(|_| AppError::StoreInvalid)?;
        if bytes.len() > MAX_STORE_BYTES {
            return Err(AppError::BroadcastLimit);
        }
        self.repository
            .save(&candidate)
            .map_err(|_| AppError::BroadcastPersistence)?;
        self.document = candidate;
        Ok(())
    }

    pub fn projected(&self, job: &BroadcastJob) -> BroadcastJob {
        let mut result = job.clone();
        result.storage_blocked = self.blocked.contains(&job.id);
        result
    }
}

pub struct BroadcastService<R: BroadcastRepository, P: BroadcastPlatform> {
    pub(super) inner: Arc<Mutex<BroadcastInner<R>>>,
    pub(super) platform: Arc<P>,
    pub(super) idle: Arc<Condvar>,
    #[cfg(test)]
    pub(crate) before_worker_exit: Arc<Mutex<Option<WorkerExitHook>>>,
}

#[cfg(test)]
pub(crate) type WorkerExitHook = Box<dyn FnOnce() + Send>;

impl<R: BroadcastRepository, P: BroadcastPlatform> Clone for BroadcastService<R, P> {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            platform: Arc::clone(&self.platform),
            idle: Arc::clone(&self.idle),
            #[cfg(test)]
            before_worker_exit: Arc::clone(&self.before_worker_exit),
        }
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(1)
}

impl<R: BroadcastRepository, P: BroadcastPlatform> BroadcastService<R, P> {
    pub fn open(repository: R, platform: Arc<P>) -> Result<Self> {
        Self::open_at(repository, platform, now_ms())
    }

    pub fn open_at(repository: R, platform: Arc<P>, now: u64) -> Result<Self> {
        let document = repository.load()?.unwrap_or_default();
        validate_document(&document)?;
        let mut inner = BroadcastInner {
            repository,
            document,
            in_flight: HashMap::new(),
            blocked: HashSet::new(),
            shutting_down: false,
            staged: HashMap::new(),
        };
        let mut recovered = inner.document.clone();
        for job in &mut recovered.jobs {
            if job.state.terminal() {
                continue;
            }
            let at = now.max(job.updated_at).max(1);
            if job.state.owns_account() || job.checkpoint.is_some() {
                let stopping = job.state == BroadcastState::Stopping;
                let issue = if job.checkpoint.is_some() {
                    BroadcastIssue::InterruptedUncertain
                } else {
                    BroadcastIssue::Interrupted
                };
                job.interrupt(at, issue);
                if stopping {
                    job.finish(BroadcastState::Stopped, at);
                }
            } else if job.started_at.is_some() {
                // A scheduled preflight had started: require review after a restart.
                job.review_required = true;
                job.last_issue = Some(BroadcastIssue::Interrupted);
                job.binding = None;
                job.next_send_at = None;
                job.updated_at = at;
            } else if job.scheduled_at.is_none() {
                // Never surprise-send an immediate request from a previous process.
                job.review_required = true;
                job.last_issue = Some(BroadcastIssue::Interrupted);
                job.updated_at = at;
            }
        }
        if recovered != inner.document {
            inner.commit(recovered)?;
        }
        Ok(Self {
            inner: Arc::new(Mutex::new(inner)),
            platform,
            idle: Arc::new(Condvar::new()),
            #[cfg(test)]
            before_worker_exit: Arc::new(Mutex::new(None)),
        })
    }

    pub(super) fn lock(&self) -> Result<MutexGuard<'_, BroadcastInner<R>>> {
        self.inner.lock().map_err(|_| AppError::StateUnavailable)
    }

    pub fn snapshot(&self) -> Result<BroadcastSnapshot> {
        let inner = self.lock()?;
        Ok(BroadcastSnapshot {
            revision: inner.document.revision,
            jobs: inner
                .document
                .jobs
                .iter()
                .map(|job| inner.projected(job))
                .collect(),
        })
    }

    #[cfg(test)]
    pub fn list(&self) -> Result<Vec<BroadcastJob>> {
        Ok(self.snapshot()?.jobs)
    }

    /// Optional bounded host shutdown wait. Never call while holding Workspace.
    #[cfg(test)]
    pub fn wait_idle(&self, timeout: Duration) -> Result<bool> {
        let inner = self.lock()?;
        let (inner, _) = self
            .idle
            .wait_timeout_while(inner, timeout, |value| !value.in_flight.is_empty())
            .map_err(|_| AppError::StateUnavailable)?;
        Ok(inner.in_flight.is_empty())
    }

    pub fn submit(
        &self,
        account: BroadcastAccount,
        draft: BroadcastDraft,
        now: u64,
    ) -> Result<BroadcastJob> {
        validate_draft(&account, &draft)?;
        if now == 0 {
            return Err(AppError::BroadcastInvalid);
        }
        let mut inner = self.lock()?;
        if inner.document.retired_ids.contains(&draft.id) {
            return Err(AppError::BroadcastRetired);
        }
        if let Some(existing) = inner.document.jobs.iter().find(|job| job.id == draft.id) {
            if existing.draft() != draft || existing.platform_id != account.platform_id {
                return Err(AppError::BroadcastConflict);
            }
            return Ok(inner.projected(existing));
        }
        if inner.shutting_down {
            return Err(AppError::BroadcastUnavailable);
        }
        if draft.scheduled_at.is_some_and(|at| at <= now) {
            return Err(AppError::BroadcastInvalid);
        }
        let sources = draft
            .attachments
            .iter()
            .map(|attachment| {
                let selected = inner
                    .staged
                    .get(&attachment.id)
                    .filter(|selected| {
                        selected.account_id == account.id
                            && selected.metadata == *attachment
                            && !selected.expired()
                    })
                    .ok_or(AppError::BroadcastAttachmentUnavailable)?;
                Ok(selected.source(&draft.id))
            })
            .collect::<Result<Vec<_>>>()?;
        let job = BroadcastJob::from_draft(&account, draft, now);
        let mut candidate = inner.document.clone();
        if candidate.jobs.len() >= MAX_JOBS {
            if candidate.retired_ids.len() >= MAX_RETIRED_IDS {
                return Err(AppError::BroadcastLimit);
            }
            let index = candidate
                .jobs
                .iter()
                .enumerate()
                .filter(|(_, job)| job.dismissed && job.state.terminal())
                .min_by_key(|(index, job)| (job.created_at, *index))
                .map(|(index, _)| index)
                .ok_or(AppError::BroadcastLimit)?;
            let retired = candidate.jobs.remove(index);
            candidate.retired_ids.push(retired.id);
        }
        candidate.jobs.push(job.clone());
        candidate.attachment_sources.extend(sources);
        inner.commit(candidate)?;
        for attachment in &job.attachments {
            inner.staged.remove(&attachment.id);
        }
        Ok(job)
    }

    /// Exit admission closes immediately. Already submitted effects retain evidence.
    /// The desktop owns scheduler lifetime; no detached loop is created here.
    pub fn shutdown(&self) -> Result<()> {
        let mut inner = self.lock()?;
        inner.shutting_down = true;
        inner.staged.clear();
        for control in inner.in_flight.values() {
            control.cancel();
        }
        Ok(())
    }
}
