//! Native file sources. No paths or file bytes are returned through shell IPC.
use crate::{
    application::ports::{BroadcastAttachmentIo, BroadcastAttachmentRead},
    domain::{
        broadcast_attachment::{
            AttachmentFile, AttachmentKind, BroadcastAttachmentSource, ATTACHMENT_CHUNK_BYTES,
            MAX_ATTACHMENT_BYTES,
        },
        error::{AppError, Result},
    },
};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, Metadata, OpenOptions},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use zeroize::Zeroizing;

pub struct NativeAttachmentIo;

fn open_read(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_SHARE_READ: writers and replacement/deletion cannot coexist with
        // the handle retained through final verification and chunk streaming.
        options.share_mode(1);
    }
    options
        .open(path)
        .map_err(|_| AppError::BroadcastAttachmentUnavailable)
}

fn canonical(path: &Path) -> Result<PathBuf> {
    fs::canonicalize(path).map_err(|_| AppError::BroadcastAttachmentUnavailable)
}

fn stamp(metadata: Metadata) -> Result<(u64, u64)> {
    if !metadata.is_file() {
        return Err(AppError::BroadcastAttachmentUnavailable);
    }
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .and_then(|time| u64::try_from(time.as_nanos()).ok())
        .ok_or(AppError::BroadcastAttachmentUnavailable)?;
    Ok((metadata.len(), modified))
}

fn file_stamp(file: &File) -> Result<(u64, u64)> {
    stamp(
        file.metadata()
            .map_err(|_| AppError::BroadcastAttachmentUnavailable)?,
    )
}

fn check_stamp(file: &File, expected: (u64, u64)) -> Result<()> {
    if file_stamp(file)? != expected {
        return Err(AppError::BroadcastAttachmentChanged);
    }
    Ok(())
}

fn hash_file(
    file: &mut File,
    expected_size: u64,
    check: &dyn Fn() -> Result<()>,
) -> Result<String> {
    let mut digest = Sha256::new();
    let mut total = 0u64;
    let mut buffer = Zeroizing::new(vec![0; ATTACHMENT_CHUNK_BYTES]);
    loop {
        check()?;
        let length = file
            .read(&mut buffer)
            .map_err(|_| AppError::BroadcastAttachmentUnavailable)?;
        if length == 0 {
            break;
        }
        total += length as u64;
        if total > expected_size {
            return Err(AppError::BroadcastAttachmentChanged);
        }
        digest.update(&buffer[..length]);
    }
    check()?;
    if total != expected_size {
        return Err(AppError::BroadcastAttachmentChanged);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "txt" => "text/plain",
        "csv" => "text/csv",
        "zip" => "application/zip",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

impl BroadcastAttachmentIo for NativeAttachmentIo {
    fn inspect(
        &self,
        path: &Path,
        as_document: bool,
        check: &dyn Fn() -> Result<()>,
    ) -> Result<AttachmentFile> {
        check()?;
        let canonical_path = canonical(path)?;
        let mut file = open_read(&canonical_path)?;
        let (size, mtime_ns) = file_stamp(&file)?;
        if size > MAX_ATTACHMENT_BYTES {
            return Err(AppError::BroadcastAttachmentLimit);
        }
        let sha256 = hash_file(&mut file, size, check)?;
        check_stamp(&file, (size, mtime_ns))?;
        if canonical(&canonical_path)? != canonical_path {
            return Err(AppError::BroadcastAttachmentChanged);
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or(AppError::BroadcastAttachmentInvalid)?
            .to_owned();
        let mime = mime(path);
        let kind = if as_document {
            AttachmentKind::Document
        } else if mime.starts_with("image/") {
            AttachmentKind::Image
        } else if mime.starts_with("video/") {
            AttachmentKind::Video
        } else if mime.starts_with("audio/") {
            AttachmentKind::Audio
        } else {
            AttachmentKind::Document
        };
        let canonical_path = canonical_path
            .to_str()
            .ok_or(AppError::BroadcastAttachmentInvalid)?
            .to_owned();
        Ok(AttachmentFile {
            name,
            size,
            mime: mime.into(),
            kind,
            canonical_path,
            mtime_ns,
            sha256,
        })
    }

    fn open_verified(
        &self,
        source: &BroadcastAttachmentSource,
        check: &dyn Fn() -> Result<()>,
    ) -> Result<Box<dyn BroadcastAttachmentRead>> {
        source.validate()?;
        check()?;
        let path = PathBuf::from(&source.canonical_path);
        if canonical(&path)? != path {
            return Err(AppError::BroadcastAttachmentChanged);
        }
        let mut file = open_read(&path)?;
        let expected = (source.attachment.size, source.mtime_ns);
        check_stamp(&file, expected)?;
        let actual = hash_file(&mut file, source.attachment.size, check)?;
        check_stamp(&file, expected)?;
        if actual != source.sha256 || canonical(&path)? != path {
            return Err(AppError::BroadcastAttachmentChanged);
        }
        file.seek(SeekFrom::Start(0))
            .map_err(|_| AppError::BroadcastAttachmentUnavailable)?;
        Ok(Box::new(VerifiedRead {
            file,
            source: source.clone(),
            digest: Some(Sha256::new()),
            read: 0,
            done: false,
        }))
    }
}

struct VerifiedRead {
    file: File,
    source: BroadcastAttachmentSource,
    digest: Option<Sha256>,
    read: u64,
    done: bool,
}

impl BroadcastAttachmentRead for VerifiedRead {
    fn next_chunk(&mut self, check: &dyn Fn() -> Result<()>) -> Result<Option<Zeroizing<Vec<u8>>>> {
        check()?;
        if self.done {
            return Ok(None);
        }
        let mut bytes = Zeroizing::new(vec![0; ATTACHMENT_CHUNK_BYTES]);
        let length = self
            .file
            .read(&mut bytes)
            .map_err(|_| AppError::BroadcastAttachmentUnavailable)?;
        if length == 0 {
            let digest = self
                .digest
                .take()
                .ok_or(AppError::BroadcastAttachmentChanged)?;
            let actual = format!("{:x}", digest.finalize());
            check_stamp(
                &self.file,
                (self.source.attachment.size, self.source.mtime_ns),
            )?;
            let path = Path::new(&self.source.canonical_path);
            if self.read != self.source.attachment.size
                || actual != self.source.sha256
                || canonical(path)? != path
            {
                return Err(AppError::BroadcastAttachmentChanged);
            }
            self.done = true;
            return Ok(None);
        }
        self.read += length as u64;
        if self.read > self.source.attachment.size {
            return Err(AppError::BroadcastAttachmentChanged);
        }
        self.digest
            .as_mut()
            .ok_or(AppError::BroadcastAttachmentChanged)?
            .update(&bytes[..length]);
        bytes.truncate(length);
        check()?;
        Ok(Some(bytes))
    }
}

#[cfg(test)]
mod tests;
