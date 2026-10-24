//! Temporary account leases become durable job sources in the existing job commit.
use super::{
    broadcast::BroadcastService,
    ports::{BroadcastAttachmentIo, BroadcastPlatform, BroadcastRepository},
};
use crate::domain::{
    broadcast_attachment::{
        validate_attachments, AttachmentFile, BroadcastAttachment, BroadcastAttachmentSource,
        MAX_ATTACHMENTS,
    },
    broadcast_validation::valid_uuid,
    error::{AppError, Result},
};
use std::{
    collections::HashSet,
    path::PathBuf,
    time::{Duration, Instant},
};
use uuid::Uuid;

const MAX_SELECTIONS: usize = 100;
const SELECTION_TTL: Duration = Duration::from_secs(6 * 60 * 60);

pub(super) struct StagedAttachment {
    pub account_id: String,
    pub metadata: BroadcastAttachment,
    pub file: AttachmentFile,
    pub issued: Instant,
}

impl StagedAttachment {
    pub fn expired(&self) -> bool {
        self.issued.elapsed() >= SELECTION_TTL
    }

    pub fn source(&self, job_id: &str) -> BroadcastAttachmentSource {
        BroadcastAttachmentSource {
            account_id: self.account_id.clone(),
            job_id: job_id.into(),
            attachment: self.metadata.clone(),
            canonical_path: self.file.canonical_path.clone(),
            mtime_ns: self.file.mtime_ns,
            sha256: self.file.sha256.clone(),
        }
    }
}

fn valid_ids(account_id: &str, ids: &[String], limit: usize) -> Result<()> {
    let mut seen = HashSet::new();
    if !valid_uuid(account_id)
        || ids.len() > limit
        || ids.iter().any(|id| !valid_uuid(id) || !seen.insert(id))
    {
        return Err(AppError::BroadcastAttachmentInvalid);
    }
    Ok(())
}

impl<R: BroadcastRepository, P: BroadcastPlatform> BroadcastService<R, P> {
    pub fn register_attachments(
        &self,
        account_id: &str,
        paths: &[PathBuf],
        as_document: bool,
        io: &dyn BroadcastAttachmentIo,
        check: &dyn Fn() -> Result<()>,
    ) -> Result<Vec<BroadcastAttachment>> {
        if !valid_uuid(account_id) {
            return Err(AppError::BroadcastAttachmentInvalid);
        }
        if paths.len() > MAX_ATTACHMENTS {
            return Err(AppError::BroadcastAttachmentLimit);
        }
        let mut selections = Vec::new();
        for path in paths {
            check()?;
            let file = io.inspect(path, as_document, check)?;
            file.validate()?;
            let metadata = BroadcastAttachment {
                id: Uuid::new_v4().to_string(),
                name: file.name.clone(),
                size: file.size,
                mime: file.mime.clone(),
                kind: file.kind,
            };
            metadata.validate()?;
            let selected = StagedAttachment {
                account_id: account_id.into(),
                metadata,
                file,
                issued: Instant::now(),
            };
            selections.push(selected);
        }
        let metadata: Vec<_> = selections
            .iter()
            .map(|selected| selected.metadata.clone())
            .collect();
        validate_attachments(&metadata)?;
        check()?;
        let mut inner = self.lock()?;
        if inner.shutting_down {
            return Err(AppError::BroadcastUnavailable);
        }
        inner.staged.retain(|_, selected| !selected.expired());
        if inner.staged.len() + selections.len() > MAX_SELECTIONS {
            return Err(AppError::BroadcastAttachmentLimit);
        }
        for selected in selections {
            inner.staged.insert(selected.metadata.id.clone(), selected);
        }
        Ok(metadata)
    }

    pub fn release_attachments(&self, account_id: &str, ids: &[String]) -> Result<()> {
        valid_ids(account_id, ids, MAX_SELECTIONS)?;
        let mut inner = self.lock()?;
        // Validate the whole release before mutating anything. Unknown/already
        // committed refs are harmless; another account's live lease is not ours.
        if ids.iter().any(|id| {
            inner
                .staged
                .get(id)
                .is_some_and(|s| s.account_id != account_id)
        }) {
            return Err(AppError::BroadcastAttachmentInvalid);
        }
        for id in ids {
            inner.staged.remove(id);
        }
        Ok(())
    }

    pub fn resolve_attachments(
        &self,
        account_id: &str,
        job_id: &str,
        ids: &[String],
    ) -> Result<Vec<BroadcastAttachment>> {
        valid_ids(account_id, ids, MAX_ATTACHMENTS)?;
        if !valid_uuid(job_id) {
            return Err(AppError::BroadcastInvalid);
        }
        let inner = self.lock()?;
        if inner.document.retired_ids.iter().any(|id| id == job_id) {
            return Err(AppError::BroadcastRetired);
        }
        if let Some(job) = inner.document.jobs.iter().find(|job| job.id == job_id) {
            if job.account_id != account_id || !job.attachments.iter().map(|a| &a.id).eq(ids.iter())
            {
                return Err(AppError::BroadcastConflict);
            }
            return Ok(job.attachments.clone());
        }
        let metadata = ids
            .iter()
            .map(|id| {
                let selected = inner
                    .staged
                    .get(id)
                    .filter(|selected| selected.account_id == account_id && !selected.expired())
                    .ok_or(AppError::BroadcastAttachmentUnavailable)?;
                Ok(selected.metadata.clone())
            })
            .collect::<Result<Vec<_>>>()?;
        validate_attachments(&metadata)?;
        Ok(metadata)
    }

    /// Private dispatch data is available only to the current durable attempt.
    pub fn dispatch_sources(
        &self,
        account_id: &str,
        job_id: &str,
        attempt_id: &str,
    ) -> Result<Vec<BroadcastAttachmentSource>> {
        let inner = self.lock()?;
        let job = &inner.document.jobs[inner.document.index(job_id)?];
        if job.account_id != account_id
            || job.state.terminal()
            || !job
                .checkpoint
                .as_ref()
                .is_some_and(|checkpoint| checkpoint.attempt_id == attempt_id)
        {
            return Err(AppError::BroadcastState);
        }
        job.attachments
            .iter()
            .map(|attachment| {
                inner
                    .document
                    .attachment_sources
                    .iter()
                    .find(|source| {
                        source.account_id == account_id
                            && source.job_id == job_id
                            && source.attachment == *attachment
                    })
                    .cloned()
                    .ok_or(AppError::BroadcastAttachmentUnavailable)
            })
            .collect()
    }
}
