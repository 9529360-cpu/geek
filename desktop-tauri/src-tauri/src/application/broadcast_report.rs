//! Capture the existing owner's durable report without file or guest effects.
use super::{
    broadcast::BroadcastService,
    ports::{BroadcastPlatform, BroadcastRepository},
};
use crate::domain::{
    broadcast_history::BroadcastHistoryReport,
    broadcast_report::BroadcastFailureReport,
    broadcast_validation::valid_uuid,
    error::{AppError, Result},
};

impl<R: BroadcastRepository, P: BroadcastPlatform> BroadcastService<R, P> {
    pub fn history_report(&self, account_id: &str) -> Result<BroadcastHistoryReport> {
        if !valid_uuid(account_id) {
            return Err(AppError::BroadcastInvalid);
        }
        let inner = self.lock()?;
        let jobs: Vec<_> = inner
            .document
            .jobs
            .iter()
            .filter(|job| job.account_id == account_id)
            .map(|job| inner.projected(job))
            .collect();
        Ok(BroadcastHistoryReport::from_jobs(
            account_id,
            inner.document.revision,
            &jobs,
        ))
    }

    pub fn failure_report(&self, account_id: &str, job_id: &str) -> Result<BroadcastFailureReport> {
        if !valid_uuid(account_id) || !valid_uuid(job_id) {
            return Err(AppError::BroadcastInvalid);
        }
        let (job, revision) = {
            let inner = self.lock()?;
            let job = inner
                .document
                .jobs
                .iter()
                .find(|job| job.id == job_id && job.account_id == account_id)
                .ok_or(AppError::BroadcastUnknown)?;
            (inner.projected(job), inner.document.revision)
        };
        BroadcastFailureReport::from_job(&job, revision)
    }
}
