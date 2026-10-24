use super::*;
use crate::domain::broadcast_attachment::BroadcastAttachment;
use std::sync::atomic::{AtomicUsize, Ordering};
use uuid::Uuid;

fn source(file: AttachmentFile) -> BroadcastAttachmentSource {
    BroadcastAttachmentSource {
        account_id: Uuid::new_v4().to_string(),
        job_id: Uuid::new_v4().to_string(),
        attachment: BroadcastAttachment {
            id: Uuid::new_v4().to_string(),
            name: file.name,
            size: file.size,
            mime: file.mime,
            kind: file.kind,
        },
        canonical_path: file.canonical_path,
        mtime_ns: file.mtime_ns,
        sha256: file.sha256,
    }
}

#[test]
fn telegram_classifies_supported_media_and_keeps_original_document_bytes_and_identity() {
    let root = tempfile::tempdir().unwrap();
    for (name, mime, kind) in [
        ("photo.JPG", "image/jpeg", AttachmentKind::Image),
        ("photo.png", "image/png", AttachmentKind::Image),
        ("clip.mp4", "video/mp4", AttachmentKind::Video),
        ("animation.gif", "image/gif", AttachmentKind::Document),
        ("picture.webp", "image/webp", AttachmentKind::Document),
        ("sound.mp3", "audio/mpeg", AttachmentKind::Document),
        ("notes.txt", "text/plain", AttachmentKind::Document),
        (
            "opaque.bin",
            "application/octet-stream",
            AttachmentKind::Document,
        ),
    ] {
        let path = root.path().join(name);
        let bytes = format!("Synthetic original file: {name}").into_bytes();
        fs::write(&path, &bytes).unwrap();
        let selected = TelegramAttachmentIo
            .inspect(&path, false, &|| Ok(()))
            .unwrap();
        assert_eq!(selected.kind, kind);
        assert_eq!(selected.name, name);
        assert_eq!(selected.mime, mime);
        assert_eq!(selected.sha256, format!("{:x}", Sha256::digest(&bytes)));
        let selected = source(selected);
        let mut reader = TelegramAttachmentIo
            .open_verified(&selected, &|| Ok(()))
            .unwrap();
        assert_eq!(&reader.next_chunk(&|| Ok(())).unwrap().unwrap()[..], &bytes);
        assert!(reader.next_chunk(&|| Ok(())).unwrap().is_none());
        drop(reader);
        assert_eq!(
            TelegramAttachmentIo
                .inspect(&path, true, &|| Ok(()))
                .unwrap()
                .kind,
            AttachmentKind::Document
        );
        assert!(matches!(
            TelegramAttachmentIo.open_verified(&selected, &|| Err(AppError::BroadcastUnavailable)),
            Err(AppError::BroadcastUnavailable)
        ));
        fs::write(&path, b"Substituted file").unwrap();
        assert!(matches!(
            TelegramAttachmentIo.open_verified(&selected, &|| Ok(())),
            Err(AppError::BroadcastAttachmentChanged)
        ));
    }
    let empty = root.path().join("empty.txt");
    fs::write(&empty, b"").unwrap();
    assert!(matches!(
        TelegramAttachmentIo.inspect(&empty, false, &|| Ok(())),
        Err(AppError::BroadcastAttachmentInvalid)
    ));
}

#[test]
fn inspection_freezes_the_real_file_and_verified_reads_are_bounded_chunks() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("synthetic.png");
    let content: Vec<_> = (0..(5 * ATTACHMENT_CHUNK_BYTES + 17))
        .map(|index| (index % 251) as u8)
        .collect();
    fs::write(&path, &content).unwrap();
    let calls = AtomicUsize::new(0);
    let check = || {
        calls.fetch_add(1, Ordering::Relaxed);
        Ok(())
    };
    let selected = NativeAttachmentIo.inspect(&path, false, &check).unwrap();
    assert_eq!(selected.size, content.len() as u64);
    assert_eq!(selected.kind, AttachmentKind::Image);
    assert_eq!(selected.mime, "image/png");
    assert_eq!(selected.sha256, format!("{:x}", Sha256::digest(&content)));
    assert_eq!(
        selected.canonical_path,
        fs::canonicalize(&path).unwrap().to_str().unwrap()
    );
    let mut reader = NativeAttachmentIo
        .open_verified(&source(selected), &check)
        .unwrap();
    let mut offset = 0;
    let mut chunks = 0;
    while let Some(bytes) = reader.next_chunk(&check).unwrap() {
        assert!(!bytes.is_empty() && bytes.len() <= ATTACHMENT_CHUNK_BYTES);
        assert_eq!(&bytes[..], &content[offset..offset + bytes.len()]);
        offset += bytes.len();
        chunks += 1;
    }
    assert_eq!(offset, content.len());
    assert!(chunks >= 6);
    assert!(reader.next_chunk(&check).unwrap().is_none());
    assert!(calls.load(Ordering::Relaxed) > chunks);
    assert_eq!(
        NativeAttachmentIo
            .inspect(&path, true, &|| Ok(()))
            .unwrap()
            .kind,
        AttachmentKind::Document
    );
}

#[test]
fn missing_changed_and_same_size_same_mtime_substituted_content_are_rejected() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("source.txt");
    fs::write(&path, b"abc").unwrap();
    let selected = source(
        NativeAttachmentIo
            .inspect(&path, false, &|| Ok(()))
            .unwrap(),
    );
    assert_eq!(
        selected.sha256,
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    fs::write(&path, b"xyz").unwrap();
    // Restore the timestamp too: size/mtime alone cannot prove content identity.
    File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_times(
            fs::FileTimes::new()
                .set_modified(UNIX_EPOCH + std::time::Duration::from_nanos(selected.mtime_ns)),
        )
        .unwrap();
    assert!(matches!(
        NativeAttachmentIo.open_verified(&selected, &|| Ok(())),
        Err(AppError::BroadcastAttachmentChanged)
    ));
    fs::remove_file(&path).unwrap();
    assert!(matches!(
        NativeAttachmentIo.open_verified(&selected, &|| Ok(())),
        Err(AppError::BroadcastAttachmentUnavailable)
    ));
    let error = NativeAttachmentIo
        .inspect(&path, false, &|| Ok(()))
        .unwrap_err();
    assert_eq!(error.to_string(), "BROADCAST_ATTACHMENT_UNAVAILABLE");
    assert!(!format!("{selected:?}").contains("canonical_path"));
}

#[test]
fn oversized_nonfiles_and_cancellation_do_not_read_or_publish_attachment_bytes() {
    let root = tempfile::tempdir().unwrap();
    assert!(NativeAttachmentIo
        .inspect(root.path(), false, &|| Ok(()))
        .is_err());
    let path = root.path().join("large.bin");
    File::create(&path)
        .unwrap()
        .set_len(MAX_ATTACHMENT_BYTES + 1)
        .unwrap();
    assert!(matches!(
        NativeAttachmentIo.inspect(&path, false, &|| Ok(())),
        Err(AppError::BroadcastAttachmentLimit)
    ));
    fs::write(&path, b"small fixture").unwrap();
    let checks = AtomicUsize::new(0);
    let cancelled = || {
        if checks.fetch_add(1, Ordering::Relaxed) >= 1 {
            Err(AppError::BroadcastUnavailable)
        } else {
            Ok(())
        }
    };
    assert!(matches!(
        NativeAttachmentIo.inspect(&path, false, &cancelled),
        Err(AppError::BroadcastUnavailable)
    ));
    let selected = source(
        NativeAttachmentIo
            .inspect(&path, false, &|| Ok(()))
            .unwrap(),
    );
    let mut reader = NativeAttachmentIo
        .open_verified(&selected, &|| Ok(()))
        .unwrap();
    assert!(matches!(
        reader.next_chunk(&|| Err(AppError::BroadcastUnavailable)),
        Err(AppError::BroadcastUnavailable)
    ));
}

#[cfg(windows)]
#[test]
fn windows_verified_reader_prevents_writes_and_deletion_until_it_is_dropped() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("read-lease.txt");
    fs::write(&path, b"immutable synthetic source").unwrap();
    let selected = source(
        NativeAttachmentIo
            .inspect(&path, false, &|| Ok(()))
            .unwrap(),
    );
    let reader = NativeAttachmentIo
        .open_verified(&selected, &|| Ok(()))
        .unwrap();
    assert!(OpenOptions::new().write(true).open(&path).is_err());
    assert!(fs::remove_file(&path).is_err());
    assert!(fs::rename(&path, root.path().join("moved.txt")).is_err());
    drop(reader);
    fs::write(&path, b"now editable").unwrap();
    fs::remove_file(path).unwrap();
}

#[cfg(unix)]
#[test]
fn canonical_reference_replacement_and_stream_time_mutation_fail_closed() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let original = root.path().join("original.txt");
    let replacement = root.path().join("replacement.txt");
    fs::write(&original, vec![b'a'; ATTACHMENT_CHUNK_BYTES + 5]).unwrap();
    let selected = source(
        NativeAttachmentIo
            .inspect(&original, false, &|| Ok(()))
            .unwrap(),
    );
    let mut reader = NativeAttachmentIo
        .open_verified(&selected, &|| Ok(()))
        .unwrap();
    assert!(reader.next_chunk(&|| Ok(())).unwrap().is_some());
    fs::write(&original, vec![b'b'; ATTACHMENT_CHUNK_BYTES + 5]).unwrap();
    while let Ok(Some(_)) = reader.next_chunk(&|| Ok(())) {}
    assert!(reader.next_chunk(&|| Ok(())).is_err());
    drop(reader);
    fs::write(&replacement, b"replacement").unwrap();
    fs::remove_file(&original).unwrap();
    symlink(&replacement, &original).unwrap();
    assert!(matches!(
        NativeAttachmentIo.open_verified(&selected, &|| Ok(())),
        Err(AppError::BroadcastAttachmentChanged)
    ));
}
