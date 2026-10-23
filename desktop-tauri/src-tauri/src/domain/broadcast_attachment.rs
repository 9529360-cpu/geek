//! Public attachment descriptions and native-only durable source identities.
use super::{
    broadcast::BroadcastDocument,
    broadcast_validation::valid_uuid,
    error::{AppError, Result},
};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fmt, path::Path};

pub const MAX_ATTACHMENTS: usize = 10;
pub const MAX_ATTACHMENT_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_ATTACHMENT_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;
pub const ATTACHMENT_CHUNK_BYTES: usize = 512 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AttachmentKind {
    Image,
    Video,
    Audio,
    Document,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BroadcastAttachment {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub mime: String,
    pub kind: AttachmentKind,
}

impl BroadcastAttachment {
    pub fn validate(&self) -> Result<()> {
        if !valid_uuid(&self.id) {
            return Err(AppError::BroadcastAttachmentInvalid);
        }
        validate_description(&self.name, self.size, &self.mime, self.kind)
    }
}

fn validate_description(name: &str, size: u64, mime: &str, kind: AttachmentKind) -> Result<()> {
    if name.trim().is_empty()
        || matches!(name, "." | "..")
        || name.encode_utf16().count() > 255
        || name
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
        || size > MAX_ATTACHMENT_BYTES
        || mime.len() > 100
        || !mime.contains('/')
        || !mime
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"/.-+".contains(&b))
        || match kind {
            AttachmentKind::Image => !mime.starts_with("image/"),
            AttachmentKind::Video => !mime.starts_with("video/"),
            AttachmentKind::Audio => !mime.starts_with("audio/"),
            AttachmentKind::Document => false,
        }
    {
        return Err(AppError::BroadcastAttachmentInvalid);
    }
    Ok(())
}

fn validate_location(path: &str, digest: &str) -> Result<()> {
    if path.len() > 32_768
        || !Path::new(path).is_absolute()
        || path.chars().any(char::is_control)
        || digest.len() != 64
        || !digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(AppError::BroadcastAttachmentInvalid);
    }
    Ok(())
}

/// An inspected native selection before the broadcast owner allocates its ref.
#[derive(Clone, PartialEq, Eq)]
pub struct AttachmentFile {
    pub name: String,
    pub size: u64,
    pub mime: String,
    pub kind: AttachmentKind,
    pub canonical_path: String,
    pub mtime_ns: u64,
    pub sha256: String,
}

impl AttachmentFile {
    pub fn validate(&self) -> Result<()> {
        validate_description(&self.name, self.size, &self.mime, self.kind)?;
        validate_location(&self.canonical_path, &self.sha256)
    }
}

/// Only BroadcastDocument persists this value. Job/Snapshot never include it.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BroadcastAttachmentSource {
    pub account_id: String,
    pub job_id: String,
    pub attachment: BroadcastAttachment,
    pub canonical_path: String,
    pub mtime_ns: u64,
    pub sha256: String,
}

impl BroadcastAttachmentSource {
    pub fn validate(&self) -> Result<()> {
        self.attachment.validate()?;
        if !valid_uuid(&self.account_id) || !valid_uuid(&self.job_id) {
            return Err(AppError::BroadcastAttachmentInvalid);
        }
        validate_location(&self.canonical_path, &self.sha256)
    }
}

impl fmt::Debug for AttachmentFile {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("AttachmentFile")
            .field("size", &self.size)
            .finish_non_exhaustive()
    }
}

impl fmt::Debug for BroadcastAttachmentSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BroadcastAttachmentSource")
            .field("account_id", &self.account_id)
            .field("job_id", &self.job_id)
            .field("attachment_id", &self.attachment.id)
            .finish_non_exhaustive()
    }
}

pub fn validate_attachments(attachments: &[BroadcastAttachment]) -> Result<()> {
    if attachments.len() > MAX_ATTACHMENTS {
        return Err(AppError::BroadcastAttachmentLimit);
    }
    let mut total = 0u64;
    let mut ids = HashSet::new();
    for attachment in attachments {
        attachment.validate()?;
        total = total
            .checked_add(attachment.size)
            .ok_or(AppError::BroadcastAttachmentLimit)?;
        if total > MAX_ATTACHMENT_TOTAL_BYTES || !ids.insert(&attachment.id) {
            return Err(AppError::BroadcastAttachmentLimit);
        }
    }
    Ok(())
}

pub fn validate_sources(document: &BroadcastDocument) -> Result<()> {
    let mut ids = HashSet::new();
    let mut expected = HashSet::new();
    for job in &document.jobs {
        for attachment in &job.attachments {
            if !ids.insert(&attachment.id) {
                return Err(AppError::StoreInvalid);
            }
            if !job.state.terminal() {
                expected.insert(&attachment.id);
            }
        }
    }
    if document.attachment_sources.len() != expected.len() {
        return Err(AppError::StoreInvalid);
    }
    for source in &document.attachment_sources {
        source.validate().map_err(|_| AppError::StoreInvalid)?;
        let job = document
            .jobs
            .iter()
            .find(|job| job.id == source.job_id)
            .ok_or(AppError::StoreInvalid)?;
        if job.account_id != source.account_id
            || job.state.terminal()
            || !job.attachments.contains(&source.attachment)
            || !expected.remove(&source.attachment.id)
        {
            return Err(AppError::StoreInvalid);
        }
    }
    Ok(())
}
